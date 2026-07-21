import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromIni, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import {
  EXPENSE_CATEGORY_VALUES,
  normalizeExpenseCategory
} from '../../shared/expenseCategories.js';

const DEFAULT_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';
const DEFAULT_REGION = 'ap-southeast-1';
const DEFAULT_ROLE_SESSION_NAME = 'finvantage-bedrock';
const MAX_MODEL_RESPONSE_LENGTH = 100_000;
export const VALID_CATEGORIES = EXPENSE_CATEGORY_VALUES;

const BEDROCK_ERROR_DEFINITIONS = Object.freeze({
  BEDROCK_INPUT_INVALID: {
    statusCode: 400,
    message: 'Dữ liệu OCR không hợp lệ để phân tích AI.',
    retryable: false
  },
  BEDROCK_CONFIGURATION_INVALID: {
    statusCode: 500,
    message: 'Cấu hình Amazon Bedrock không hợp lệ.',
    retryable: false
  },
  BEDROCK_PROFILE_UNAVAILABLE: {
    statusCode: 503,
    message: 'Không thể nạp AWS profile dành cho Amazon Bedrock.',
    retryable: false
  },
  BEDROCK_CREDENTIALS_UNAVAILABLE: {
    statusCode: 503,
    message: 'Backend không thể nạp AWS credentials cho Amazon Bedrock.',
    retryable: false
  },
  BEDROCK_ASSUME_ROLE_ACCESS_DENIED: {
    statusCode: 403,
    message: 'Backend không được phép sử dụng Bedrock role đã cấu hình.',
    retryable: false
  },
  BEDROCK_ASSUME_ROLE_FAILED: {
    statusCode: 503,
    message: 'Backend không thể sử dụng Bedrock role đã cấu hình.',
    retryable: true
  },
  BEDROCK_ACCESS_DENIED: {
    statusCode: 403,
    message: 'Backend không được phép gọi model Amazon Bedrock này.',
    retryable: false
  },
  BEDROCK_THROTTLED: {
    statusCode: 429,
    message: 'Amazon Bedrock đang giới hạn tốc độ yêu cầu. Vui lòng thử lại sau.',
    retryable: true
  },
  BEDROCK_VALIDATION_FAILED: {
    statusCode: 400,
    message: 'Amazon Bedrock từ chối yêu cầu phân tích không hợp lệ.',
    retryable: false
  },
  BEDROCK_MODEL_UNAVAILABLE: {
    statusCode: 503,
    message: 'Model Amazon Bedrock đã cấu hình hiện không khả dụng.',
    retryable: true
  },
  BEDROCK_SERVICE_UNAVAILABLE: {
    statusCode: 503,
    message: 'Amazon Bedrock tạm thời không khả dụng.',
    retryable: true
  },
  BEDROCK_INVALID_RESPONSE: {
    statusCode: 502,
    message: 'Amazon Bedrock trả về kết quả phân tích không hợp lệ.',
    retryable: false
  },
  BEDROCK_REQUEST_FAILED: {
    statusCode: 502,
    message: 'Không thể hoàn tất yêu cầu Amazon Bedrock.',
    retryable: false
  }
});

export class BedrockServiceError extends Error {
  constructor(code, options = {}) {
    const definition = BEDROCK_ERROR_DEFINITIONS[code]
      || BEDROCK_ERROR_DEFINITIONS.BEDROCK_REQUEST_FAILED;
    super(definition.message);
    this.name = 'BedrockServiceError';
    this.code = BEDROCK_ERROR_DEFINITIONS[code] ? code : 'BEDROCK_REQUEST_FAILED';
    this.statusCode = definition.statusCode;
    this.retryable = definition.retryable;
    this.awsService = options.awsService || 'bedrock';
  }
}

const isMockAiEnabled = (env = process.env) => (
  String(env.USE_MOCK_AI || '').trim().toLowerCase() === 'true'
);

const createBedrockError = (code, options) => new BedrockServiceError(code, options);

const errorCode = (error = {}) => String(error.name || error.code || error.Code || '');
const errorMessage = (error = {}) => String(error.message || '');
const matchesError = (error, codes, pattern) => (
  codes.includes(errorCode(error)) || pattern?.test(errorMessage(error))
);

export const toBedrockServiceError = (error, { credentialSource = null } = {}) => {
  if (error instanceof BedrockServiceError) return error;

  const accessDenied = matchesError(
    error,
    ['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation'],
    /access denied|not authorized to perform/i
  );

  if (credentialSource === 'role') {
    return createBedrockError(
      accessDenied ? 'BEDROCK_ASSUME_ROLE_ACCESS_DENIED' : 'BEDROCK_ASSUME_ROLE_FAILED',
      { awsService: 'sts' }
    );
  }

  if (credentialSource === 'profile') {
    return createBedrockError('BEDROCK_PROFILE_UNAVAILABLE', { awsService: 'credentials' });
  }

  if (accessDenied) return createBedrockError('BEDROCK_ACCESS_DENIED');
  if (matchesError(
    error,
    [
      'CredentialsProviderError',
      'CredentialProviderError',
      'UnrecognizedClientException',
      'InvalidClientTokenId',
      'InvalidSignatureException',
      'ExpiredToken',
      'ExpiredTokenException'
    ],
    /could not load credentials|missing credentials|security token.*invalid|token.*expired/i
  )) return createBedrockError('BEDROCK_CREDENTIALS_UNAVAILABLE', { awsService: 'credentials' });
  if (matchesError(
    error,
    ['ThrottlingException', 'TooManyRequestsException', 'ServiceQuotaExceededException'],
    /throttl|too many requests|rate exceeded/i
  )) return createBedrockError('BEDROCK_THROTTLED');
  if (matchesError(
    error,
    ['ValidationException', 'InvalidRequestException'],
    /validation exception|invalid request/i
  )) return createBedrockError('BEDROCK_VALIDATION_FAILED');
  if (matchesError(
    error,
    ['ResourceNotFoundException', 'ModelNotReadyException', 'ModelTimeoutException'],
    /model.*(?:not found|not ready|unavailable|timeout)/i
  )) return createBedrockError('BEDROCK_MODEL_UNAVAILABLE');
  if (matchesError(
    error,
    ['ServiceUnavailableException', 'InternalServerException'],
    /service unavailable|temporarily unavailable/i
  )) return createBedrockError('BEDROCK_SERVICE_UNAVAILABLE');

  return createBedrockError('BEDROCK_REQUEST_FAILED');
};

export const getBedrockRegion = (env = process.env) => (
  String(
    env.BEDROCK_AWS_REGION || env.AWS_REGION || env.AWS_REGION_NAME || DEFAULT_REGION
  ).trim()
);

export const getBedrockModelId = (env = process.env) => (
  String(env.BEDROCK_MODEL_ID || '').trim() || DEFAULT_MODEL_ID
);

const validateBedrockRegion = (region) => {
  if (!/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region)) {
    throw createBedrockError('BEDROCK_CONFIGURATION_INVALID');
  }
};

const getBedrockRoleOptions = (env) => {
  const roleArn = String(env.BEDROCK_ROLE_ARN || '').trim();
  const roleSessionName = String(env.BEDROCK_ROLE_SESSION_NAME || '').trim()
    || DEFAULT_ROLE_SESSION_NAME;
  const externalId = String(env.BEDROCK_EXTERNAL_ID || '').trim();

  if (!roleArn) return { roleArn, roleSessionName, externalId };
  if (roleArn && !/^arn:(?:aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]+$/.test(roleArn)) {
    throw createBedrockError('BEDROCK_CONFIGURATION_INVALID');
  }
  if (!/^[A-Za-z0-9_+=,.@-]{2,64}$/.test(roleSessionName)) {
    throw createBedrockError('BEDROCK_CONFIGURATION_INVALID');
  }
  if (externalId && (
    externalId.length < 2
    || externalId.length > 1224
    || !/^[A-Za-z0-9_+=,.@:\/-]+$/.test(externalId)
  )) throw createBedrockError('BEDROCK_CONFIGURATION_INVALID');

  return { roleArn, roleSessionName, externalId };
};

const wrapCredentialProvider = (provider, credentialSource) => async () => {
  try {
    return await provider();
  } catch (error) {
    throw toBedrockServiceError(error, { credentialSource });
  }
};

const createCredentialProvider = (factory, options, credentialSource) => {
  try {
    return wrapCredentialProvider(factory(options), credentialSource);
  } catch (error) {
    throw toBedrockServiceError(error, { credentialSource });
  }
};

export const buildBedrockClientConfig = (env = process.env, {
  fromIniFactory = fromIni,
  fromTemporaryCredentialsFactory = fromTemporaryCredentials
} = {}) => {
  if (isMockAiEnabled(env)) return null;

  const region = getBedrockRegion(env);
  const profile = String(env.BEDROCK_AWS_PROFILE || '').trim();
  validateBedrockRegion(region);

  let credentials;
  if (profile) {
    credentials = createCredentialProvider(fromIniFactory, { profile }, 'profile');
  } else {
    const { roleArn, roleSessionName, externalId } = getBedrockRoleOptions(env);
    if (roleArn) {
      credentials = createCredentialProvider(fromTemporaryCredentialsFactory, {
        clientConfig: { region },
        params: {
          RoleArn: roleArn,
          RoleSessionName: roleSessionName,
          ...(externalId ? { ExternalId: externalId } : {})
        }
      }, 'role');
    }
  }

  return {
    region,
    ...(credentials ? { credentials } : {})
  };
};

export const createBedrockClient = ({
  env = process.env,
  Client = BedrockRuntimeClient,
  fromIniFactory = fromIni,
  fromTemporaryCredentialsFactory = fromTemporaryCredentials
} = {}) => {
  const config = buildBedrockClientConfig(env, {
    fromIniFactory,
    fromTemporaryCredentialsFactory
  });
  return config ? new Client(config) : null;
};

const toRawText = (rawText) => (
  typeof rawText === 'string' ? rawText : JSON.stringify(rawText ?? '', null, 2)
);

let sharedBedrockClient = null;

export const getBedrockClient = (env = process.env) => {
  if (isMockAiEnabled(env)) return null;
  if (!sharedBedrockClient) sharedBedrockClient = createBedrockClient({ env });
  return sharedBedrockClient;
};

export const safeParseJson = (text) => {
  if (!text) return null;
  if (typeof text === 'object') return text;

  const raw = String(text).trim();
  if (!raw || raw.length > MAX_MODEL_RESPONSE_LENGTH) return null;
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
  const category = normalizeExpenseCategory(data.category) || 'Khác';
  const advice = data.ai_advice || data.AIAdvice || data.FinancialAdvice;
  return {
    category,
    ai_advice: typeof advice === 'string' && advice.trim()
      ? advice.trim()
      : 'Hãy theo dõi khoản chi này trong ngân sách tháng để kiểm soát chi tiêu tốt hơn.'
  };
};

export const validateBedrockInvoiceResult = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw createBedrockError('BEDROCK_INVALID_RESPONSE');
  }

  const category = normalizeExpenseCategory(data.category);
  const advice = data.ai_advice || data.AIAdvice || data.FinancialAdvice;
  if (!category || typeof advice !== 'string' || !advice.trim() || advice.length > 4000) {
    throw createBedrockError('BEDROCK_INVALID_RESPONSE');
  }

  return { category, ai_advice: advice.trim() };
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

export const analyzeInvoiceWithBedrock = async (
  rawText,
  context = {},
  { env = process.env, client = null, clientFactory = getBedrockClient } = {}
) => {
  if (!String(toRawText(rawText)).trim()) throw createBedrockError('BEDROCK_INPUT_INVALID');

  if (isMockAiEnabled(env)) {
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
    modelId: getBedrockModelId(env),
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 500,
      temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(rawText) }] }]
    })
  });

  let response;
  try {
    const activeClient = client || clientFactory(env);
    if (!activeClient || typeof activeClient.send !== 'function') {
      throw createBedrockError('BEDROCK_CONFIGURATION_INVALID');
    }
    response = await activeClient.send(command);
  } catch (error) {
    throw toBedrockServiceError(error);
  }

  try {
    const encodedBody = response?.body;
    const bodyText = typeof encodedBody === 'string'
      ? encodedBody
      : new TextDecoder().decode(encodedBody);
    const responseBody = JSON.parse(bodyText);
    const parsedResult = safeParseJson(responseBody?.content?.[0]?.text);
    return validateBedrockInvoiceResult(parsedResult);
  } catch (error) {
    if (error instanceof BedrockServiceError) throw error;
    throw createBedrockError('BEDROCK_INVALID_RESPONSE');
  }
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
