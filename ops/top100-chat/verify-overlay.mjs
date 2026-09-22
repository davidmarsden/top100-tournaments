#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const target=process.argv[2];
if (!target) {
  console.error('Usage: node verify-overlay.mjs /path/to/rssnetwork.js');
  process.exit(2);
}
const source=fs.readFileSync(target,'utf8');
const required=[
  'TOP100 CHAT OVERLAY: local SSO',
  'TOP100 CHAT OVERLAY: product identity',
  'case "/localtop100sso"',
  'crypto.randomBytes (24)',
  'requestIsFromThisMachine (theRequest)',
  'TOP100 CHAT OVERLAY: source bindings',
  'TOP100 CHAT OVERLAY: reply push',
  'top100ObjectUrl',
  'top100ObjectType',
  'top100ObjectTitle'
];
const missing=required.filter((marker)=>!source.includes(marker));
if (missing.length) {
  console.error('Missing Top 100 Chat overlay markers: '+missing.join(', '));
  process.exit(1);
}
const checked=spawnSync(process.execPath,['--check',target],{encoding:'utf8'});
if (checked.status!==0) {
  process.stderr.write(checked.stderr || checked.stdout);
  process.exit(checked.status || 1);
}
console.log('Top 100 Chat overlay verified.');
