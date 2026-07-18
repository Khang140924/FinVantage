# FinVantage — Hướng dẫn chạy local

Tài liệu này mô tả cách chạy FinVantage trên Windows mà không đưa secret vào Git. Mọi giá trị trong `.env.example` chỉ là placeholder; dùng cấu hình riêng của từng thành viên trong `.env`.

## 1. Tổng quan hệ thống

Luồng sản phẩm khi dùng AWS là:

```text
React/Vite
  ├─ /auth/* → Auth BFF (Express) → Amazon Cognito
  └─ API Gateway / Serverless Offline → Lambda
       → S3 (private) → Textract → Redis → Bedrock hoặc Mock AI → PostgreSQL/Aurora
```

Ở môi trường local, thành phần tương ứng là:

- Frontend React/Vite.
- Auth BFF Node.js, với Cognito thật hoặc mock auth.
- Serverless Offline cho HTTP API/Lambda.
- Redis qua Docker hoặc Redis local.
- PostgreSQL local hoặc container PostgreSQL.
- S3/Textract chỉ được gọi khi người chạy chủ động cấu hình AWS và thực hiện luồng upload OCR thật.
- `USE_MOCK_AI=true` để không gọi Amazon Bedrock.

Các dữ liệu hồ sơ, preferences, budget, notification và giao dịch đều thuộc về `user_id` lấy từ token đã xác thực. Production dùng Cognito; PostgreSQL không lưu mật khẩu người dùng.

## 2. Cổng mặc định

| Thành phần | Cổng | Ghi chú |
| --- | ---: | --- |
| Frontend Vite | 5174 | Được đặt `strictPort` trong `frontend/vite.config.js`. |
| Auth BFF | 4000 | Đọc `AUTH_SERVER_PORT`; Vite proxy `/auth/*` đến đây khi development. |
| Serverless Offline HTTP API | 3000 | Stage local là `dev`, nên API thường có tiền tố `/dev`. |
| Lambda internal của Serverless Offline | 3002 | Có thể thay đổi tùy phiên bản Serverless Offline. |
| Redis | 6379 | Docker Compose expose cổng này. |
| PostgreSQL | 5432 | Docker Compose expose cổng này. |

## 3. Yêu cầu máy

- Windows 10/11, Git và Node.js tương thích với `package.json`.
- npm.
- Docker Desktop nếu dùng Redis/PostgreSQL bằng Compose.
- PostgreSQL local nếu không dùng container.
- AWS CLI và IAM/profile riêng chỉ khi cần gọi S3, Textract, Bedrock hoặc Cognito thật.

Không cần AWS để build frontend hoặc chạy các test local được liệt kê ở phần 12.

## 4. Clone và cài dependencies

```powershell
git clone https://github.com/Khang140924/FinVantage.git
cd FinVantage
npm.cmd install
npm.cmd --prefix frontend install
```

Không chạy `npm audit fix` hoặc `npm audit fix --force` trong quy trình này. Script `npm test` hiện chưa được định nghĩa để chạy test suite; hãy dùng các lệnh cụ thể ở phần 12.

## 5. Chuẩn bị cấu hình riêng tư

### Dùng file mẫu

```powershell
Copy-Item .env.example .env
Copy-Item frontend\.env.example frontend\.env.local
```

Sửa `.env` bằng cấu hình riêng của bạn. Các biến frontend hiện dùng là:

```text
VITE_API_BASE_URL=http://localhost:3000/dev
```

Không có `VITE_AUTH_BASE_URL` trong mã hiện tại: Vite proxy `/auth/*` trực tiếp đến `http://localhost:4000` khi chạy development.

### Nhận file cấu hình nội bộ của nhóm

Nếu được cấp file `FinVantage-Team-PRIVATE.env` qua kênh riêng:

1. Sao chép file vào thư mục gốc FinVantage.
2. Đổi tên bản sao thành `.env`.
3. Không gửi file này lên GitHub, drive công khai hoặc nhóm chat công khai.
4. Không commit `.env` hay `frontend/.env.local`.

Kiểm tra trước khi làm việc với Git:

```powershell
git check-ignore -v .env
git check-ignore -v frontend/.env.local
git status --short
```

`.env.example` và `frontend/.env.example` là file mẫu duy nhất được phép theo dõi bởi Git.

### Các nhóm biến root `.env`

| Nhóm | Biến |
| --- | --- |
| App/Auth BFF | `NODE_ENV`, `AUTH_SERVER_PORT`, `SESSION_SECRET`, `USE_MOCK_AUTH`, `DEBUG` |
| Cognito | `COGNITO_ISSUER`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_DOMAIN`, `COGNITO_REDIRECT_URI`, `COGNITO_LOGOUT_URI`, `COGNITO_SCOPES` |
| AWS | `AWS_REGION`, `AWS_REGION_NAME`, `AWS_PROFILE`, `S3_RAW_BUCKET_NAME`, `S3_BUCKET_NAME`, `PROFILE_AVATAR_BUCKET_NAME`, `BEDROCK_MODEL_ID`, `USE_MOCK_AI`, `SNS_BUDGET_ALERTS_TOPIC_ARN` |
| Database/Redis | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `RDS_PROXY_ENDPOINT`, `REDIS_URL` |

Không đặt AWS access key/secret, Cognito client secret, session secret, password database hoặc token vào source code.

## 6. AWS profile (chỉ khi cần gọi AWS thật)

Khuyến nghị mỗi thành viên dùng profile AWS riêng thay vì đặt key trực tiếp trong file source:

```powershell
aws configure --profile finvantage-local-dev
$env:AWS_PROFILE = 'finvantage-local-dev'
$env:AWS_REGION = 'your_aws_region'
```

Bạn có thể tự xác minh profile bằng AWS CLI khi cần. Không chạy lệnh đó nếu chưa muốn gọi AWS. Nếu nghi ngờ credential đã lộ, thu hồi/rotate credential theo chính sách AWS của nhóm.

## 7. Chuẩn bị PostgreSQL và Redis

### Chạy bằng Docker Compose

Khởi động hai dependency local:

```powershell
docker compose up -d postgres redis
docker compose ps
docker compose exec redis redis-cli ping
```

Kết quả Redis mong đợi là `PONG`. Docker Compose hiện publish PostgreSQL ở cổng 5432 và Redis ở cổng 6379. Giá trị `DB_*` trong `.env` phải khớp với PostgreSQL local bạn đang sử dụng; không ghi password thật vào tài liệu hoặc Git.

Nếu đã có PostgreSQL local, chỉ chạy Redis:

```powershell
docker compose up -d redis
```

### Tạo database và schema

Tạo database `finvantage`, sau đó áp dụng schema:

```powershell
psql -h localhost -U <postgres_user> -d finvantage -f schema.sql
```

Nếu `psql` không nằm trong `PATH`, ví dụ với PostgreSQL 18:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' `
  -h localhost `
  -U <postgres_user> `
  -d finvantage `
  -f schema.sql
```

`schema.sql` tạo/migrate extension `pgcrypto` cùng các bảng `invoices`, `budgets`, `user_profiles`, `user_preferences` và `notifications`. Có thể chạy lại file trên database local hiện có vì các migration chính dùng điều kiện tồn tại; vẫn nên backup database quan trọng trước khi thay đổi schema.

## 8. Chạy hệ thống bằng bốn terminal

Mở mỗi terminal tại thư mục gốc FinVantage.

### Terminal 1 — Redis/PostgreSQL

```powershell
docker compose up -d postgres redis
docker compose exec redis redis-cli ping
```

### Terminal 2 — Backend API

```powershell
npm.cmd run api:dev
```

Backend Serverless Offline phục vụ API tại `http://localhost:3000/dev` khi stage là `dev`.

### Terminal 3 — Auth BFF

```powershell
npm.cmd run auth:dev
```

Auth BFF lắng nghe tại `http://localhost:4000`. Kiểm tra không chứa secret:

```powershell
Invoke-RestMethod http://localhost:4000/auth/health
```

### Terminal 4 — Frontend

```powershell
npm.cmd run frontend:dev
```

Mở `http://localhost:5174`. Vite đã cấu hình port 5174; nếu port đang bị chiếm, dừng tiến trình cũ trước khi chạy lại thay vì để Vite tự đổi sang port khác.

## 9. Xác thực: mock local và Cognito thật

### Mock auth local

Đặt trong root `.env`:

```text
NODE_ENV=development
USE_MOCK_AUTH=true
USE_MOCK_AI=true
```

Khi mock auth bật, Auth BFF không gọi `Issuer.discover`, không cần Cognito để đăng nhập và tạo session cho user development `mock-user`. `/auth/me` trả thông tin user mock; backend chỉ chấp nhận mock token khi `USE_MOCK_AUTH=true`.

Mock UI hỗ trợ signup, xác nhận email và quên/đặt lại mật khẩu để kiểm tra giao diện. Đây chỉ là luồng development, không lưu hay kiểm tra mật khẩu thật. Mã xác nhận development hiện tại là `123456`.

### Cognito thật

Đặt `USE_MOCK_AUTH=false`, điền đúng các biến Cognito và `SESSION_SECRET` trong `.env`, rồi khởi động lại Auth BFF. App client Cognito cần có:

- Allowed callback URL: `http://localhost:5174/auth/callback`.
- Allowed sign-out URL: `http://localhost:5174/`.
- OAuth scopes: `openid email profile`.
- Hosted/Managed Login và email verification/account recovery được cấu hình phù hợp.
- Nếu dùng form credential của BFF, bật flow `ALLOW_USER_PASSWORD_AUTH`; Managed Login vẫn là fallback.

Khi production, bắt buộc đặt `USE_MOCK_AUTH=false`, `NODE_ENV=production`, session secret ngẫu nhiên mạnh, callback/logout URL HTTPS thực và cấu hình reverse proxy/cùng origin phù hợp. Vite proxy chỉ là tiện ích development, không thay thế reverse proxy production.

## 10. Luồng upload hóa đơn

Luồng upload không đổi:

```text
Cognito hoặc mock dev
→ API import
→ S3 private
→ Textract AnalyzeExpense
→ Redis
→ Bedrock hoặc Mock AI
→ PostgreSQL
```

Các trạng thái pipeline là `UPLOADED`, `OCR_PROCESSING`, `OCR_FAILED`, `ANALYZING`, `ANALYZED` và `ANALYSIS_FAILED`. Không tạo hóa đơn PostgreSQL khi OCR không có kết quả hợp lệ hoặc không tìm được `TOTAL` hợp lệ.

Khi chọn JPG/JPEG/PNG, UI hiển thị preview lớn ngay trong khung upload; click ảnh mở lightbox và có thể đóng bằng nút đóng, click nền hoặc Escape. PDF chỉ hiển thị card file. Nút Clear bỏ file và thu hồi object URL preview, không upload tự động.

`USE_MOCK_AI=true` chỉ mock category/gợi ý; không thay vendor, tổng tiền, ngày giao dịch hay line items đã lấy từ Textract. Không chạy OCR upload thật nếu chưa chủ động cấu hình AWS/S3/Textract.

## 11. API local chính

Base URL local: `http://localhost:3000/dev`.

| Method | Path | Mục đích |
| --- | --- | --- |
| POST | `/invoices/import` | Tạo/nhận diện phiên import và presigned upload URL. |
| POST | `/invoices/{id}/ocr` | OCR local/test sau upload. |
| POST | `/invoices/{id}/analyze` | Phân tích OCR bằng Mock AI/Bedrock. |
| GET/PUT/DELETE | `/invoices/{id}` | Chi tiết, sửa, xóa giao dịch theo user đã xác thực. |
| GET | `/invoices/{id}/status` | Theo dõi trạng thái pipeline. |
| GET | `/invoices`, `/search`, `/dashboard-summary` | Giao dịch, tìm kiếm, Dashboard. |
| GET/POST/DELETE | `/budgets`, `/budgets/{id}` | Budget theo danh mục/tháng. |
| GET/PUT | `/me`, `/me/preferences` | Profile và preferences. |
| POST | `/me/avatar/upload-url` | Presigned S3 PUT URL avatar private. |
| GET/PUT/DELETE | `/notifications` và các endpoint unread/read | Notification center. |

Các endpoint user-scoped lấy `user_id` từ claim `sub`; client không được chọn `userId` tùy ý. Avatar lưu key S3 private dạng `avatars/{cognito-sub}/...`, còn database chỉ lưu key/URL, không lưu binary/base64.

## 12. Build và test an toàn tại local

### Build frontend và unit test thuần local

```powershell
npm.cmd --prefix frontend run build
node --test tests\frontendUiHelpers.test.js tests\itemNormalization.test.js tests\textractExpense.test.js
```

Các test trên không gửi request S3, Textract, Bedrock hay deploy AWS.

### Local integration test (cần PostgreSQL + Redis)

Khởi động PostgreSQL/Redis, áp dụng schema, sau đó ép mock mode trong terminal hiện tại:

```powershell
$env:USE_MOCK_AUTH = 'true'
$env:USE_MOCK_AI = 'true'
$env:SNS_BUDGET_ALERTS_TOPIC_ARN = ''

node tests\failurePipeline.integration.js
node tests\vendorOptionalPipeline.integration.js
node tests\search.integration.js
```

Các test integration này tạo và dọn fixture local. Chúng có thể tạo hồ sơ `mock-user` nếu chưa tồn tại.

Không chạy mặc định các lệnh sau vì chúng cần dữ liệu tồn tại hoặc có thể gọi AWS thật:

```powershell
node tests\phucLong.integration.js
node tests\checkPhucLongRecord.js
node tests\checkWinMartRecord.js
```

`phucLong.integration.js` có thể upload S3 và gọi Textract, vì vậy chỉ chạy khi chủ động muốn làm test AWS end-to-end và đã được cấp quyền/cost approval.

### Kiểm tra syntax

```powershell
node --check auth-server\index.js

Get-ChildItem -Recurse -File src,auth-server,tests,frontend\src |
  Where-Object { $_.Extension -in '.js', '.mjs', '.cjs' } |
  Sort-Object FullName |
  ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
```

JSX được kiểm tra qua `npm.cmd --prefix frontend run build`.

## 13. Kiểm tra cơ sở dữ liệu

Ví dụ xem hóa đơn mới nhất (không đưa password vào command):

```powershell
psql -h localhost -U <postgres_user> -d finvantage `
  -c 'SELECT id, store_name, total_amount, transaction_date, status, created_at FROM invoices ORDER BY created_at DESC LIMIT 10;'
```

Checklist UI sau khi local services hoạt động:

1. Đăng nhập mock hoặc Cognito theo mode đã chọn.
2. Mở Dashboard, Transactions, Budget & Alerts và Settings.
3. Mở notification menu: notification bình thường xanh, 80% budget vàng/cam, vượt budget/lỗi đỏ.
4. Chọn ảnh hóa đơn: kiểm tra preview lớn, lightbox và Clear.
5. Chỉ thực hiện upload OCR thật khi đã sẵn sàng gọi AWS.
6. Sau OCR/analyze thành công, kiểm tra Transactions/Dashboard không có record trùng.

## 14. Lỗi thường gặp

### Port bị chiếm

```powershell
Get-NetTCPConnection -LocalPort 3002 -State Listen | Select-Object LocalPort, OwningProcess
Get-NetTCPConnection -LocalPort 4000 -State Listen | Select-Object LocalPort, OwningProcess
Get-NetTCPConnection -LocalPort 5174 -State Listen | Select-Object LocalPort, OwningProcess
```

Xác minh đúng process trước khi dừng nó:

```powershell
Stop-Process -Id <PID> -Force
```

### Redis không phản hồi

```powershell
docker compose up -d redis
docker compose exec redis redis-cli ping
```

### Cognito redirect mismatch hoặc 401

Kiểm tra callback/sign-out URL trong App Client, restart Auth BFF sau khi thay đổi `.env`, sau đó logout/login lại. Không bật mock auth ở production để né lỗi JWT.

### S3 403, Textract lỗi hoặc `OCR_TOTAL_NOT_FOUND`

Kiểm tra IAM/profile, bucket private, CORS, region và file hóa đơn. `OCR_TOTAL_NOT_FOUND` nghĩa là Textract không cung cấp tổng tiền hợp lệ; hệ thống không dùng `CASH` hoặc `Change` thay thế tổng tiền.

## 15. Quy tắc bảo mật và Git

Tuyệt đối không commit:

```text
.env
frontend/.env.local
AWS access key / secret / session token
Cognito client secret
SESSION_SECRET
database password
node_modules/
frontend/node_modules/
frontend/dist/
.serverless/
*.log
uploads/
```

Trước khi commit, chạy:

```powershell
git diff --check
git status --short
git ls-files .env frontend/.env.local
git check-ignore -v .env frontend/.env.local
```

Hai lệnh `git ls-files` không được trả về `.env` hay `frontend/.env.local`. Không deploy AWS, không force push, và không đưa file private ngoài repository vào Git.
