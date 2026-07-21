import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_INVOICE_FILE_SIZE,
  validateInvoiceUploadRequest
} from '../src/utils/invoiceUploadValidation.js';

test('invoice upload validation accepts each allowlisted extension and matching MIME', () => {
  for (const [fileName, contentType] of [
    ['bill.jpg', 'image/jpeg'],
    ['bill.jpeg', 'image/jpg'],
    ['bill.png', 'image/png'],
    ['bill.heic', 'image/heic'],
    ['bill.pdf', 'application/pdf']
  ]) {
    const result = validateInvoiceUploadRequest({ fileName, contentType, fileSize: 1024 });
    assert.equal(result.valid, true, `${fileName} should be accepted`);
  }
});

test('invoice upload validation rejects unsupported and mismatched file types', () => {
  assert.equal(validateInvoiceUploadRequest({ fileName: 'bill.exe', contentType: 'application/octet-stream' }).valid, false);
  assert.equal(validateInvoiceUploadRequest({ fileName: 'bill.jpg', contentType: 'application/pdf' }).valid, false);
  assert.equal(validateInvoiceUploadRequest({ fileName: '../bill.pdf', contentType: 'application/pdf' }).valid, false);
});

test('optional file size must be positive and no larger than 10 MB', () => {
  assert.equal(validateInvoiceUploadRequest({ fileName: 'bill.pdf', contentType: 'application/pdf' }).valid, true);
  assert.equal(validateInvoiceUploadRequest({ fileName: 'bill.pdf', contentType: 'application/pdf', fileSize: MAX_INVOICE_FILE_SIZE }).valid, true);
  assert.equal(validateInvoiceUploadRequest({ fileName: 'bill.pdf', contentType: 'application/pdf', fileSize: 0 }).valid, false);
  assert.equal(validateInvoiceUploadRequest({ fileName: 'bill.pdf', contentType: 'application/pdf', fileSize: MAX_INVOICE_FILE_SIZE + 1 }).valid, false);
});
