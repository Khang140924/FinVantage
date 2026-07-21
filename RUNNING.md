# Chạy FinVantage

FinVantage là ứng dụng quản lý chi tiêu theo hóa đơn. Luồng xử lý khi triển khai AWS là:

`Cognito → API Gateway/Lambda → S3 → Textract → Redis → Bedrock → PostgreSQL/Aurora (qua RDS Proxy)`.

Trong môi trường local, mock auth, PostgreSQL Docker và Redis Docker chỉ phục vụ phát triển. Không đưa mật khẩu người dùng vào PostgreSQL; production dùng Amazon Cognito. Ảnh đại diện và hóa đơn luôn ở S3 private, còn PostgreSQL chỉ lưu khóa/metadata.

## 1. Yêu cầu

- Node.js 24 và npm 11 (khớp runtime Lambda và cấu hình build hiện tại).
- Docker Desktop nếu chạy PostgreSQL và Redis local.
- PostgreSQL client (`psql`) trên host nếu chạy các lệnh khởi tạo schema/migration qua `localhost:5433`.
- AWS CLI/profile hợp lệ khi dùng S3, Textract, Bedrock, SNS hoặc deploy AWS thật. Đăng nhập Cognito qua OIDC không tự yêu cầu AWS CLI profile.
- Một bản `.env` local tạo từ `.env.example`. Không commit file này.

Sau khi clone dự án, cài dependencies:

```powershell
npm install
npm --prefix frontend install
```

## 2. Cấu hình local an toàn

Sao chép `.env.example` thành `.env`, rồi chỉ điền giá trị ở máy local. Repository chỉ chứa placeholder trong `.env.example`.

Các nhóm biến chính:

| Nhóm | Biến |
| --- | --- |
| Auth BFF | `NODE_ENV`, `AUTH_SERVER_PORT`, `SESSION_SECRET`, `USE_MOCK_AUTH` |
| Frontend auth | `VITE_AUTH_MODE`, `VITE_API_BASE_URL` |
| Cognito | `COGNITO_ISSUER`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_DOMAIN`, `COGNITO_REDIRECT_URI`, `COGNITO_LOGOUT_URI`, `COGNITO_SCOPES` |
| AWS | `AWS_REGION`, `AWS_REGION_NAME`, `AWS_PROFILE`, `S3_RAW_BUCKET_NAME`, `PROFILE_AVATAR_BUCKET_NAME`, `BEDROCK_MODEL_ID`, `SNS_BUDGET_ALERTS_TOPIC_ARN` |
| Database | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `RDS_PROXY_ENDPOINT` |
| Cache/AI | `REDIS_URL`, `USE_MOCK_AI` |

`SESSION_SECRET`, database password, Cognito client secret và AWS credential phải là giá trị riêng tư. Đội ngũ có thể giữ một file cấu hình riêng tư ngoài repository, nhưng không sao chép nội dung của file đó vào Git, ticket hoặc tài liệu công khai.

### Mock local (khuyến nghị khi phát triển UI)

Trong `.env` của backend/Auth BFF:

```dotenv
NODE_ENV=development
USE_MOCK_AUTH=true
USE_MOCK_AI=true
DB_HOST=localhost
DB_PORT=5433
DB_NAME=finvantage
DB_USER=postgres
DB_SSL=false
REDIS_URL=redis://localhost:6379
```

Trong `frontend/.env.local`:

```dotenv
VITE_AUTH_MODE=mock
VITE_API_BASE_URL=http://localhost:3000/dev
```

Điền `DB_PASSWORD` và `SESSION_SECRET` riêng tại máy local. Không cần Cognito discovery khi `USE_MOCK_AUTH=true`: Auth BFF tạo phiên development, `/auth/me` trả mock user và logout xóa phiên đó. `VITE_AUTH_MODE` và `USE_MOCK_AUTH` phải cùng chế độ; ứng dụng báo lỗi cấu hình hữu hạn nếu thiếu hoặc không khớp, không tự fallback sang Mock User.

## 3. Khởi động local

### Terminal 1 – PostgreSQL và Redis

```powershell
docker compose up -d
```

PostgreSQL Docker của FinVantage được expose tại host `localhost:5433`, trong khi PostgreSQL bên trong container vẫn dùng port `5432`. Vì vậy PostgreSQL Windows có thể tiếp tục chạy tại `localhost:5432`; đặt `DB_PORT=5433` trong `.env` local để API kết nối đúng database Docker. Redis được expose tại `localhost:6379`.

Mọi thay đổi schema mới đi qua migration runner có ledger/checksum. Runner không tự đọc `.env`; truyền cấu hình database vào process hoặc thêm cờ `--load-dotenv-local` một cách chủ động. Trước tiên chỉ validate file, không kết nối database:

```powershell
npm run db:validate
```

Với database Docker **mới, trống**, tạo baseline và áp dụng migration sau khi xác nhận đúng host cổng 5433:

```powershell
npm run db:migrate:baseline:plan
node scripts/migrate.js --apply --baseline --load-dotenv-local --confirm-apply=FINVANTAGE_MIGRATION
```

Với database local đã có schema/dữ liệu, không thêm `--baseline`; xem plan rồi áp dụng các migration idempotent và kiểm tra ledger:

```powershell
npm run db:migrate:plan
npm run db:migrate -- --load-dotenv-local --confirm-apply=FINVANTAGE_MIGRATION
npm run db:migrate:status -- --load-dotenv-local
```

Chỉ chạy migration và integration test trên PostgreSQL Docker local có thể phục hồi. Runner từ chối remote/production nếu thiếu cờ xác nhận thứ hai; không sửa ledger thủ công.

### Terminal 2 – API local

```powershell
npm run api:dev
```

Serverless Offline mặc định phục vụ API ở cổng `3000`.
Serverless Framework v4 yêu cầu đăng nhập hoặc `SERVERLESS_ACCESS_KEY`/`SERVERLESS_LICENSE_KEY`
ngay cả khi chạy CLI local. Giữ key trong secret store của máy/CI, không ghi vào `.env` hay repository.

### Terminal 3 – Auth server

```powershell
npm run auth:dev
```

Auth BFF chạy ở cổng `4000`. Vite proxy các đường dẫn `/auth` đến cổng này, vì vậy frontend không nhận hoặc lưu Cognito client secret.

Cổng `4000` là BFF cho cả hai chế độ. Ở chế độ Cognito, tiến trình này không tạo Mock User: nó chỉ thực hiện OIDC redirect/callback, giữ cookie session HTTP-only và logout Cognito. Frontend luôn gọi đường dẫn tương đối `/auth`; không hard-code một mock origin trong bundle.

### Terminal 4 – Frontend

```powershell
npm run frontend:dev
```

Mở `http://localhost:5174`. Cổng `3002` có thể được Serverless Offline dùng cho Lambda trong một số cấu hình; không phải một ứng dụng người dùng cần mở trực tiếp.

Để dừng hạ tầng local:

```powershell
docker compose down
```

## 4. Đăng nhập và phiên làm việc

### Mock auth

Đặt đồng thời `VITE_AUTH_MODE=mock` và `USE_MOCK_AUTH=true`. Form development chỉ xuất hiện trong chế độ này; Auth BFF có thể tạo Mock User để kiểm thử local. Mock identity không được chấp nhận khi frontend/BFF đang ở chế độ Cognito.

### Cognito thật

Đặt `VITE_AUTH_MODE=cognito` trong `frontend/.env.local` và `USE_MOCK_AUTH=false` trong `.env` của Auth BFF. Cấu hình đầy đủ issuer, app client, domain, redirect URI và logout URI của Cognito; dùng một `SESSION_SECRET` riêng tư đủ mạnh. Không đặt secret vào Vite hoặc source code.

Người dùng chưa có session được chuyển một lần đến Cognito Managed Login; frontend không hiện form đăng nhập giả. Cognito xử lý đăng ký, xác minh email, quên mật khẩu và đặt lại mật khẩu. Nếu thiếu cấu hình hoặc OIDC discovery thất bại, Auth BFF vẫn trả trạng thái readiness có cấu trúc và frontend kết thúc màn hình tải bằng lỗi rõ ràng, thay vì redirect/loading vô hạn.

Sau callback, Auth BFF xác thực mã, giữ session HTTP-only và `/auth/me` trả claims `sub`, `email` cùng `name` hoặc `preferred_username`. Refresh frontend sẽ gọi lại `/auth/me` để khôi phục session. Logout xóa session rồi chuyển đến Cognito logout endpoint. Nếu chưa đăng nhập, protected route quay về login.

## 5. Luồng upload hóa đơn

1. Chọn JPG/JPEG/PNG/HEIC hoặc PDF hợp lệ. Chọn file **không** tự upload.
2. Ảnh hiện preview lớn, giữ tỷ lệ và có thể bấm để mở lightbox. PDF hiện card với tên và dung lượng. Nút **Clear** xóa file/preview; object URL được revoke khi thay file, clear hoặc unmount.
3. Nhấn **Tải lên & Phân tích**: frontend gọi import API. Mọi response thành công phải có `invoiceId`, `fileKey` và `cacheKey`; `uploadUrl` chỉ bắt buộc khi `uploadRequired=true`. Hóa đơn đã phân tích hoặc pipeline có thể tiếp tục an toàn dùng `uploadRequired=false` và không cần ký URL mới.
4. Bản ghi mới bắt đầu ở `UPLOAD_PENDING` với 0%. Chỉ sau khi import API thành công và presigned PUT trả 2xx, frontend mới hiển thị mốc `UPLOADED` 25% rồi gọi OCR. Backend xác nhận `uploadConfirmed`/trạng thái tiếp theo khi endpoint OCR hoặc S3-triggered handler bắt đầu xử lý object; presigned PUT không tự callback vào backend local.
5. Pipeline tiếp tục `OCR_PROCESSING → ANALYZING → ANALYZED`; lỗi OCR/AI được ghi `OCR_FAILED` hoặc `ANALYSIS_FAILED`. Presign/PUT thất bại dừng polling, đánh dấu bước upload lỗi và không làm các bước Textract, AI hay database trông như đang chạy.
6. Frontend hiển thị lỗi an toàn theo mã backend (ví dụ `AWS_CREDENTIALS_MISSING`) và cho phép thử lại; không nhận stack trace hay credential. Kết quả được mở bằng `invoiceId` thật, không yêu cầu F5.

Import API kiểm tra lại cặp phần mở rộng/MIME, tên file và dung lượng khai báo tối đa 10 MB; presigned PUT ký kèm `ContentLength` khi client gửi size. MIME/size này vẫn do client khai báo, nên môi trường production cần kiểm tra metadata/nội dung object sau upload (ví dụ `HeadObject` trước OCR) nếu yêu cầu bảo đảm tuyệt đối.

Trong AWS, S3 trigger hoặc API OCR gọi Textract AnalyzeExpense, kết quả tạm được giữ Redis rồi raw OCR thật được gửi Bedrock. `TOTAL` là bắt buộc; total rỗng tạo `OCR_EMPTY_RESULT` hoặc `OCR_TOTAL_NOT_FOUND`, không gọi AI và không lưu hóa đơn giả. Vendor có thể thiếu: hệ thống dùng `Không xác định` và warning, nhưng vẫn có thể hoàn tất nếu total/ocr hợp lệ.

Luồng S3/Textract thật cần AWS profile/credential còn hiệu lực, đúng region và đủ quyền tối thiểu. Chỉ chạy frontend, Serverless Offline và Redis/PostgreSQL local **không** làm S3 event trên AWS tự gọi một Lambda local; muốn kiểm tra end-to-end phải dùng hạ tầng AWS đã deploy/được phép, hoặc chủ động gọi endpoint OCR local sau khi PUT thật. Không xem việc build/test mock thành bằng chứng AWS thật đã hoạt động.

Mock AI chỉ sinh danh mục và gợi ý từ raw OCR; không được ghi đè vendor, total, ngày hay line item Textract. Idempotency/checksum và upsert theo invoice ID ngăn cùng một file làm tăng dữ liệu Dashboard hai lần.

Ví dụ test thật Phúc Long (chỉ chạy khi đã được phép dùng AWS thật): total phải là `103000`, ngày `2018-09-11`, vendor PHUC LONG, category Ăn uống và ba món 40.000, 35.000, 28.000. Không chạy test AWS này trong CI/local mặc định vì có thể phát sinh chi phí.

## 6. Các màn hình chính

- **Dashboard:** lấy dữ liệu PostgreSQL theo user, cho chọn tháng/năm; nếu tháng hiện tại không có dữ liệu thì chọn tháng có giao dịch mới nhất. Có empty state rõ ràng.
- **Transactions:** chỉ hiện Cửa hàng, Ngày, Danh mục, Số tiền, Trạng thái, Thao tác; dùng mã ngắn `HD-XXXXXXXX`, còn invoice ID thật vẫn dùng nội bộ cho xem/sửa/xóa.
- **Analysis Result:** mặc định chỉ hiện thông tin hóa đơn, line item và gợi ý AI. “Xem chi tiết kỹ thuật” mới hiển thị raw OCR, invoice ID, S3/cache key, database payload và trạng thái pipeline.
- **Settings/Profile:** lấy hồ sơ/preference từ API, không dùng dữ liệu tĩnh. Avatar upload qua presigned S3 URL private; frontend không nhận AWS credentials.
- **Budget & Alerts:** ngân sách tháng theo danh mục, hiển thị đã chi/hạn mức/còn lại/progress. 80–99% là cảnh báo, từ 100% là vượt hạn mức.
- **Notifications:** chuông hiển thị unread count và màu severity cao nhất: bình thường xanh, 80% vàng/cam, vượt hạn mức hoặc xử lý hóa đơn thất bại đỏ. Người dùng có thể đánh dấu đã đọc, đọc tất cả hoặc xóa.
- **Global Search:** backend tìm theo cửa hàng, line item, danh mục, số tiền, ngày hoặc mã tham chiếu ngắn; giới hạn theo user đã xác thực.

## 7. API local

Tất cả API nghiệp vụ phải lấy user ID từ token/session xác thực, không nhận `userId` do frontend gửi.

| Nhóm | Endpoint |
| --- | --- |
| Invoice | `POST /invoices/import`, `POST /invoices`, `POST /invoices/{id}/ocr`, `POST /invoices/{id}/analyze`, `GET /invoices`, `GET/PUT/DELETE /invoices/{id}`, `GET /invoices/{id}/status` |
| Tìm kiếm/Dashboard | `GET /search`, `GET /dashboard-summary` |
| Budget | `GET/POST /budgets`, `DELETE /budgets/{id}` |
| Spending Plan | `GET/PUT /spending-plan` |
| Hồ sơ | `GET/PUT /me`, `GET/PUT /me/preferences`, `POST /me/avatar/upload-url` |
| Thông báo | `GET /notifications`, `GET /notifications/unread-count`, `PUT /notifications/{id}/read`, `PUT /notifications/read-all`, `DELETE /notifications/{id}` |
| Thanh toán demo | `POST /payment` |

`POST /me/avatar/upload-url` chỉ nhận JPG/JPEG/PNG không quá 2 MB và trả presigned PUT URL cho key private `avatars/{cognito-sub}/avatar-{timestamp}.{extension}`. Sau PUT, gửi `PUT /me` để lưu `avatar_key`; `GET /me` trả presigned GET URL ngắn hạn. Người dùng không thể sửa avatar/hồ sơ của user khác.

Budget không cho hạn mức âm, 0 hoặc danh mục trùng trong cùng tháng. Frontend hiển thị `3.000.000 ₫` nhưng API nhận number `3000000`. Danh mục: Ăn uống, Di chuyển, Mua sắm, Giải trí, Hóa đơn, Sức khỏe, Giáo dục, Khác. Notification budget được dedupe theo ngân sách/tháng/ngưỡng để không gửi liên tục.

## 8. Kiến trúc AWS production

- **Cognito:** identity, Managed Login và claims. Không lưu password vào PostgreSQL.
- **API Gateway + Lambda:** public API nghiệp vụ và Auth BFF `/auth/*`; session Auth được lưu bền vững trong Valkey, không dùng MemoryStore production.
- **RDS PostgreSQL qua RDS Proxy:** dữ liệu hồ sơ, preference, transaction, budget, notification và metadata.
- **S3 private:** hóa đơn trong `uploads/`, avatar trong `avatars/`; chỉ Lambda có quyền S3 tối thiểu và frontend dùng presigned URL giới hạn thời gian.
- **Textract:** `AnalyzeExpense` trích xuất vendor, total, ngày, item, price và raw text.
- **ElastiCache Valkey (Redis protocol):** giữ Auth session và kết quả OCR/trạng thái pipeline trong namespace riêng theo stage.
- **Bedrock cross-account:** phân loại/gợi ý sau khi có OCR hợp lệ. Lambda dùng STS AssumeRole; named profile chỉ dùng local.
- **SNS:** Lambda có thể publish sự kiện cảnh báo ngân sách khi `SNS_BUDGET_ALERTS_TOPIC_ARN` được cấu hình và `budget_guardrails` đang bật. Ứng dụng không còn tùy chọn email riêng; subscription/opt-out của kênh email phải được quản lý ở SNS hoặc lớp phân phối. Local để topic ARN trống.

`serverless.yml` giữ IAM tối thiểu: S3 object ở prefix `uploads/` và `avatars/`, Textract AnalyzeExpense, Secrets Manager cho đúng database secret, STS AssumeRole cho đúng Bedrock role và SNS Publish cho topic được chỉ định. Quyền `bedrock:InvokeModel` nằm ở role tài khoản Bedrock đích, không nằm trong execution role nguồn. Bucket S3 không bật public access.

Quy trình production đầy đủ, gồm CloudFormation, migration one-off, Serverless v4, Amplify rewrite, Cognito callback, Bedrock trust policy, smoke test và rollback nằm trong [DEPLOYMENT.md](DEPLOYMENT.md). Các lệnh dưới đây chỉ validate/print/package, không deploy; chúng cần bộ biến production hợp lệ và output phải được bảo vệ vì cấu hình resolve có thể chứa secret:

Với Lambda Node.js 24, `serverless.yml` đặt `NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem`
cho các function kết nối RDS/RDS Proxy. Có thể thay bằng CA bundle đóng gói riêng; không tắt
`rejectUnauthorized` trong production.

```powershell
npm run db:validate
npm run production:validate
npm run serverless:print:prod
npm run serverless:package:prod
```

Không chạy migration production từ máy public. Dùng one-off job trong VPC với RDS Proxy, database secret và hai cờ xác nhận được mô tả trong `DEPLOYMENT.md`.

## 9. Build, syntax và test an toàn

Chạy frontend production build:

```powershell
npm.cmd --prefix frontend run build
```

Chạy bộ test mặc định an toàn, gồm unit test và local Auth BFF integration; bộ này không cần database hoặc AWS:

```powershell
npm test
```

Chạy riêng integration test Spending Plan sau khi đã áp dụng migration vào PostgreSQL Docker local dùng cho test:

```powershell
npm run test:spending-plan:integration
```

Integration test này tạo và dọn fixture trong database. Chỉ sử dụng database Docker local có thể hủy bỏ, tuyệt đối không chạy với thông tin kết nối production.

Chạy syntax backend:

```powershell
npm run syntax:check

# Hoặc kiểm tra thủ công từng file JavaScript:
node --check auth-server/index.js
Get-ChildItem -Recurse -File src,auth-server,tests,frontend\src |
  Where-Object { $_.Extension -in '.js', '.mjs', '.cjs' } |
  Sort-Object FullName |
  ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Ba local integration test chỉ dùng mock/local services (không gọi AWS khi đặt biến như dưới đây):

```powershell
$env:USE_MOCK_AUTH='true'
$env:USE_MOCK_AI='true'
$env:SNS_BUDGET_ALERTS_TOPIC_ARN=''
node tests/failurePipeline.integration.js
node tests/vendorOptionalPipeline.integration.js
node tests/search.integration.js
```

Không tự chạy `tests/phucLong.integration.js`, upload S3 thật, Textract, Bedrock hoặc deploy AWS nếu chưa có quyền/phê duyệt rõ ràng.

## 10. Kiểm tra trước khi chia sẻ mã

```powershell
git diff --check
git ls-files .env
git ls-files frontend/.env.local
git status --short
```

Hai lệnh `git ls-files` về env không được trả file nào. Không theo dõi `node_modules`, `frontend/dist`, log, `.serverless` artifact hoặc private env. Không dùng force push và không để credential trong source/documentation.

## 11. Sự cố thường gặp

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| Không đăng nhập mock | Xác nhận auth server cổng 4000 đang chạy và `USE_MOCK_AUTH=true`; không cần Cognito issuer. |
| Cognito trả 404 ở discovery | Kiểm tra `COGNITO_ISSUER` đúng user pool khi mock auth tắt. |
| Settings báo không lấy được credential AWS | Hồ sơ thường chỉ đọc PostgreSQL; kiểm tra endpoint `/me`, DB và không yêu cầu S3 trừ khi đang tạo presigned avatar URL. |
| Upload đứng hoặc trang đen | Kiểm tra API local, Redis, polling `/invoices/{id}/status` và lỗi hiển thị ở Upload. Không dựa hoàn toàn vào `location.state`. |
| OCR không có kết quả | Hệ thống phải trả lỗi OCR, không lưu transaction giả. Kiểm tra S3 key/permission và Textract chỉ khi chạy AWS thật. |
| Ảnh preview không hiển thị | Chọn định dạng ảnh hỗ trợ; Clear rồi chọn lại. PDF chỉ có file card, không render trang PDF. |
| Dashboard trống | Chọn đúng tháng/năm giao dịch hoặc để ứng dụng chọn tháng có giao dịch gần nhất. |

## 12. Bảo mật và đóng góp

- Không sửa, in hoặc commit `.env` và `frontend/.env.local`.
- Không log token, cookie, password, AWS access key, Cognito client secret hoặc database password.
- Không commit output `.serverless`; Serverless sẽ tạo lại khi cần.
- Trước khi merge/push, chạy build, test phù hợp, syntax check và `git diff --check`.
- Không deploy AWS từ local trừ khi công việc đã được ủy quyền riêng.
