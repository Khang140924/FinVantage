import { GetObjectCommand, HeadObjectCommand, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getInvoiceUploadIdentity } from '../utils/invoice.js';

// Khởi tạo S3 Client cho các tác vụ tương tác với Amazon S3
export const s3Client = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_REGION_NAME || 'ap-southeast-1'
});

export const buildInvoiceUploadIdentity = (fileName, { userId, contentSha256 } = {}) => {
  const cleanFileName = String(fileName || '').replace(/\s+/g, '_');
  const safeUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  const stablePart = /^[a-f0-9]{64}$/i.test(contentSha256 || '')
    ? String(contentSha256).toLowerCase()
    : String(Date.now());
  const fileKey = `uploads/${safeUserId}/${stablePart}_${cleanFileName.slice(-120)}`;
  const bucketName = process.env.S3_RAW_BUCKET_NAME || process.env.S3_BUCKET_NAME || 'finvantage-raw-invoices-dev';
  const { invoiceId, cacheKey } = getInvoiceUploadIdentity(fileKey);
  return { bucketName, fileKey, invoiceId, cacheKey };
};

export const signInvoiceUploadUrl = async (
  identity,
  contentType,
  { fileSize = null, signer = getSignedUrl, client = s3Client } = {}
) => {
  const command = new PutObjectCommand({
    Bucket: identity.bucketName,
    Key: identity.fileKey,
    ContentType: contentType,
    ...(Number.isSafeInteger(fileSize) && fileSize > 0 ? { ContentLength: fileSize } : {})
  });
  return signer(client, command, { expiresIn: 300 });
};

/**
 * Sinh ra một presigned URL (đường dẫn liên kết được ký trước) để tải tệp lên trực tiếp từ frontend
 * @param {string} fileName - Tên của tệp tin hóa đơn
 * @param {string} contentType - Kiểu nội dung của tệp tin (ví dụ: application/pdf, image/png)
 * @returns {Promise<{uploadUrl: string, fileKey: string, invoiceId: string, cacheKey: string}>} - Trả về đường dẫn tải lên và thông tin OCR cache
 */
export const generateUploadUrl = async (fileName, contentType, { userId, contentSha256, fileSize } = {}) => {
  const identity = buildInvoiceUploadIdentity(fileName, { userId, contentSha256 });
  const uploadUrl = await signInvoiceUploadUrl(identity, contentType, { fileSize });

  return {
    uploadUrl,
    fileKey: identity.fileKey,
    invoiceId: identity.invoiceId,
    cacheKey: identity.cacheKey
  };
};

const getAvatarBucket = () => process.env.PROFILE_AVATAR_BUCKET_NAME || process.env.S3_RAW_BUCKET_NAME || process.env.S3_BUCKET_NAME;

export const generateAvatarUploadUrl = async (userId, fileName, contentType) => {
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '-');
  const avatarKey = `avatars/${safeUserId}/avatar-${Date.now()}.${extension}`;
  const bucketName = getAvatarBucket();
  if (!bucketName) throw new Error('PROFILE_AVATAR_BUCKET_NAME is not configured.');
  const uploadUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: bucketName,
    Key: avatarKey,
    ContentType: contentType,
    ServerSideEncryption: 'AES256'
  }), { expiresIn: 300 });
  return { uploadUrl, avatarKey };
};

export const generateAvatarReadUrl = async (avatarKey) => {
  if (!avatarKey) return null;
  const bucketName = getAvatarBucket();
  if (!bucketName) return null;
  if (process.env.USE_MOCK_AUTH === 'true' && !process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) return null;
  return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucketName, Key: avatarKey }), { expiresIn: 3600 });
};

export const verifyAvatarObject = async (avatarKey) => {
  if (process.env.USE_MOCK_AUTH === 'true') return { developmentSkipped: true };
  const bucketName = getAvatarBucket();
  if (!bucketName) throw new Error('PROFILE_AVATAR_BUCKET_NAME is not configured.');
  const metadata = await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: avatarKey }));
  if (!['image/jpeg', 'image/png'].includes(metadata.ContentType)) throw new Error('Uploaded avatar has an invalid content type.');
  if (!Number.isFinite(metadata.ContentLength) || metadata.ContentLength <= 0 || metadata.ContentLength > 2 * 1024 * 1024) throw new Error('Uploaded avatar exceeds the 2 MB limit.');
  return metadata;
};

