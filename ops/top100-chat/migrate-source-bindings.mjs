#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const rssDir = process.argv[2] || '/opt/top100-rsschat';
const dbPath = process.argv[3] || path.join(rssDir, 'data', 'data.db');

if (!fs.existsSync(dbPath)) {
  console.error('Top 100 Chat database not found: ' + dbPath);
  process.exit(2);
}

const requireFromRss = createRequire(path.join(rssDir, 'package.json'));
const Database = requireFromRss('better-sqlite3');
const db = new Database(dbPath);
const columns = new Set(db.prepare('pragma table_info(items)').all().map((row) => row.name));
const wanted = [
  ['top100ObjectUrl', 'text'],
  ['top100ObjectType', 'text'],
  ['top100ObjectTitle', 'text'],
];
const missing = wanted.filter(([name]) => !columns.has(name));

if (missing.length === 0) {
  console.log('Top 100 source-binding columns already exist.');
  db.close();
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = dbPath + '.pre-source-bindings-' + stamp;
await db.backup(backupPath);
console.log('SQLite backup: ' + backupPath);

for (const [name, type] of missing) {
  db.exec('alter table items add column ' + name + ' ' + type);
  console.log('Added ' + name + '.');
}

db.close();
