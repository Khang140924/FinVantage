#!/usr/bin/env node

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'auth-server', 'shared', 'scripts'];
const files = [];

const collect = (entry) => {
  const details = statSync(entry);
  if (details.isDirectory()) {
    for (const child of readdirSync(entry)) collect(path.join(entry, child));
    return;
  }
  if (/\.(?:c?js|mjs)$/i.test(entry)) files.push(entry);
};

for (const root of roots) collect(path.resolve(root));
files.sort((left, right) => left.localeCompare(right));

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

console.info(`Backend syntax check passed (${files.length} files).`);
