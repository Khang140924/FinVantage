#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--load-dotenv-local')) await import('dotenv/config');
process.env.FINVANTAGE_DISABLE_DOTENV = 'true';

const args = new Set(rawArgs);
const apply = args.has('--apply');
const planOnly = args.has('--plan') || args.has('--validate');
const statusOnly = args.has('--status');
const includeBaseline = args.has('--baseline');
const applyConfirmation = 'FINVANTAGE_MIGRATION';
const productionConfirmation = 'FINVANTAGE_PRODUCTION';

if ([apply, planOnly, statusOnly].filter(Boolean).length !== 1) {
  console.error('Choose exactly one mode: --plan (or --validate), --status or --apply.');
  process.exitCode = 2;
} else {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const {
    configureMigrationSession,
    createMigrationPoolConfig,
    loadMigrationPlan,
    removeUnsupportedRdsProxyStartupEnvironment,
    runMigrationPlan,
    safeMigrationErrorFields
  } = await import('./migrationRunner.js');
  const migrations = await loadMigrationPlan({ rootDir, includeBaseline });

  if (planOnly) {
    console.info('Migration plan validated.');
    for (const migration of migrations) {
      console.info(`${migration.name} ${migration.checksum}`);
    }
  } else if (apply && !args.has(`--confirm-apply=${applyConfirmation}`)) {
    console.error(`Migration apply requires --confirm-apply=${applyConfirmation}.`);
    process.exitCode = 2;
  } else {
    const { createDbConfig } = await import('../src/config/db.config.js');
    const { createDatabaseSecretResolver } = await import('../src/services/dbSecret.service.js');
    const { default: pg } = await import('pg');
    const migrationEnvironment = process.env.DB_ADMIN_SECRET_ARN
      ? { ...process.env, DB_SECRET_ARN: process.env.DB_ADMIN_SECRET_ARN, DB_USER: '', DB_PASSWORD: '' }
      : process.env;
    const baseConfig = createDbConfig(migrationEnvironment);
    const localTarget = ['localhost', '127.0.0.1', '::1'].includes(
      String(baseConfig.host || '').trim().toLowerCase()
    );
    if ((baseConfig.production || !localTarget) && !args.has(`--confirm-production=${productionConfirmation}`)) {
      console.error(`Remote database access requires --confirm-production=${productionConfirmation}.`);
      process.exitCode = 2;
    } else {
      let config;
      let pool;
      let client;
      try {
        config = await createDatabaseSecretResolver({ env: migrationEnvironment }).resolve(baseConfig);
        removeUnsupportedRdsProxyStartupEnvironment(process.env);
        pool = new pg.Pool(createMigrationPoolConfig(config));
        client = await pool.connect();
        await configureMigrationSession(client, config);
        if (statusOnly) {
          const ledgerResult = await client.query(
            "SELECT to_regclass('public.schema_migrations') AS ledger"
          );
          if (!ledgerResult.rows[0]?.ledger) {
            console.info('Migration ledger is not initialized.');
            for (const migration of migrations) console.info(`${migration.name} pending`);
          } else {
            const ledger = await client.query(
              'SELECT name, checksum, status FROM schema_migrations ORDER BY name'
            );
            const recorded = new Map(ledger.rows.map((row) => [row.name, row]));
            for (const migration of migrations) {
              const row = recorded.get(migration.name);
              const status = !row
                ? 'pending'
                : (row.checksum === migration.checksum ? row.status : 'checksum-drift');
              console.info(`${migration.name} ${status}`);
              recorded.delete(migration.name);
            }
            for (const name of [...recorded.keys()].sort()) console.info(`${name} missing-file`);
          }
        } else {
          const results = await runMigrationPlan({ client, migrations });
          const applied = results.filter(({ status }) => status === 'applied').length;
          const skipped = results.filter(({ status }) => status === 'skipped').length;
          console.info(`Migration complete: ${applied} applied, ${skipped} skipped.`);
        }
      } catch (error) {
        console.error(JSON.stringify(safeMigrationErrorFields(error, {
          sensitiveValues: [
            config?.user,
            config?.password,
            migrationEnvironment.DB_ADMIN_SECRET_ARN,
            migrationEnvironment.DB_SECRET_ARN
          ]
        })));
        process.exitCode = 1;
      } finally {
        client?.release();
        await pool?.end();
      }
    }
  }
}
