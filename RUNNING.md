# Huong Dan Chay FinVantage

## 1. Tong quan project

FinVantage gom backend Serverless Node.js va frontend React.

Frontend hien co cac man hinh:

- Dashboard
- Upload Invoice
- Analysis Result
- Transactions
- Budget & Alerts
- Settings

Backend co cac API chinh:

- Import invoice
- OCR
- Analyze
- Invoices list
- Dashboard summary
- Invoice detail, update and delete
- Category budgets and budget alerts
- User profile and preferences
- S3 avatar upload

## 2. Yeu cau moi truong

- Node.js
- npm
- PostgreSQL local
- Redis Docker hoac Redis local
- AWS CLI chi can neu muon test S3/Textract that
- Docker Desktop chi can neu dung Redis Docker

## 3. Cai dependencies

Root:

```bash
npm install
```

Frontend:

```bash
cd frontend
npm install
```

## 4. Cau hinh backend `.env`

Khong commit `.env`. Tao file `.env` dua theo `.env.example`.

Bien chinh:

```text
AWS_REGION
AWS_REGION_NAME
S3_RAW_BUCKET_NAME
S3_BUCKET_NAME
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
DB_SSL
REDIS_URL
USE_MOCK_AI
USE_MOCK_AUTH
NODE_ENV
```

## 5. Cau hinh frontend

Tao `frontend/.env.local`:

```text
VITE_API_BASE_URL=http://localhost:3000/dev
```

## 6. Tao database PostgreSQL

Tao database `finvantage`, sau do chay `schema.sql`. Co the chay lai file nay tren database cu; cac lenh migration su dung `IF NOT EXISTS` va se giu du lieu hien tai.

Vi du Windows:

```powershell
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres -d finvantage -f schema.sql
```

## 7. Chay Redis

Neu dung Docker:

```bash
docker start finvantage-redis
docker exec finvantage-redis redis-cli ping
```

Ket qua mong doi:

```text
PONG
```

## 8. Chay backend local

```bash
npm run api:dev
```

## 8b. Chay Auth BFF (AWS Cognito) local

Auth chay nhu mot Backend-for-Frontend (BFF) bang Express + openid-client + express-session.
Server lang nghe port 4000, xu ly OIDC Authorization Code Flow voi Cognito (confidential client).

```bash
npm run auth:dev
```

Trinh duyet SPA (Vite, port 5174) se proxy `/auth/*` sang BFF nay (xem `frontend/vite.config.js`).

### Mock auth local (khong can Cognito)

Dat trong `.env` root:

```text
USE_MOCK_AUTH=true
NODE_ENV=development
COGNITO_LOGOUT_URI=http://localhost:5174/
```

Sau do chay:

```bash
npm run auth:dev
npm run api:dev
npm run frontend:dev
```

Voi mock mode, Auth BFF khong goi `Issuer.discover` va khong can cac bien
`COGNITO_ISSUER`, `COGNITO_CLIENT_ID` hay `COGNITO_CLIENT_SECRET`. Dang nhap
development se tao session cho user `mock-user`; `/auth/me` tra mock token cho
SPA. Backend chi chap nhan token nay khi `USE_MOCK_AUTH=true`. `NODE_ENV=development`
khong tu dong mo mock auth, vi vay local Cognito voi `USE_MOCK_AUTH=false` van chi
chap nhan JWT Cognito.

Mock mode ho tro UI login, signup, verify email va forgot/reset password de test
giao dien. Ma xac nhan development la `123456`. Mock mode khong luu hoac kiem
tra mat khau that. FinVantage khong co tab doi mat khau rieng; production dung
Cognito Managed Login cho cac thao tac tai khoan va khoi phuc mat khau.

## 13. Cau hinh AWS Cognito

Tao User Pool tai `ap-southeast-2` (hoac region cua ban) va App Client kieu
**confidential** (co client secret). Cap nhat `.env` (root) theo `.env.example`:

```text
COGNITO_ISSUER
COGNITO_USER_POOL_ID
COGNITO_CLIENT_ID
COGNITO_CLIENT_SECRET
COGNITO_DOMAIN
COGNITO_REDIRECT_URI
COGNITO_LOGOUT_URI
SESSION_SECRET
```

Trong Cognito App Client, them:

- Allowed Callback URL: `http://localhost:5174/auth/callback`
- Allowed Sign-out URL: `http://localhost:5174/`
- OAuth scopes: `openid email profile`
- Hosted UI: bat va thiet lap domain (`COGNITO_DOMAIN`)
- Authentication flow: bat `ALLOW_USER_PASSWORD_AUTH` de form FinVantage co the
  dang nhap qua BFF. Neu chua bat flow nay, nguoi dung van co the chon Hosted UI fallback.
- Bat email attribute, automatic email verification va account recovery bang email.

Production phai dat:

```text
NODE_ENV=production
USE_MOCK_AUTH=false
SESSION_SECRET=<random-secret>
```

Mat khau dang ky/dang nhap/doi/reset chi duoc Cognito xu ly. PostgreSQL khong co
cot password va khong luu password hoac ma xac nhan.

Luong dang nhap: SPA -> `/auth/login` (BFF) -> Cognito Hosted UI -> redirect
`/auth/callback` (BFF verify, luu session, tra id_token) -> SPA goi `/auth/me`
de lay token, luu vao localStorage va gui kem header `Authorization: Bearer`
cho cac API serverless. Khi reload, `/auth/me` khoi phuc user tu session BFF va
refresh token neu id token sap het han. Backend xac thuc id_token qua JWKS
(`src/utils/cognitoAuth.js`). Khi logout, BFF xoa session truoc khi redirect qua
Cognito `/logout`.

Neu chi muon chay local ma khong can Cognito that, dung huong dan Mock auth local o tren.

Luu y: du lieu hoa don cu co `user_id = 'demo-user'` se khong hien thi voi
tai khoan Cognito moi (sub khac). Hay seed lai du lieu hoac dung `USE_MOCK_AUTH`.


## 9. Chay frontend local

```bash
npm run frontend:dev
```

## 10. API local

```text
POST http://localhost:3000/dev/invoices/import
POST http://localhost:3000/dev/invoices/{id}/ocr
POST http://localhost:3000/dev/invoices/{id}/analyze
GET  http://localhost:3000/dev/invoices
GET  http://localhost:3000/dev/invoices/{id}
GET  http://localhost:3000/dev/invoices/{id}/status
PUT  http://localhost:3000/dev/invoices/{id}
DELETE http://localhost:3000/dev/invoices/{id}
GET  http://localhost:3000/dev/dashboard-summary
GET  http://localhost:3000/dev/budgets
POST http://localhost:3000/dev/budgets
DELETE http://localhost:3000/dev/budgets/{id}
GET  http://localhost:3000/dev/me
PUT  http://localhost:3000/dev/me
GET  http://localhost:3000/dev/me/preferences
PUT  http://localhost:3000/dev/me/preferences
POST http://localhost:3000/dev/me/avatar/upload-url
GET  http://localhost:3000/dev/notifications
GET  http://localhost:3000/dev/notifications/unread-count
PUT  http://localhost:3000/dev/notifications/{id}/read
PUT  http://localhost:3000/dev/notifications/read-all
DELETE http://localhost:3000/dev/notifications/{id}
```

Tat ca API `/me` lay `user_id` tu claim `sub` cua token. Gia tri `userId` trong
request body (neu co) bi bo qua.

Payload cap nhat giao dich (`PUT /invoices/{id}`) co the gom:

```json
{
  "storeName": "Highlands Coffee",
  "totalAmount": 132840,
  "category": "An uong",
  "transactionDate": "2026-07-16",
  "status": "ANALYZED"
}
```

Payload tao/cap nhat ngan sach theo danh muc (`POST /budgets`):

```json
{
  "category": "An uong",
  "amount": 3000000
}
```

Ngan sach la theo thang hien tai va unique theo `(user_id, category, budget_month)`.
Backend cong cac invoice cung danh muc trong thang, sau do tra `spent`, `limit`,
`remaining`, `percentage` va `status`. Nguong trang thai: duoi 80% `normal`,
80-99% `warning`, tu 100% `exceeded`.

Danh muc hop le:

```text
An uong, Di chuyen, Mua sam, Giai tri, Hoa don, Suc khoe, Giao duc, Khac
```

Web notification duoc luu trong PostgreSQL. Cac su kien budget 80%/100% dung
`dedupe_key` theo budget va thang de khong tao lap. Phan tich invoice thanh cong
hoac that bai cung tao notification rieng.

Dashboard, Transactions va Budget & Alerts chi hien thi du lieu backend that. Neu API loi, giao dien se hien thong bao loi thay vi tu dong doi sang mock data.

## 11. Luu y ve AWS that

- Neu chi chay Dashboard/Transactions tu database local thi khong can AWS.
- Upload OCR that can AWS S3 + Textract + credentials hop le.
- `USE_MOCK_AI=true` nghia la khong goi Bedrock that.
- `USE_MOCK_AI=false` moi goi Bedrock that.

## 11b. Trien khai account services tren AWS

- API profile/preferences duoc khai bao bang HTTP events trong `serverless.yml`,
  do do di qua API Gateway va Lambda.
- Aurora/PostgreSQL production phai dat `RDS_PROXY_ENDPOINT` bang endpoint cua
  RDS Proxy. Local development de trong bien nay va dung `DB_HOST`.
- Chay `schema.sql` de tao `user_profiles` va `user_preferences` truoc khi goi API.
- Dat `PROFILE_AVATAR_BUCKET_NAME` den S3 bucket private danh cho avatar. UI va
  Lambda chi chap nhan JPG/JPEG/PNG toi da 2 MB. Object key co dang
  `avatars/{cognito-sub}/avatar-{timestamp}.jpg|png`; database chi luu
  `avatar_key`, khong luu binary/base64. `GET /me` tra presigned GET URL khi AWS
  credentials san sang; neu local khong co credentials, profile van tra thanh
  cong va avatar URL la `null`.
- Frontend xin presigned PUT URL qua `POST /me/avatar/upload-url`, upload truc
  tiep den S3 va sau do goi `PUT /me` de luu key. AWS credentials khong bao gio
  duoc gui den browser. Bucket khong can va khong duoc bat public access.
- Dat `SNS_BUDGET_ALERTS_TOPIC_ARN` den SNS topic production. Lambda phat event
  sau khi invoice da luu thanh cong va chi khi user bat `email_alerts` va
  `budget_guardrails`. Loi SNS khong rollback invoice.
- Neu dung mot SNS topic chung, subscription email phai co filter policy theo
  message attribute `userId` (va co the them `eventType`) de khong gui canh bao
  cua user nay cho user khac.
- Khong bat `USE_MOCK_AUTH` tren production. Mock token chi hop le khi
  `USE_MOCK_AUTH=true`; `NODE_ENV=development` khong du de cho phep mock token.

## 12. Khong commit cac file/thu muc

```text
.env
node_modules/
frontend/node_modules/
frontend/dist/
serverless-offline*.log
```
## Luồng hóa đơn thật và kiểm thử Phúc Long

Luồng upload hiện dùng cùng một `invoiceId` cho cùng người dùng và cùng checksum file, vì vậy thử lại không tạo bản ghi trùng:

`Cognito/mock dev → API import → S3 private → Textract AnalyzeExpense → Redis → Bedrock/mock AI → PostgreSQL`

Trạng thái xử lý trong Redis: `UPLOADED`, `OCR_PROCESSING`, `OCR_FAILED`, `ANALYZING`, `ANALYZED`, `ANALYSIS_FAILED`. PostgreSQL chỉ nhận hóa đơn sau khi OCR có `ExpenseDocuments`, `raw_text` và `TOTAL` hợp lệ. `VENDOR_NAME` không bắt buộc; nếu thiếu hoặc chỉ là tiêu đề chung như `PHIẾU THANH TOÁN`, `TOTAL`, `BILL`, hệ thống lưu `Không xác định`, trả warning `OCR_VENDOR_NOT_FOUND` và vẫn tiếp tục phân tích.

- `OCR_EMPTY_RESULT`: Textract không trả tài liệu hoặc văn bản OCR rỗng.
- `OCR_TOTAL_NOT_FOUND`: không có `TOTAL` hợp lệ trong `SummaryFields`; `CASH` và `Change` không được dùng thay thế.

## OCR line item normalization, search va currency

`raw_text` va `raw_item_name` luon giu nguyen ket qua Textract. Moi line item moi
co them `normalized_item_name`, `quantity`, `unit_price`, `total_price`,
`confidence`, `normalization_changed` va `needs_review`. Dictionary/rule mo rong
nam trong `src/utils/itemNormalization.js`. Ten da normalize chi dung de hien thi
va tim kiem; sua ten mon qua `PUT /invoices/{id}` chi cap nhat `line_items`, khong
cap nhat raw OCR, gia hoac so luong.

Global search dung `GET /search?q=...`, toi da 20 ket qua. Lambda luon lay
`user_id` tu Cognito token, truy van PostgreSQL bang parameter va khong tra
`raw_text`, S3 key hoac du lieu ky thuat trong ket qua.

He thong hien tai chua cau hinh nguon ty gia tin cay, vi vay VND la display
currency duy nhat. Settings khong hien thi bo chon don vi tien te; backend van
giu cac cot `invoices.currency` va `user_profiles.default_currency` cho giai doan
co exchange-rate snapshot sau nay.

UI co ErrorBoundary cho loi render khong du kien. Cac loi API upload/OCR/analyze
du kien duoc bat ngay tren trang Upload, giu file da chon va hien thi dung buoc
bi loi. Frontend goi `GET /invoices/{id}/status` moi 1,5 giay khi request timeout
hoac mat ket noi, chi dieu huong den `/analysis/{invoiceId}` sau khi backend tra
`ANALYZED`; trang ket qua tu tai lai du lieu bang invoice ID nen khong can F5.

Chạy kiểm thử parser và lỗi không lưu database:

```powershell
node --test tests\textractExpense.test.js
node tests\failurePipeline.integration.js
node tests\vendorOptionalPipeline.integration.js
```

Kiểm thử tích hợp thật với `bill.jpg` (cần AWS credentials, S3 bucket, Textract, Redis và PostgreSQL):

```powershell
$env:BILL_PATH='C:\duong-dan\bill.jpg'
node tests\phucLong.integration.js
node tests\checkPhucLongRecord.js
```

Trang kết quả có URL `/analysis/{invoiceId}` và luôn gọi `GET /invoices/{invoiceId}`. Vì vậy tải lại trang không phụ thuộc `location.state` hoặc bộ nhớ React.
