import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  analyzeInvoiceWithBedrock,
  BedrockServiceError,
  buildBedrockClientConfig,
  createBedrockClient,
  getBedrockModelId,
  getBedrockRegion,
  safeParseJson,
  toBedrockServiceError,
} from '../src/services/bedrock.service.js';

const ROLE_ARN = 'arn:aws:iam::123456789012:role/FinVantageBedrock';

const modelResponse = (text) => ({
  body: new TextEncoder().encode(JSON.stringify({ content: [{ text }] })),
});

test('USE_MOCK_AI=true returns before constructing clients or credential providers', async () => {
  let clientConstructions = 0;
  let profileCalls = 0;
  let roleCalls = 0;
  let clientFactoryCalls = 0;
  const env = {
    USE_MOCK_AI: 'true',
    BEDROCK_AWS_PROFILE: 'finvantage-bedrock-real',
    BEDROCK_ROLE_ARN: ROLE_ARN,
  };

  assert.equal(buildBedrockClientConfig(env, {
    fromIniFactory: () => { profileCalls += 1; },
    fromTemporaryCredentialsFactory: () => { roleCalls += 1; },
  }), null);
  assert.equal(createBedrockClient({
    env,
    Client: class {
      constructor() { clientConstructions += 1; }
    },
    fromIniFactory: () => { profileCalls += 1; },
    fromTemporaryCredentialsFactory: () => { roleCalls += 1; },
  }), null);

  const result = await analyzeInvoiceWithBedrock('PHUC LONG', {}, {
    env,
    clientFactory: () => {
      clientFactoryCalls += 1;
      throw new Error('must not construct an AWS client');
    },
  });

  assert.equal(result.category, 'Ăn uống');
  assert.equal(clientConstructions, 0);
  assert.equal(profileCalls, 0);
  assert.equal(roleCalls, 0);
  assert.equal(clientFactoryCalls, 0);
});

test('named profile takes precedence over AssumeRole and is applied only to Bedrock', async () => {
  const calls = [];
  const expectedCredentials = { accessKeyId: 'test', secretAccessKey: 'test' };
  const config = buildBedrockClientConfig({
    BEDROCK_AWS_PROFILE: '  finvantage-bedrock-real  ',
    BEDROCK_ROLE_ARN: 'ignored-because-profile-wins',
    BEDROCK_AWS_REGION: 'us-east-1',
    AWS_REGION: 'ap-southeast-1',
  }, {
    fromIniFactory: (options) => {
      calls.push(options);
      return async () => expectedCredentials;
    },
    fromTemporaryCredentialsFactory: () => {
      throw new Error('AssumeRole factory must not run when a profile exists');
    },
  });

  assert.equal(config.region, 'us-east-1');
  assert.deepEqual(await config.credentials(), expectedCredentials);
  assert.deepEqual(calls, [{ profile: 'finvantage-bedrock-real' }]);
});

test('Bedrock uses AssumeRole with session name and external ID when no profile exists', async () => {
  const calls = [];
  const expectedCredentials = { accessKeyId: 'temporary', secretAccessKey: 'temporary' };
  const config = buildBedrockClientConfig({
    BEDROCK_AWS_REGION: 'us-west-2',
    BEDROCK_ROLE_ARN: ROLE_ARN,
    BEDROCK_ROLE_SESSION_NAME: 'finvantage-production',
    BEDROCK_EXTERNAL_ID: 'finvantage-external-id',
  }, {
    fromIniFactory: () => {
      throw new Error('profile factory must not run without a profile');
    },
    fromTemporaryCredentialsFactory: (options) => {
      calls.push(options);
      return async () => expectedCredentials;
    },
  });

  assert.deepEqual(await config.credentials(), expectedCredentials);
  assert.deepEqual(calls, [{
    clientConfig: { region: 'us-west-2' },
    params: {
      RoleArn: ROLE_ARN,
      RoleSessionName: 'finvantage-production',
      ExternalId: 'finvantage-external-id',
    },
  }]);
});

test('Bedrock keeps the default credential chain when no separate profile exists', () => {
  let profileCalls = 0;
  let roleCalls = 0;
  const config = buildBedrockClientConfig({
    AWS_REGION: 'ap-southeast-1',
  }, {
    fromIniFactory: () => { profileCalls += 1; },
    fromTemporaryCredentialsFactory: () => { roleCalls += 1; },
  });

  assert.equal(config.region, 'ap-southeast-1');
  assert.equal(profileCalls, 0);
  assert.equal(roleCalls, 0);
  assert.equal(Object.hasOwn(config, 'credentials'), false);
});

test('Bedrock factory constructs exactly one injected client with isolated credentials', async () => {
  class FakeBedrockClient {
    constructor(config) {
      this.config = config;
    }
  }

  const expectedCredentials = { accessKeyId: 'test', secretAccessKey: 'test' };
  const client = createBedrockClient({
    env: {
      BEDROCK_AWS_PROFILE: 'finvantage-bedrock-real',
      BEDROCK_AWS_REGION: 'us-west-2',
    },
    Client: FakeBedrockClient,
    fromIniFactory: ({ profile }) => {
      assert.equal(profile, 'finvantage-bedrock-real');
      return async () => expectedCredentials;
    },
  });

  assert.equal(client.config.region, 'us-west-2');
  assert.deepEqual(await client.config.credentials(), expectedCredentials);
});

test('all non-Bedrock AWS clients remain on the normal AWS credential chain', async () => {
  const files = [
    new URL('../src/services/s3.service.js', import.meta.url),
    new URL('../src/services/textract.service.js', import.meta.url),
    new URL('../src/services/notification.service.js', import.meta.url),
    new URL('../auth-server/app.js', import.meta.url),
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /BEDROCK_(?:AWS_PROFILE|ROLE_ARN|EXTERNAL_ID)/);
    assert.doesNotMatch(source, /credential-providers|fromIni|fromTemporaryCredentials/);
    assert.match(source, /new (?:S3|Textract|SNS|CognitoIdentityProvider)Client\(\{\s*region:/s);
  }
});

test('USE_MOCK_AI=false invokes Bedrock with the configured model', async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command);
      return {
        body: new TextEncoder().encode(JSON.stringify({
          content: [{
            text: JSON.stringify({
              category: 'Ăn uống',
              ai_advice: 'Theo dõi khoản chi này.',
            }),
          }],
        })),
      };
    },
  };

  const result = await analyzeInvoiceWithBedrock('PHUC LONG', {}, {
    env: {
      USE_MOCK_AI: 'false',
      BEDROCK_MODEL_ID: 'test.bedrock-model-v1',
    },
    client,
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].input.modelId, 'test.bedrock-model-v1');
  assert.equal(result.category, 'Ăn uống');
});

test('code-fenced model JSON is parsed, validated, normalized, and keeps the output contract', async () => {
  const client = {
    async send() {
      return modelResponse('```json\n{"category":"Y tế","ai_advice":"  Theo dõi chi tiêu.  "}\n```');
    },
  };

  const result = await analyzeInvoiceWithBedrock('receipt text', {}, {
    env: { USE_MOCK_AI: 'false' },
    client,
  });

  assert.deepEqual(result, {
    category: 'Sức khỏe',
    ai_advice: 'Theo dõi chi tiêu.',
  });
  assert.deepEqual(Object.keys(result).sort(), ['ai_advice', 'category']);
  assert.deepEqual(safeParseJson('```JSON\n{"category":"Khác"}\n```'), { category: 'Khác' });
});

test('invalid Bedrock response shapes fail with one sanitized typed error', async () => {
  const invalidResponses = [
    { body: new TextEncoder().encode('not-json') },
    modelResponse('not-json'),
    modelResponse('[]'),
    modelResponse('{"category":"Unknown","ai_advice":"Advice"}'),
    modelResponse('{"category":"Khác"}'),
  ];

  for (const response of invalidResponses) {
    await assert.rejects(
      analyzeInvoiceWithBedrock('receipt text', {}, {
        env: { USE_MOCK_AI: 'false' },
        client: { async send() { return response; } },
      }),
      (error) => (
        error instanceof BedrockServiceError
        && error.code === 'BEDROCK_INVALID_RESPONSE'
        && error.statusCode === 502
        && !/not-json|Unknown/i.test(error.message)
      )
    );
  }
});

test('Bedrock AWS failures are converted to typed sanitized application errors', async () => {
  const cases = [
    ['AccessDeniedException', 'BEDROCK_ACCESS_DENIED', 403, false],
    ['ThrottlingException', 'BEDROCK_THROTTLED', 429, true],
    ['ValidationException', 'BEDROCK_VALIDATION_FAILED', 400, false],
    ['ResourceNotFoundException', 'BEDROCK_MODEL_UNAVAILABLE', 503, true],
    ['ServiceUnavailableException', 'BEDROCK_SERVICE_UNAVAILABLE', 503, true],
  ];

  for (const [name, code, statusCode, retryable] of cases) {
    const raw = Object.assign(new Error('technical detail arn:aws:bedrock:secret'), { name });
    await assert.rejects(
      analyzeInvoiceWithBedrock('receipt text', {}, {
        env: { USE_MOCK_AI: 'false' },
        client: { async send() { throw raw; } },
      }),
      (error) => (
        error instanceof BedrockServiceError
        && error.code === code
        && error.statusCode === statusCode
        && error.retryable === retryable
        && !/technical|arn:aws/i.test(error.message)
      )
    );
  }
});

test('AssumeRole AccessDenied is identified as STS without leaking role details', async () => {
  const config = buildBedrockClientConfig({
    BEDROCK_ROLE_ARN: ROLE_ARN,
  }, {
    fromTemporaryCredentialsFactory: () => async () => {
      throw Object.assign(new Error(`not authorized for ${ROLE_ARN}`), {
        name: 'AccessDeniedException',
      });
    },
  });

  await assert.rejects(config.credentials(), (error) => (
    error instanceof BedrockServiceError
    && error.code === 'BEDROCK_ASSUME_ROLE_ACCESS_DENIED'
    && error.awsService === 'sts'
    && error.statusCode === 403
    && !error.message.includes(ROLE_ARN)
  ));

  assert.throws(() => buildBedrockClientConfig({
    BEDROCK_ROLE_ARN: ROLE_ARN,
  }, {
    fromTemporaryCredentialsFactory: () => {
      throw Object.assign(new Error(`denied for ${ROLE_ARN}`), {
        name: 'AccessDeniedException',
      });
    },
  }), (error) => (
    error instanceof BedrockServiceError
    && error.code === 'BEDROCK_ASSUME_ROLE_ACCESS_DENIED'
    && !error.message.includes(ROLE_ARN)
  ));
});

test('AssumeRole uses a stable default session name and omits an absent external ID', () => {
  let options;
  buildBedrockClientConfig({ BEDROCK_ROLE_ARN: ROLE_ARN }, {
    fromTemporaryCredentialsFactory: (value) => {
      options = value;
      return async () => ({});
    },
  });

  assert.equal(options.params.RoleSessionName, 'finvantage-bedrock');
  assert.equal(Object.hasOwn(options.params, 'ExternalId'), false);
});

test('invalid production role configuration fails before constructing an AWS client', () => {
  let constructions = 0;
  assert.throws(() => createBedrockClient({
    env: { BEDROCK_ROLE_ARN: 'not-an-arn' },
    Client: class {
      constructor() { constructions += 1; }
    },
  }), (error) => (
    error instanceof BedrockServiceError
    && error.code === 'BEDROCK_CONFIGURATION_INVALID'
  ));
  assert.equal(constructions, 0);
});

test('direct error conversion never exposes raw AWS failure messages', () => {
  const raw = Object.assign(new Error('secret technical failure'), { name: 'UnknownAwsError' });
  const safe = toBedrockServiceError(raw);
  assert.equal(safe.code, 'BEDROCK_REQUEST_FAILED');
  assert.doesNotMatch(safe.message, /secret|technical/i);
});

test('Bedrock region and model retain their existing fallbacks', () => {
  assert.equal(getBedrockRegion({ AWS_REGION_NAME: 'ap-northeast-1' }), 'ap-northeast-1');
  assert.equal(getBedrockRegion({}), 'ap-southeast-1');
  assert.equal(getBedrockModelId({}), 'anthropic.claude-3-haiku-20240307-v1:0');
});
