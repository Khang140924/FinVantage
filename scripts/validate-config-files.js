#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

const yamlFiles = ['serverless.yml', 'infra/finvantage-production.yml'];
const jsonFiles = [
  'infra/production-parameters.example.json',
  'infra/amplify-rewrites.example.json'
];

for (const file of yamlFiles) {
  const document = parseDocument(await readFile(file, 'utf8'), {
    prettyErrors: true,
    uniqueKeys: true
  });
  if (document.errors.length) {
    const error = new Error(`Invalid YAML configuration: ${file}`);
    error.code = 'CONFIG_YAML_INVALID';
    throw error;
  }
  const value = document.toJS({ mapAsMap: false });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error(`Invalid YAML root: ${file}`), { code: 'CONFIG_ROOT_INVALID' });
  }
  if (file === 'serverless.yml') {
    if (value.provider?.runtime !== 'nodejs24.x' || !value.functions?.authApi || !value.functions?.analyzeInvoice) {
      throw Object.assign(new Error('Serverless production contract is incomplete.'), {
        code: 'SERVERLESS_CONTRACT_INVALID'
      });
    }
  } else if (!value.Resources?.DatabaseProxy || !value.Resources?.ValkeyReplicationGroup) {
    throw Object.assign(new Error('Infrastructure production contract is incomplete.'), {
      code: 'INFRASTRUCTURE_CONTRACT_INVALID'
    });
  }
  console.info(`${file}: valid`);
}

for (const file of jsonFiles) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`Invalid JSON root: ${file}`), { code: 'CONFIG_JSON_INVALID' });
  }
  console.info(`${file}: valid`);
}
