#!/usr/bin/env node

import { assertProductionConfig } from '../src/config/production.config.js';

try {
  assertProductionConfig(process.env, { stage: 'prod' });
  console.info('Production configuration validation passed.');
} catch (error) {
  console.error(error?.code || 'PRODUCTION_CONFIG_INVALID', ...(error?.fields || []));
  process.exitCode = 1;
}
