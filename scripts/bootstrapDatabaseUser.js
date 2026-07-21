#!/usr/bin/env node

process.env.FINVANTAGE_DISABLE_DOTENV = 'true';

const args = new Set(process.argv.slice(2));
const applyConfirmation = '--confirm-bootstrap=FINVANTAGE_DB_USER_BOOTSTRAP';
const productionConfirmation = '--confirm-production=FINVANTAGE_PRODUCTION';

if (!args.has('--apply') || !args.has(applyConfirmation) || !args.has(productionConfirmation)) {
  console.error(`Database role bootstrap requires --apply, ${applyConfirmation} and ${productionConfirmation}.`);
  process.exitCode = 2;
} else if (!process.env.DB_ADMIN_SECRET_ARN || !process.env.DB_SECRET_ARN) {
  console.error('DATABASE_BOOTSTRAP_CONFIG_INVALID DB_ADMIN_SECRET_ARN DB_SECRET_ARN');
  process.exitCode = 2;
} else {
  let client;
  try {
    const { createDbConfig } = await import('../src/config/db.config.js');
    const { createDatabaseSecretResolver } = await import('../src/services/dbSecret.service.js');
    const {
      bootstrapApplicationDatabaseRole,
      configureDatabaseRoleBootstrapSession,
      createDatabaseRoleBootstrapConnectionConfig,
      removeDatabaseRoleBootstrapStartupEnvironment
    } = await import('./databaseUserBootstrap.js');
    const { default: pg } = await import('pg');

    const baseEnvironment = {
      ...process.env,
      DB_USER: '',
      DB_PASSWORD: ''
    };
    const adminEnvironment = {
      ...baseEnvironment,
      DB_SECRET_ARN: process.env.DB_ADMIN_SECRET_ARN
    };
    const applicationEnvironment = {
      ...baseEnvironment,
      DB_SECRET_ARN: process.env.DB_SECRET_ARN
    };
    const adminBase = createDbConfig(adminEnvironment);
    if (!adminBase.production || !adminBase.usesProxy) {
      throw Object.assign(new Error('Production RDS Proxy is required.'), {
        code: 'DATABASE_BOOTSTRAP_TARGET_INVALID'
      });
    }
    const adminConfig = await createDatabaseSecretResolver({ env: adminEnvironment }).resolve(adminBase);
    const applicationConfig = await createDatabaseSecretResolver({ env: applicationEnvironment }).resolve({
      ...adminBase,
      secretArn: process.env.DB_SECRET_ARN
    });
    if (adminConfig.user === applicationConfig.user) {
      throw Object.assign(new Error('Database roles must differ.'), {
        code: 'DATABASE_BOOTSTRAP_ROLE_COLLISION'
      });
    }

    removeDatabaseRoleBootstrapStartupEnvironment(process.env);
    client = new pg.Client(createDatabaseRoleBootstrapConnectionConfig(adminConfig));
    await client.connect();
    await configureDatabaseRoleBootstrapSession(client, adminConfig);
    await bootstrapApplicationDatabaseRole({
      client,
      username: applicationConfig.user,
      password: applicationConfig.password
    });
    console.info('Database application role bootstrap completed.');
  } catch (error) {
    console.error(error?.code || 'DATABASE_ROLE_BOOTSTRAP_FAILED');
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => undefined);
  }
}
