const stripDiacritics = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D');

export const normalizeUnicodeText = (value) => String(value || '')
  .normalize('NFC')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.;:!?])/g, '$1')
  .replace(/([,;:!?])(?=\S)/g, '$1 ')
  .trim();

export const toItemSearchKey = (value) => stripDiacritics(normalizeUnicodeText(value))
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const levenshteinDistance = (left, right) => {
  const a = String(left || '');
  const b = String(right || '');
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
};

export const tokenSimilarity = (left, right) => {
  const a = toItemSearchKey(left).replace(/\s+/g, '');
  const b = toItemSearchKey(right).replace(/\s+/g, '');
  if (!a || !b) return 0;
  return 1 - (levenshteinDistance(a, b) / Math.max(a.length, b.length));
};

// Add Vietnamese product rules here. A rule is only applied when all required
// brand tokens and the expected volume are present, then an alias is matched
// with sufficient confidence. This prevents broad, low-confidence rewrites.
export const PRODUCT_NAME_RULES = [
  {
    id: 'vinamilk-fresh-milk-1l',
    canonicalName: 'Sữa tươi Vinamilk 1L',
    requiredTokens: ['vinamilk'],
    volumeToken: '1l',
    aliases: ['sữa tươi', 'sua tuoi', 'sun tural'],
    minimumSimilarity: 0.72,
  },
];

const normalizeVolumeTokens = (value) => value.replace(/\b(?:I|i|l|1)\s*[lL]\b/g, '1L');

const findProductRule = (value) => {
  const searchKey = toItemSearchKey(value);
  const tokens = searchKey.split(' ').filter(Boolean);

  for (const rule of PRODUCT_NAME_RULES) {
    if (!rule.requiredTokens.every((token) => tokens.includes(token))) continue;
    if (rule.volumeToken && !tokens.includes(rule.volumeToken)) continue;

    const ignored = new Set([...rule.requiredTokens, rule.volumeToken].filter(Boolean));
    const descriptor = tokens.filter((token) => !ignored.has(token)).join(' ');
    let bestScore = 0;
    for (const alias of rule.aliases) {
      const aliasKey = toItemSearchKey(alias);
      const score = descriptor === aliasKey ? 1 : tokenSimilarity(descriptor, aliasKey);
      bestScore = Math.max(bestScore, score);
    }

    if (bestScore >= rule.minimumSimilarity) return { rule, score: bestScore };
  }

  return null;
};

export const normalizeLineItemName = (rawName) => {
  // Preserve the Textract value as the raw audit field. Only NFC and outer
  // whitespace are safe here; punctuation/spacing cleanup belongs exclusively
  // to normalized_item_name.
  const rawItemName = String(rawName || '').normalize('NFC').trim();
  if (!rawItemName) {
    return {
      rawItemName: null,
      normalizedItemName: null,
      changed: false,
      needsReview: false,
      normalizationConfidence: null,
      normalizationRule: null,
    };
  }

  const volumeNormalized = normalizeVolumeTokens(normalizeUnicodeText(rawItemName));
  const match = findProductRule(volumeNormalized);
  const normalizedItemName = match?.rule.canonicalName || volumeNormalized;
  const changed = normalizedItemName !== rawItemName;

  return {
    rawItemName,
    normalizedItemName,
    changed,
    needsReview: changed,
    normalizationConfidence: match ? Number(match.score.toFixed(2)) : (changed ? 0.9 : null),
    normalizationRule: match?.rule.id || (changed ? 'volume-token' : null),
  };
};

export const enrichStoredLineItems = (lineItems = []) => (
  Array.isArray(lineItems) ? lineItems.map((lineItem = {}) => {
    const rawName = lineItem.raw_item_name ?? lineItem.rawItemName ?? lineItem.item ?? null;
    const normalization = normalizeLineItemName(rawName);
    const existingNormalizedName = normalizeUnicodeText(
      lineItem.normalized_item_name ?? lineItem.normalizedItemName ?? ''
    );
    const normalizedItemName = lineItem.user_verified && existingNormalizedName
      ? existingNormalizedName
      : normalization.normalizedItemName;
    const totalPrice = lineItem.total_price ?? lineItem.totalPrice ?? lineItem.price ?? null;
    const confidenceValue = lineItem.confidence == null ? null : Number(lineItem.confidence);
    const confidence = Number.isFinite(confidenceValue) ? confidenceValue : null;
    const normalizationChanged = lineItem.user_verified
      ? normalizedItemName !== normalization.rawItemName
      : normalization.changed;

    return {
      ...lineItem,
      item: normalizedItemName || normalization.rawItemName,
      price: totalPrice,
      raw_item_name: normalization.rawItemName,
      normalized_item_name: normalizedItemName,
      quantity: lineItem.quantity ?? null,
      unit_price: lineItem.unit_price ?? lineItem.unitPrice ?? null,
      total_price: totalPrice,
      confidence,
      normalization_changed: Boolean(normalizationChanged),
      normalization_confidence: lineItem.normalization_confidence ?? normalization.normalizationConfidence,
      normalization_rule: lineItem.normalization_rule ?? normalization.normalizationRule,
      needs_review: lineItem.user_verified
        ? false
        : Boolean(lineItem.needs_review ?? (normalizationChanged || (confidence !== null && confidence < 80))),
    };
  }) : []
);
