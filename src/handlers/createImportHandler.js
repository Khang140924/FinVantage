import * as response from '../utils/response.js';
import { classifyAwsError, sanitizedAwsLogError } from '../utils/awsError.js';
import { validateInvoiceUploadRequest } from '../utils/invoiceUploadValidation.js';

const publicIdentity = (identity) => ({
  invoiceId: identity.invoiceId,
  fileKey: identity.fileKey,
  cacheKey: identity.cacheKey
});

export const createImportHandler = ({
  authenticate,
  buildUploadIdentity,
  signUploadUrl,
  findInvoice,
  getCachedInvoice,
  cacheUpload,
  log
}) => async (event = {}) => {
  const auth = await authenticate(event);
  if (auth.error) return auth.error;
  let currentStage = 'IMPORT_PREPARE';

  try {
    log.info('Nhận yêu cầu sinh presigned URL để nhập hóa đơn', {
      event: { path: event.path, httpMethod: event.httpMethod }
    });
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      log.error('Lỗi khi phân tích cú pháp request body JSON', parseError);
      return response.badRequest('Cấu trúc JSON trong request body không hợp lệ.');
    }
    const validation = validateInvoiceUploadRequest(body);
    if (!validation.valid) return response.badRequest(validation.message);

    const { fileName, contentType, fileSize } = validation.value;
    const { contentSha256 } = body;
    if (contentSha256 && !/^[a-f0-9]{64}$/i.test(contentSha256)) {
      return response.badRequest('contentSha256 phải là chuỗi SHA-256 gồm 64 ký tự hexadecimal.');
    }

    const identity = buildUploadIdentity(fileName, { userId: auth.user.sub, contentSha256 });
    const identityPayload = publicIdentity(identity);
    const existingInvoice = await findInvoice(identity.invoiceId, auth.user.sub);
    if (existingInvoice?.status === 'ANALYZED' || existingInvoice?.status === 'PAID') {
      return response.success({
        message: 'Hóa đơn này đã được phân tích trước đó.',
        ...identityPayload,
        status: 'ANALYZED',
        progress: 100,
        existing: true,
        uploadRequired: false,
        uploadConfirmed: true
      });
    }

    const cachedInvoice = await getCachedInvoice(identity.cacheKey);
    if (cachedInvoice && String(cachedInvoice.userId || auth.user.sub) === String(auth.user.sub)) {
      const cachedStatus = cachedInvoice.status || 'UPLOAD_PENDING';
      const uploadConfirmed = Boolean(cachedInvoice.uploadConfirmed);
      const uploadRequired = !uploadConfirmed && ['UPLOAD_PENDING', 'UPLOADED'].includes(cachedStatus);
      const progressValue = Number(cachedInvoice.progress);
      const payload = {
        message: 'Tiếp tục trạng thái xử lý của hóa đơn đã nhập.',
        ...identityPayload,
        status: uploadRequired ? 'UPLOAD_PENDING' : cachedStatus,
        progress: uploadRequired ? 0 : (Number.isFinite(progressValue) ? progressValue : 0),
        warning: cachedInvoice.warning || null,
        error: cachedInvoice.errorCode
          ? { code: cachedInvoice.errorCode, message: cachedInvoice.errorMessage }
          : null,
        existing: true,
        uploadRequired,
        uploadConfirmed
      };
      if (uploadRequired) {
        currentStage = 'IMPORT_PRESIGN';
        payload.uploadUrl = await signUploadUrl(identity, contentType, { fileSize });
        payload.expiresIn = 300;
      }
      return response.success(payload);
    }

    currentStage = 'IMPORT_PRESIGN';
    const uploadUrl = await signUploadUrl(identity, contentType, { fileSize });
    currentStage = 'IMPORT_CACHE';
    const now = new Date().toISOString();
    await cacheUpload(identity.cacheKey, {
      invoiceId: identity.invoiceId,
      userId: auth.user.sub,
      fileKey: identity.fileKey,
      sourceFileKey: identity.fileKey,
      source_file_key: identity.fileKey,
      status: 'UPLOAD_PENDING',
      progress: 0,
      uploadConfirmed: false,
      fileSize,
      createdAt: now,
      updatedAt: now
    }, 3600);

    log.info('Sinh presigned URL thành công', {
      fileKey: identity.fileKey,
      invoiceId: identity.invoiceId,
      cacheKey: identity.cacheKey,
      userId: auth.user.sub
    });
    return response.success({
      message: 'Sinh đường dẫn tải lên (upload presigned URL) thành công!',
      ...identityPayload,
      uploadUrl,
      expiresIn: 300,
      status: 'UPLOAD_PENDING',
      progress: 0,
      existing: false,
      uploadRequired: true,
      uploadConfirmed: false
    });
  } catch (error) {
    const awsFailure = classifyAwsError(error);
    log.error('Lỗi khi chuẩn bị nhập hóa đơn', sanitizedAwsLogError(error, awsFailure), {
      userId: auth.user.sub,
      stage: currentStage,
      failureCode: awsFailure?.code
    });
    if (awsFailure) {
      return response.sendResponse(awsFailure.statusCode, {
        error: awsFailure.error,
        code: awsFailure.code,
        message: awsFailure.message,
        stage: currentStage,
        retryable: awsFailure.retryable
      });
    }
    return response.serverError('Đã xảy ra lỗi hệ thống khi xử lý yêu cầu.');
  }
};
