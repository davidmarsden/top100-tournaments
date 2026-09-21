#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';

const rssDir = process.argv[2] || '/opt/top100-rsschat';
const dbPath = process.argv[3] || path.join(rssDir, 'data', 'data.db');
const requireFromRss = createRequire(path.join(rssDir, 'package.json'));
const Database = requireFromRss('better-sqlite3');

const db = new Database(dbPath);
const columns = new Set(db.prepare('pragma table_info(items)').all().map((row) => row.name));
const wanted = [
  ['top100ObjectUrl', 'text'],
  ['top100ObjectType', 'text'],
  ['top100ObjectTitle', 'text'],
];

for (const [name, type] of wanted) {
  if (columns.has(name)) {
    console.log(name + ' already exists.');
    continue;
  }
  db.exec('alter table items add column ' + name + ' ' + type);
  console.log('Added ' + name + '.');
}

db.close();
