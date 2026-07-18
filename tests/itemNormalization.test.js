import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLineItemName } from '../src/utils/itemNormalization.js';
import { extractRawTextFromExpenseDocuments, extractStructuredExpenseData } from '../src/utils/textractExpense.js';

const field = (type, value, confidence = 99) => ({
  Type: { Text: type },
  ValueDetection: { Text: value, Confidence: confidence },
});

test('normalizes the known Vinamilk OCR phrase without changing its amount or raw OCR', () => {
  const expenseDocuments = [{
    Blocks: [{ BlockType: 'LINE', Text: 'Sun tural Vinamilk IL 28,500' }],
    LineItemGroups: [{
      LineItems: [{ LineItemExpenseFields: [
        field('ITEM', 'Sun tural Vinamilk IL', 76),
        field('PRICE', '28,500', 99),
      ] }],
    }],
  }];

  const rawText = extractRawTextFromExpenseDocuments(expenseDocuments);
  const [item] = extractStructuredExpenseData(expenseDocuments).lineItems;

  assert.match(rawText, /Sun tural Vinamilk IL/);
  assert.equal(item.raw_item_name, 'Sun tural Vinamilk IL');
  assert.equal(item.normalized_item_name, 'Sữa tươi Vinamilk 1L');
  assert.equal(item.item, 'Sữa tươi Vinamilk 1L');
  assert.equal(item.total_price, 28500);
  assert.equal(item.price, 28500);
  assert.equal(item.confidence, 76);
  assert.equal(item.needs_review, true);
});

test('normalizes common 1L OCR tokens but leaves unrelated uncertain products unchanged', () => {
  assert.equal(normalizeLineItemName('Sữa tươi Vinamilk I L').normalizedItemName, 'Sữa tươi Vinamilk 1L');
  assert.equal(normalizeLineItemName('Sữa tươi Vinamilk lL').normalizedItemName, 'Sữa tươi Vinamilk 1L');

  const uncertain = normalizeLineItemName('Nước khoáng Vinamilk 1L');
  assert.equal(uncertain.normalizedItemName, 'Nước khoáng Vinamilk 1L');
  assert.equal(uncertain.changed, false);
});
