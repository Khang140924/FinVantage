import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
const DEFAULT_REGION = 'ap-southeast-1';
export const VALID_CATEGORIES = [
  'Ăn uống',
  'Mua sắm',
  'Di chuyển',
  'Giải trí',
  'Hóa đơn',
  'Sức khỏe',
  'Giáo dục',
  'Khác'
];

const getBedrockRegion = () => (
  process.env.AWS_REGION || process.env.AWS_REGION_NAME || DEFAULT_REGION
);

const toRawText = (rawText) => (
  typeof rawText === 'string' ? rawText : JSON.stringify(rawText ?? '', null, 2)
);

export const bedrockClient = new BedrockRuntimeClient({ region: getBedrockRegion() });

export const safeParseJson = (text) => {
  if (!text) return null;
  if (typeof text === 'object') return text;

  const raw = String(text).trim();
  const candidates = [
    raw,
    raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim(),
    raw.replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  ];
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape returned by the model.
    }
  }
  return null;
};

export const normalizeInvoiceResult = (data = {}) => {
  const category = VALID_CATEGORIES.includes(data.category) ? data.category : 'Khác';
  const advice = data.ai_advice || data.AIAdvice || data.FinancialAdvice;
  return {
    category,
    ai_advice: typeof advice === 'string' && advice.trim()
      ? advice.trim()
      : 'Hãy theo dõi khoản chi này trong ngân sách tháng để kiểm soát chi tiêu tốt hơn.'
  };
};

const inferMockCategory = (rawText) => {
  const text = toRawText(rawText).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const rules = [
    ['Ăn uống', /PHUC LONG|COFFEE|CAFE|TEA|JUICE|BROWNIE|RESTAURANT|FOOD|BANH|COM|PHO/],
    ['Di chuyển', /TAXI|GRAB|BUS|PARKING|XANG|PETROL|FUEL|TRANSPORT/],
    ['Mua sắm', /SUPERMARKET|SHOP|STORE|MART|MARKET|CLOTHING/],
    ['Giải trí', /CINEMA|MOVIE|GAME|KARAOKE|ENTERTAINMENT/],
    ['Hóa đơn', /ELECTRIC|WATER|INTERNET|UTILITY|BILL/],
    ['Sức khỏe', /HOSPITAL|PHARMACY|CLINIC|MEDICINE/],
    ['Giáo dục', /SCHOOL|UNIVERSITY|TUITION|COURSE|BOOK/]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || 'Khác';
};

const buildPrompt = (rawText) => `Bạn là trợ lý AI phân loại hóa đơn cho quản lý chi tiêu cá nhân.

Dữ liệu OCR thật từ Amazon Textract:
${toRawText(rawText)}

Chỉ trả về một object JSON hợp lệ, không markdown:
{
  "category": "string",
  "ai_advice": "string"
}

Quy tắc:
- category chỉ được chọn một trong: ${VALID_CATEGORIES.join(', ')}.
- ai_advice bằng tiếng Việt và tập trung vào quản lý chi tiêu.
- Không trả về hoặc suy đoán store_name, total_amount, transaction_date hay line_items; các trường đó do Textract quyết định.`;

export const analyzeInvoiceWithBedrock = async (rawText, context = {}) => {
  if (!String(toRawText(rawText)).trim()) throw new Error('OCR raw_text is required before AI analysis.');

  if (process.env.USE_MOCK_AI === 'true') {
    const category = inferMockCategory(rawText);
    const amount = Number(context.totalAmount);
    const amountText = Number.isFinite(amount) && amount > 0
      ? `${amount.toLocaleString('vi-VN')} VNĐ `
      : '';
    return normalizeInvoiceResult({
      category,
      ai_advice: `Khoản chi ${amountText}được xếp vào danh mục ${category}. Bạn có thể đặt ngân sách ${category.toLowerCase()} hàng tháng để theo dõi chi tiêu.`
    });
  }

  const command = new InvokeModelCommand({
    modelId: process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 500,
      temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(rawText) }] }]
    })
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const parsedResult = safeParseJson(responseBody?.content?.[0]?.text);
  if (!parsedResult) throw new Error('Amazon Bedrock response is not valid invoice JSON.');
  return normalizeInvoiceResult(parsedResult);
};

// Backward-compatible wrapper. Structured financial fields intentionally stay
// null because they must come from Textract, never from AI.
export const analyzeInvoiceWithAI = async (rawText) => {
  const result = await analyzeInvoiceWithBedrock(rawText);
  return {
    VendorName: null,
    TotalAmount: null,
    TaxAmount: null,
    Date: null,
    category: result.category,
    FinancialAdvice: result.ai_advice
  };
};
