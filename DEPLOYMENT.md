# Triển khai FinVantage lên AWS production

Tài liệu này mô tả quy trình triển khai có kiểm soát cho kiến trúc production hiện tại:

`Amplify Hosting → API Gateway → Lambda → RDS Proxy/PostgreSQL + ElastiCache Valkey`

Các Lambda nghiệp vụ tiếp tục dùng execution role của workload để gọi S3 và Textract. Riêng Bedrock dùng STS `AssumeRole` sang role ở tài khoản AWS đích. Auth BFF chạy trong Lambda, giữ session ở Valkey và được frontend gọi qua đường dẫn cùng origin `/auth/*`.

Không chạy lệnh tạo, cập nhật hoặc xóa tài nguyên trong tài liệu này nếu chưa có phê duyệt thay đổi, cửa sổ triển khai, ngân sách và kế hoạch rollback. Không đưa secret vào Git, Vite, command history, log CI hoặc output hỗ trợ.

## 1. Điều kiện tiên quyết

- Node.js 24 và npm 11.
- AWS CLI v2; quyền triển khai CloudFormation, Serverless, Lambda, API Gateway, IAM, S3 notification, CloudWatch và các tài nguyên dữ liệu trong phạm vi được duyệt.
- Serverless Framework v4. CLI v4 cần đăng nhập hoặc `SERVERLESS_ACCESS_KEY`, đồng thời tài khoản/tổ chức phải đáp ứng điều khoản license hiện hành. Lưu access key này trong secret của CI, không đặt trong file env hoặc source.
- Một VPC có ít nhất hai private subnet ở các Availability Zone khác nhau.
- Đường ra HTTPS từ private subnet. Lambda cần gọi Cognito/OIDC, STS, Secrets Manager, S3, Textract, Bedrock và các API AWS liên quan. Dùng NAT/egress được kiểm soát hoặc VPC endpoint ở những dịch vụ có hỗ trợ; không giả định private subnet tự truy cập được Internet. Luồng Cognito/OIDC công khai thường vẫn cần NAT/egress.
- Hai S3 bucket private, hoặc một bucket private dùng chung, đã bật Block Public Access: bucket hóa đơn và bucket avatar. Tên bucket phải duy nhất toàn cầu và cùng region với trigger Lambda nếu dùng S3 event hiện tại.
- Một S3 deployment bucket private đã tồn tại cho `SERVERLESS_DEPLOYMENT_BUCKET`; template dữ liệu không tạo bucket này. Bucket invoice dùng `existing: true` cũng phải tồn tại trước khi deploy.
- Cognito user pool, app client và domain đã được chuẩn bị. Callback/logout tạm thời có thể cập nhật sau khi Amplify cấp domain.
- Tài khoản Bedrock đích đã bật quyền truy cập model hoặc inference profile được chọn. Không phụ thuộc cứng vào model mặc định; production luôn đặt `BEDROCK_MODEL_ID` rõ ràng.

Các file dùng cho triển khai:

| Mục đích | File |
| --- | --- |
| RDS, RDS Proxy, Secrets Manager, Valkey và security group | `infra/finvantage-production.yml` |
| Bộ tham số mẫu không chứa secret | `infra/production-parameters.example.json` |
| Backend Serverless | `serverless.yml` |
| Kiểm tra cấu hình production | `scripts/validate-production.js` |
| Migration có ledger/checksum/lock | `scripts/migrate.js`, `scripts/migrationRunner.js` |
| Amplify build | `amplify.yml` |
| Biến frontend public mẫu | `frontend/.env.production.example` |
| Rewrite Auth và SPA mẫu | `infra/amplify-rewrites.example.json` |

## 2. Provision lớp dữ liệu private

Sao chép file tham số mẫu sang một file triển khai không commit, rồi thay toàn bộ placeholder. Chọn ít nhất hai private subnet khác AZ. Giữ `DatabaseDeletionProtection=true` cho production; cân nhắc Multi-AZ và hai Valkey node khi cần khả năng chịu lỗi.

Lệnh tham khảo sau chỉ là hướng dẫn, không được chạy trong bước chuẩn bị mã này:

```powershell
aws cloudformation validate-template `
  --template-body file://infra/finvantage-production.yml

aws cloudformation deploy `
  --template-file infra/finvantage-production.yml `
  --stack-name <DATA_STACK_NAME> `
  --parameter-overrides file://<PRIVATE_PARAMETER_FILE> `
  --capabilities CAPABILITY_NAMED_IAM `
  --no-fail-on-empty-changeset
```

Template tạo:

- PostgreSQL RDS mã hóa, không public, backup và deletion protection theo tham số;
- database credential sinh ngẫu nhiên trong Secrets Manager;
- RDS Proxy bắt buộc TLS và dùng database secret;
- ElastiCache Valkey mã hóa in-transit/at-rest, dùng auth token sinh trong Secrets Manager;
- security group chỉ cho Lambda → RDS Proxy:5432, RDS Proxy → RDS:5432 và Lambda → Valkey:6379;
- Lambda security group có egress HTTPS:443 để đi qua NAT hoặc endpoint phù hợp.

Ghi lại **tên output**, không chép secret value vào ticket hoặc log:

| CloudFormation output | Biến/công dụng |
| --- | --- |
| `RdsProxyEndpoint` | `RDS_PROXY_ENDPOINT` |
| `DatabaseSecretArn` | `DB_SECRET_ARN` của application role ít quyền |
| `DatabaseAdminSecretArn` | `DB_ADMIN_SECRET_ARN`, chỉ dùng cho migration/bootstrap one-off |
| `DatabaseEndpoint` | Chỉ quản trị có kiểm soát; runtime không dùng trực tiếp |
| `ValkeyPrimaryEndpoint`, `ValkeyPort` | Dùng để tạo `REDIS_URL` bảo mật |
| `ValkeyAuthSecretArn` | Vị trí auth token; không in token |
| `LambdaSecurityGroupId` | `LAMBDA_SECURITY_GROUP_IDS` |
| `PrivateSubnetIds` | `PRIVATE_SUBNET_IDS` |

### Quản lý secret

Template tự tạo hai database secret tách biệt: admin/owner cho migration và bootstrap, application role ít quyền cho Lambda. Backend đọc application secret tại runtime qua `DB_SECRET_ARN`; production validator từ chối `DB_USER`/`DB_PASSWORD`. Không gán `DatabaseAdminSecretArn` cho Lambda ứng dụng.

Tạo `REDIS_URL` trong môi trường bí mật của pipeline theo dạng `rediss://:<URL_ENCODED_TOKEN>@<VALKEY_ENDPOINT>:6379`. Không chạy lệnh làm token xuất hiện trên màn hình. `AUTH_SESSION_REDIS_URL` có thể dùng một endpoint/credential riêng; nếu bỏ trống, Auth dùng `REDIS_URL`. Namespace/key prefix vẫn tách auth session và pipeline.

Các giá trị sau cũng là secret và phải nằm trong Secrets Manager hoặc secret store của CI/CD: `SESSION_SECRET`, `COGNITO_CLIENT_SECRET`, `REDIS_URL`, `AUTH_SESSION_REDIS_URL` nếu có, `BEDROCK_EXTERNAL_ID` nếu tổ chức coi External ID là nhạy cảm, cùng `SERVERLESS_ACCESS_KEY`. Có thể đặt `APP_SECRET_ARN` trỏ tới JSON có key `sessionSecret` và `cognitoClientSecret`, cùng `REDIS_URL_SECRET_ARN` trỏ tới JSON có key `redisUrl`; Serverless đưa CloudFormation dynamic reference vào Lambda thay vì resolve giá trị trong output CI. Nếu không dùng hai ARN này, chỉ materialize secret vào process triển khai bằng cơ chế không ghi log. Không đặt bất kỳ secret nào trong `VITE_*`.

Nếu dùng customer-managed KMS key, cấu hình ARN tương ứng và cấp `kms:Decrypt` tối thiểu cho role cần đọc secret. Xoay secret cần có quy trình phối hợp với RDS Proxy, Valkey và phiên người dùng; đổi `SESSION_SECRET` sẽ làm các session hiện tại mất hiệu lực.

## 3. Chạy migration một lần trong VPC

Migration không nằm trong Lambda artifact chính. Chạy runner từ một one-off CodeBuild/ECS task hoặc host quản trị qua SSM/VPN trong cùng VPC; không mở RDS ra Internet. Job cần kết nối được RDS Proxy, đọc `DB_ADMIN_SECRET_ARN`, có CA tin cậy và dùng `DB_SSL=true`. Runner tự ưu tiên admin secret khi biến này tồn tại; Lambda ứng dụng chỉ nhận `DB_SECRET_ARN` ít quyền.

Runner:

- tạo ledger `schema_migrations`;
- kiểm tra checksum và thứ tự file;
- dùng PostgreSQL advisory lock để ngăn hai job cùng chạy;
- chạy từng migration trong transaction;
- từ chối remote/production database nếu thiếu cờ xác nhận rõ ràng.

Trước hết kiểm tra file SQL mà không kết nối database:

```powershell
npm ci
npm run db:validate
npm run db:migrate:baseline:plan
```

Sau snapshot/backup và change approval, kiểm tra trạng thái từ job trong VPC:

```powershell
npm run db:migrate:status -- --confirm-production=FINVANTAGE_PRODUCTION
```

Với database **mới, trống**, chỉ sau khi xác nhận đúng endpoint/secret, chạy baseline và toàn bộ migration:

```powershell
node scripts/migrate.js `
  --apply `
  --baseline `
  --confirm-apply=FINVANTAGE_MIGRATION `
  --confirm-production=FINVANTAGE_PRODUCTION
```

Sau khi schema đã hoàn tất, tạo/cập nhật application role từ hai secret bằng job one-off có cùng kết nối private. Script không in username/password và chỉ cấp CONNECT, USAGE cùng quyền CRUD/sequence trên schema `public`:

```powershell
npm run db:bootstrap-user -- `
  --apply `
  --confirm-bootstrap=FINVANTAGE_DB_USER_BOOTSTRAP `
  --confirm-production=FINVANTAGE_PRODUCTION
```

Job bootstrap cần cả `DB_ADMIN_SECRET_ARN` và `DB_SECRET_ARN`. Chạy lại sau khi rotate application secret để đồng bộ password PostgreSQL; không cấp admin secret cho runtime Lambda.

Với database **đã có schema/dữ liệu**, không tự thêm `--baseline`. DBA phải đối chiếu schema, ledger và migration plan trước, rồi mới chạy:

```powershell
npm run db:migrate -- `
  --confirm-apply=FINVANTAGE_MIGRATION `
  --confirm-production=FINVANTAGE_PRODUCTION
```

Chạy lại status sau khi hoàn tất. Nếu có `checksum-drift`, `running`, `failed` hoặc `missing-file`, dừng; không sửa ledger thủ công và không chạy lại mù quáng. Không rollback DDL bằng cách chạy SQL ngược chưa được duyệt; ưu tiên forward-fix hoặc phục hồi snapshot theo kế hoạch sự cố.

## 4. Cấu hình backend production

Production validator từ chối mock, localhost, placeholder, Redis không TLS, database không TLS, profile Bedrock và network config thiếu. Cấu hình các tên biến sau trong secret-aware deploy environment.

### Bắt buộc

| Nhóm | Biến |
| --- | --- |
| Runtime | `NODE_ENV=production`, `AWS_REGION_NAME`, `SERVERLESS_DEPLOYMENT_BUCKET`, `LOG_LEVEL` |
| Feature guard | `USE_MOCK_AUTH=false`, `USE_MOCK_AI=false` |
| S3 | `S3_RAW_BUCKET_NAME`, `S3_BUCKET_NAME`, `PROFILE_AVATAR_BUCKET_NAME` |
| Public origin | `API_ALLOWED_ORIGIN` là đúng một HTTPS origin Amplify/custom domain, không có path |
| Cognito/Auth | `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_ISSUER`, `COGNITO_DOMAIN`, `COGNITO_REDIRECT_URI`, `COGNITO_LOGOUT_URI`; dùng `APP_SECRET_ARN` hoặc cả `COGNITO_CLIENT_SECRET` và `SESSION_SECRET` |
| Database | `RDS_PROXY_ENDPOINT`, `DB_PORT=5432`, `DB_NAME`, `DB_SECRET_ARN`, `DB_SSL=true`; Lambda mặc định dùng `NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem` |
| Redis/Valkey | dùng `REDIS_URL_SECRET_ARN` hoặc `REDIS_URL` dạng `rediss://`; luôn đặt `REDIS_KEY_PREFIX` |
| Bedrock cross-account | `BEDROCK_AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_ROLE_ARN` |
| VPC | `PRIVATE_SUBNET_IDS` có ít nhất hai ID, `LAMBDA_SECURITY_GROUP_IDS` có ít nhất một ID |

### Tùy chọn hoặc có default an toàn

- Auth: `COGNITO_SCOPES`, `AUTH_SESSION_REDIS_URL`, `AUTH_SESSION_TTL_SECONDS`.
- Database: `DB_SECRET_REGION`, `DB_SSL_CA_BASE64`, `NODE_EXTRA_CA_CERTS`, `DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TRANSACTION_TIMEOUT_MS`. Chỉ thay `/var/runtime/ca-cert.pem` khi đóng gói CA bundle tin cậy riêng; không dùng `rejectUnauthorized=false`.
- Redis: `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`, `REDIS_MAX_RECONNECT_ATTEMPTS`, `REDIS_RECONNECT_BASE_DELAY_MS`, `REDIS_RECONNECT_MAX_DELAY_MS`.
- Bedrock: `BEDROCK_ROLE_SESSION_NAME`, `BEDROCK_EXTERNAL_ID`.
- AWS/secrets: `SNS_BUDGET_ALERTS_TOPIC_ARN`, `KMS_KEY_ARN`, `LOG_RETENTION_DAYS`, `APP_SECRET_ARN`, `REDIS_URL_SECRET_ARN` theo lựa chọn ở bảng bắt buộc.

Không đặt `AWS_PROFILE` hoặc `BEDROCK_AWS_PROFILE` trong Lambda. Named profile chỉ dành cho local. Trong production, riêng Bedrock dùng `BEDROCK_ROLE_ARN`; S3 và Textract tiếp tục dùng default credential chain từ Lambda execution role.

Chạy các kiểm tra không deploy:

```powershell
npm ci
npm run syntax:check
npm test
npm run frontend:build
npm run production:validate
npm run serverless:print:prod
npm run serverless:package:prod
```

Kiểm tra `.serverless` không chứa frontend source, test, migrations, env files hoặc tài liệu; không commit artifact. `serverless print` có thể hiển thị cấu hình đã resolve, vì vậy chỉ chạy trong terminal/CI có output được bảo vệ và không đính kèm output chứa secret vào báo cáo.

Khi đã được phê duyệt triển khai:

```powershell
npx serverless deploy --stage prod
```

Backend deploy trước khi siết trust policy Bedrock để ARN execution role nguồn đã tồn tại. Không gọi endpoint AI cho đến khi bước Bedrock bên dưới hoàn tất.

## 5. IAM tối thiểu và Bedrock cross-account

Execution role nghiệp vụ cần đúng phạm vi sau:

- CloudWatch Logs;
- `s3:GetObject`/`s3:PutObject` trên `uploads/*` của bucket hóa đơn và `avatars/*` của bucket avatar;
- `textract:AnalyzeExpense`;
- `secretsmanager:GetSecretValue` trên đúng `DB_SECRET_ARN`;
- `sts:AssumeRole` trên đúng `BEDROCK_ROLE_ARN`;
- `sns:Publish` chỉ trên topic đã cấu hình, nếu bật;
- `kms:Decrypt` chỉ trên key đã cấu hình, nếu cần;
- quyền ENI bắt buộc cho Lambda trong VPC.

Auth Lambda dùng role riêng cho CloudWatch Logs và ENI. Luồng hiện tại gọi Cognito user-facing APIs, không dùng Cognito admin APIs; không cấp rộng `cognito-idp:*` nếu chưa có use case được duyệt.

Sau backend deploy, lấy output `AnalysisLambdaExecutionRoleArn` của stack Serverless; đây là ARN duy nhất dùng bởi Lambda phân tích hóa đơn. Không dùng ARN user/profile local. Ở tài khoản Bedrock đích:

1. Trust policy của `BEDROCK_ROLE_ARN` chỉ cho đúng source execution-role ARN gọi `sts:AssumeRole`.
2. Nếu dùng `BEDROCK_EXTERNAL_ID`, đặt cùng giá trị ở cả trust condition và backend secret config.
3. Permission policy chỉ cho `bedrock:InvokeModel` trên model/inference-profile ARN thực sự dùng. Với cross-region inference profile, thêm chính xác inference profile và các foundation-model resource mà AWS yêu cầu; tránh `Resource: "*"` nếu không bắt buộc.
4. Không cấp S3, Textract, database hoặc Cognito cho role Bedrock đích.
5. CloudTrail ở hai tài khoản phải ghi nhận `AssumeRole`/`InvokeModel`; log ứng dụng chỉ ghi error code an toàn, không ghi credentials, token hoặc raw provider error.

Thứ tự credential trong code là: `USE_MOCK_AI=true` → không khởi tạo/gọi AWS; nếu không mock và có `BEDROCK_AWS_PROFILE` → profile local; nếu không có profile và có `BEDROCK_ROLE_ARN` → STS temporary credentials; nếu không có cả hai → default AWS credential chain. Production validator cấm profile và bắt buộc role ARN.

## 6. CORS API và S3

`API_ALLOWED_ORIGIN` phải bằng chính xác origin public, ví dụ dạng `https://<AMPLIFY_DOMAIN>` hoặc custom domain; không dùng `*`, không thêm dấu `/` cuối hoặc path. Cấu hình Serverless áp dụng origin này cho API và API Gateway 4xx/5xx. Auth đi qua same-origin rewrite nên cookie không cần mở credential CORS cho origin tùy ý.

Vì trình duyệt PUT trực tiếp vào presigned S3 URL, cấu hình CORS trên từng bucket liên quan. Ví dụ chính sách tối thiểu, thay placeholder trước khi áp dụng:

```json
[
  {
    "AllowedOrigins": ["https://<AMPLIFY_DOMAIN>"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Giữ Block Public Access, encryption, lifecycle và bucket policy private. Kiểm tra S3 notification `uploads/` không xung đột với notification khác; `existing: true` trong Serverless không có nghĩa là an toàn ghi đè cấu hình notification đang được workload khác quản lý.

## 7. Amplify Hosting và Auth rewrite

Kết nối repository/branch với Amplify Hosting, đặt `AMPLIFY_MONOREPO_APP_ROOT=frontend`. `amplify.yml` dùng monorepo root `frontend`, Node 24, `npm ci`, `npm run build` và publish `frontend/dist`. Build production fail-fast nếu thiếu/sai hai biến public bên dưới.

Chỉ đặt hai biến build public:

```dotenv
VITE_AUTH_MODE=cognito
VITE_API_BASE_URL=https://<API_ID>.execute-api.<AWS_REGION>.amazonaws.com/prod
```

Không đặt Cognito client secret, session secret, AWS credential hoặc database/Redis secret trong `VITE_*`.

Trong Amplify **Rewrites and redirects**, dựa trên `infra/amplify-rewrites.example.json`, thay API target rồi giữ đúng thứ tự:

1. `/auth` → `<API_BASE_URL>/auth` với status `200`;
2. `/auth/<*>` → `<API_BASE_URL>/auth/<*>` với status `200`;
3. SPA fallback regex → `/index.html` với status `200`.

Hai rewrite `/auth` phải đứng trước fallback, nếu không `/auth/callback`, `/auth/me` và logout sẽ bị trả `index.html`. Kiểm tra reverse proxy bảo toàn `Set-Cookie`, `Cookie`, query string và redirect `Location`; cookie production phải có `Secure`, `HttpOnly`, `SameSite=Lax`.

## 8. Cập nhật Cognito callback/logout

Khi đã có domain Amplify/custom domain ổn định, cập nhật app client bằng URL chính xác:

- Allowed callback URL: `https://<PUBLIC_DOMAIN>/auth/callback`;
- Allowed sign-out URL và `COGNITO_LOGOUT_URI`: `https://<PUBLIC_DOMAIN>/`;
- `COGNITO_REDIRECT_URI`: cùng callback URL ở trên;
- `COGNITO_DOMAIN`: HTTPS domain Managed Login của user pool;
- OAuth flow: authorization code; scopes tối thiểu `openid email profile`.

Sau đó cập nhật backend environment và redeploy backend nếu giá trị thay đổi. Cognito yêu cầu callback/logout khớp chính xác; khác scheme, host, path hoặc slash có thể làm login/logout thất bại.

## 9. Smoke test sau triển khai

Thực hiện bằng một user test riêng, không dùng dữ liệu/credential cá nhân:

1. CloudFormation stack ổn định; RDS Proxy target healthy; Valkey reachable từ Lambda security group.
2. Migration status không còn `pending`, `failed`, `running` hoặc `checksum-drift`.
3. `GET /auth/health` trả JSON sẵn sàng; `/auth/config` không lộ secret.
4. Login qua Cognito, callback về đúng public origin, refresh trang vẫn giữ session; `/auth/me` hoạt động qua nhiều Lambda invocation; logout xóa session.
5. Preflight từ đúng `API_ALLOWED_ORIGIN` thành công; origin không được phép không được phản chiếu.
6. GET danh sách giao dịch và Dashboard chỉ trả dữ liệu của user hiện tại.
7. Presigned upload chấp nhận một file test nhỏ từ origin production; bucket vẫn private. Chỉ chạy Textract/Bedrock smoke test khi đã phê duyệt chi phí.
8. Một request AI dùng đúng model cấu hình và tạo CloudTrail `AssumeRole`/`InvokeModel`; S3/Textract không dùng role Bedrock.
9. CloudWatch không có lỗi cold-start, timeout, Redis reconnect kéo dài hoặc PostgreSQL connection exhaustion; log không chứa token, cookie, secret, raw AWS credential hay stack trace trả về frontend.
10. Kiểm tra deep link frontend, đặc biệt `/transactions`, và toàn bộ `/auth/*` không bị SPA fallback bắt nhầm.

Đặt CloudWatch alarm tối thiểu cho Lambda errors/throttles/duration, API Gateway 5xx, RDS CPU/storage/connections, RDS Proxy availability, Valkey memory/evictions/connections và chi phí bất thường.

## 10. Rollback, cleanup và chi phí

### Rollback

- Frontend: redeploy build Amplify tốt gần nhất.
- Backend: rollback về Serverless/CloudFormation artifact đã kiểm chứng hoặc redeploy Git revision tốt gần nhất. Giữ nguyên env/secret đúng version; không log chúng khi đối chiếu.
- Database: không tự động rollback migration. Dùng forward-fix; chỉ phục hồi snapshot khi có phê duyệt và chấp nhận mất dữ liệu sau thời điểm snapshot.
- Bedrock: có thể vô hiệu hóa riêng luồng AI bằng thay đổi được duyệt; production validator không cho chuyển sang mock để che lỗi cấu hình.
- Cognito: giữ lại callback URL của phiên bản đang phục vụ cho đến khi rollback hoàn tất.

### Cleanup có kiểm soát

- Template bật deletion protection và snapshot cho RDS; muốn xóa phải có phê duyệt riêng, tắt protection có chủ đích và xác nhận snapshot cuối.
- RDS/Valkey secret, CloudWatch log, S3 object/version và Amplify artifact có vòng đời riêng; xóa stack không bảo đảm mọi dữ liệu đã bị xóa.
- Không xóa bucket chứa hóa đơn/avatar hoặc Cognito user pool chỉ để rollback application.

### Nguồn chi phí cần theo dõi

- RDS instance/storage/backup và RDS Proxy theo giờ;
- Valkey node/snapshot;
- NAT Gateway theo giờ và data processing, thường là chi phí cố định đáng kể của demo nhỏ;
- Secrets Manager, CloudWatch Logs/alarms;
- Amplify build/hosting/data transfer;
- API Gateway/Lambda;
- S3 request/storage/data transfer, Textract và Bedrock theo lượt sử dụng.

Gắn tag owner/environment/cost-center, thiết lập AWS Budget và cảnh báo trước khi mở website công khai. Demo chi phí thấp có thể dùng một RDS instance và một Valkey node, nhưng sẽ không có HA; không bỏ Valkey vì auth session và pipeline production đang phụ thuộc persistent Redis.

## 11. Thứ tự triển khai chuẩn

- [ ] 1. RDS: duyệt VPC/subnet/security group, backup, encryption, retention và deletion protection.
- [ ] 2. Secrets: xác nhận database/Valkey secret được tạo, quyền đọc tối thiểu và quy trình rotation.
- [ ] 3. RDS Proxy + Valkey: target healthy, TLS và private connectivity hoạt động; chạy one-off migration trong VPC.
- [ ] 4. Backend: cấu hình production, validate, package/inspect rồi deploy API/Lambda; chưa smoke-test AI.
- [ ] 5. Bedrock role: siết trust vào đúng source Lambda execution role, optional External ID và model resource tối thiểu.
- [ ] 6. Frontend: cấu hình hai `VITE_*`, build/deploy Amplify, đặt `/auth` rewrites trước SPA fallback.
- [ ] 7. Cognito callback/logout: cập nhật sang public domain chính xác rồi cập nhật/redeploy backend nếu cần.
- [ ] 8. Kiểm thử: auth/session, CRUD, CORS, S3, migration status, CloudWatch; chỉ chạy Textract/Bedrock khi đã duyệt chi phí.
- [ ] 9. Vận hành: alarm, Budget, tags, runbook rollback, owner và lịch review secret/cost.
