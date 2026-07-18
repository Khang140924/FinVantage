import assert from 'node:assert/strict';
import test from 'node:test';
import { getNotificationTone } from '../frontend/src/utils/notificationTone.js';
import { createImagePreview, isPdfFile, isPreviewableImage } from '../frontend/src/utils/uploadPreview.js';

test('notification tones distinguish errors, budget thresholds and normal updates', () => {
  assert.equal(getNotificationTone({ type: 'INVOICE_FAILED' }), 'danger');
  assert.equal(getNotificationTone({ type: 'BUDGET_EXCEEDED' }), 'danger');
  assert.equal(getNotificationTone({ type: 'BUDGET_WARNING' }), 'warning');
  assert.equal(getNotificationTone({ title: 'Đã đạt 80% ngân sách' }), 'warning');
  assert.equal(getNotificationTone({ type: 'INVOICE_ANALYZED' }), 'success');
});

test('image previews create and revoke one object URL while PDFs use a file card', () => {
  const image = { name: 'receipt.jpg', type: 'image/jpeg' };
  const pdf = { name: 'receipt.pdf', type: 'application/pdf' };
  const revoked = [];
  const fakeUrlApi = {
    createObjectURL: (file) => `blob:${file.name}`,
    revokeObjectURL: (url) => revoked.push(url),
  };

  assert.equal(isPreviewableImage(image), true);
  assert.equal(isPreviewableImage(pdf), false);
  assert.equal(isPdfFile(pdf), true);

  const preview = createImagePreview(image, fakeUrlApi);
  assert.equal(preview.url, 'blob:receipt.jpg');
  preview.revoke();
  assert.deepEqual(revoked, ['blob:receipt.jpg']);
});
