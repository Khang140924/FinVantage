#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
  console.error('Local Serverless launcher cannot run with NODE_ENV=production.');
  process.exitCode = 2;
} else {
  await import('dotenv/config');
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('serverless/package.json');
  const metadata = JSON.parse(readFileSync(packagePath, 'utf8'));
  const relativeBin = typeof metadata.bin === 'string'
    ? metadata.bin
    : metadata.bin?.serverless || metadata.bin?.sls;
  if (!relativeBin) throw new Error('Serverless CLI entrypoint is unavailable.');
  const serverlessBin = path.resolve(path.dirname(packagePath), relativeBin);
  const child = spawn(process.execPath, [serverlessBin, 'offline', '--stage', 'dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      FINVANTAGE_DISABLE_DOTENV: 'true',
      APP_STAGE: 'dev',
      STAGE: 'dev'
    }
  });
  child.once('error', (error) => {
    console.error('Unable to start the local API.', { code: error?.code || 'LOCAL_API_START_FAILED' });
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = Number.isInteger(code) ? code : (signal ? 1 : 0);
  });
}
