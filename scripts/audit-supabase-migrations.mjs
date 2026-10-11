#!/usr/bin/env node
/**
 * Read-only migration inventory / comparison helper.
 * Usage:
 *   node scripts/audit-supabase-migrations.mjs --remote path/to/export.json --lab path/to/top100-manager-lab
 * JSON export format: [{ "version": "...", "name": "...", "statements": ["..."] }]
 * Does not connect to a database, execute SQL, or modify migration files.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args = process.argv.slice(2);
function arg(flag) { const i=args.indexOf(flag); return i<0 ? undefined : args[i+1]; }
const remoteFile=arg('--remote');
const labDir=arg('--lab');
if (!remoteFile || !labDir) {
  console.error('Usage: node scripts/audit-supabase-migrations.mjs --remote export.json --lab ../top100-manager-lab [--output report.json]');
  process.exit(2);
}
const remote=JSON.parse(fs.readFileSync(remoteFile,'utf8'));
if (!Array.isArray(remote) || remote.some(x=>!/^\d{14}$/.test(String(x.version)) || typeof x.name!=='string' || !Array.isArray(x.statements))) {
  throw new Error('Invalid remote migration export: expected version, name and statements fields.');
}
function gather(repo,root) {
  const dir=path.join(root,'supabase','migrations');
  return fs.readdirSync(dir).filter(n=>n.endsWith('.sql')).map(name=>({
    repo, name, file:path.join(dir,name), version:name.split('_')[0],
    logicalName:name.replace(/^\d{8,14}_/,'').replace(/^z+_/,'').replace(/\.sql$/,''),
    sql:fs.readFileSync(path.join(dir,name),'utf8')
  }));
}
const local=[...gather('top100-tournaments',process.cwd()),...gather('top100-manager-lab',labDir)];
const canonical=s=>s.replace(/\r\n/g,'\n').trim();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const result=remote.map(r=>{
 const sql=r.statements.join('\n');
 const candidates=local.filter(f=>f.logicalName===r.name || f.version===r.version);
 const ordered=[...candidates].sort((a,b)=>Number(b.version===r.version)-Number(a.version===r.version));
 return {
  version:r.version,name:r.name,remoteSha256:hash(sql),
  matches:ordered.map(f=>({
   repo:f.repo,file:path.relative(f.repo==='top100-tournaments'?process.cwd():labDir,f.file),
   version:f.version,exact:f.sql===sql,trimmed:canonical(f.sql)===canonical(sql),
   sha256:hash(f.sql),contentLength:f.sql.length
  }))
 };
});
const summary={remote:remote.length,local:local.length,exact:result.filter(x=>x.matches.some(y=>y.exact)).length,whitespaceEquivalent:result.filter(x=>x.matches.some(y=>y.trimmed)).length,noCandidates:result.filter(x=>!x.matches.length).length,differentSql:result.filter(x=>x.matches.length && !x.matches.some(y=>y.trimmed)).length};
const output={summary,migrations:result};
const outFile=arg('--output');
if(outFile)fs.writeFileSync(outFile,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(summary.noCandidates||summary.differentSql)process.exitCode=1;
