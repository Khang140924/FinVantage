import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FINVANTAGE_DISABLE_DOTENV = 'true';

const {
  createDatabaseSecretResolver,
  parseDatabaseSecret
} = await import('../src/services/dbSecret.service.js');
const { createDbConfig } = await import('../src/config/db.config.js');

test('database secret parsing accepts the standard RDS JSON shape', () => {
  const parsed = parseDatabaseSecret(JSON.stringify({
    username: 'app_user',
    password: 'not-a-real-secret',
    host: 'database.internal',
    port: 5432,
    dbname: 'finvantage'
  }));
  assert.equal(parsed.user, 'app_user');
  assert.equal(parsed.database, 'finvantage');
  assert.equal(parsed.port, 5432);
});

test('secret resolution is async, cached and never replaces the RDS Proxy endpoint', async () => {
  let sends = 0;
  class FakeCommand {
    constructor(input) {
      this.input = input;
    }
  }
  const resolver = createDatabaseSecretResolver({
    env: {},
    moduleLoader: async () => ({
      SecretsManagerClient: class {},
      GetSecretValueCommand: FakeCommand
    }),
    clientFactory: () => ({
      send: async (command) => {
        sends += 1;
        assert.match(command.input.SecretId, /^arn:aws:secretsmanager:/);
        return {
          SecretString: JSON.stringify({
            username: 'runtime_user',
            password: 'runtime-password',
            host: 'direct-database.internal',
            port: 6432,
            dbname: 'secret_database'
          })
        };
      }
    })
  });
  const base = createDbConfig({
    NODE_ENV: 'production',
    RDS_PROXY_ENDPOINT: 'proxy.internal',
    DB_NAME: 'finvantage',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:region:account:secret:db',
    DB_SSL: 'true'
  });

  const [first, second] = await Promise.all([resolver.resolve(base), resolver.resolve(base)]);
  assert.equal(sends, 1);
  assert.equal(first, second);
  assert.equal(first.host, 'proxy.internal');
  assert.equal(first.port, 6432);
  assert.equal(first.database, 'secret_database');
  assert.equal(first.user, 'runtime_user');
});

test('secret resolution failures do not expose secret payloads', async () => {
  const resolver = createDatabaseSecretResolver({
    moduleLoader: async () => ({
      SecretsManagerClient: class {},
      GetSecretValueCommand: class {}
    }),
    clientFactory: () => ({ send: async () => ({ SecretString: '{invalid-secret-json' }) })
  });
  const base = {
    secretArn: 'arn:aws:secretsmanager:region:account:secret:db',
    secretRegion: 'region'
  };
  await assert.rejects(
    resolver.resolve(base),
    (error) => error.code === 'DATABASE_CONFIGURATION_ERROR'
      && !error.message.includes('invalid-secret-json')
  );
});
