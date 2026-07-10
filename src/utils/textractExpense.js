const addText = (parts, value) => {
  if (typeof value !== 'string') {
    return;
  }

  const text = value.replace(/\s+/g, ' ').trim();
  if (text) {
    parts.push(text);
  }
};

const addExpenseFieldText = (parts, field) => {
  const label = field?.LabelDetection?.Text || field?.Type?.Text;
  const value = field?.ValueDetection?.Text;

  if (label && value) {
    addText(parts, `${label}: ${value}`);
    return;
  }

  addText(parts, label);
  addText(parts, value);
};

export const extractRawTextFromExpenseDocuments = (expenseDocuments = []) => {
  const parts = [];
  const documents = Array.isArray(expenseDocuments) ? expenseDocuments : [];

  for (const document of documents) {
    for (const field of document?.SummaryFields || []) {
      addExpenseFieldText(parts, field);
    }

    for (const group of document?.LineItemGroups || []) {
      for (const lineItem of group?.LineItems || []) {
        for (const field of lineItem?.LineItemExpenseFields || []) {
          addExpenseFieldText(parts, field);
        }
      }
    }
  }

  return [...new Set(parts)].join('\n');
};

export const normalizeOcrCachePayload = ({
  invoiceId,
  fileKey,
  expenseDocuments = [],
  createdAt = new Date().toISOString()
}) => {
  const rawText = extractRawTextFromExpenseDocuments(expenseDocuments);

  return {
    invoiceId,
    rawText,
    raw_text: rawText,
    sourceFileKey: fileKey,
    source_file_key: fileKey,
    expenseDocuments,
    createdAt
  };
};
