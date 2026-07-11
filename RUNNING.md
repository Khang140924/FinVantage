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
```

## 5. Cau hinh frontend

Tao `frontend/.env.local`:

```text
VITE_API_BASE_URL=http://localhost:3000/dev
```

## 6. Tao database PostgreSQL

Tao database `finvantage`, sau do chay `schema.sql`.

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
GET  http://localhost:3000/dev/dashboard-summary
```

## 11. Luu y ve AWS that

- Neu chi chay Dashboard/Transactions tu database local thi khong can AWS.
- Upload OCR that can AWS S3 + Textract + credentials hop le.
- `USE_MOCK_AI=true` nghia la khong goi Bedrock that.
- `USE_MOCK_AI=false` moi goi Bedrock that.

## 12. Khong commit cac file/thu muc

```text
.env
node_modules/
frontend/node_modules/
frontend/dist/
serverless-offline*.log
```
