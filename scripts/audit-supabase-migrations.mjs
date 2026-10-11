#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args=process.argv.slice(2);
const arg=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1]};
if(!arg('--remote')||!arg('--lab'))throw Error('Required: --remote export.json --lab ../top100-manager-lab');
const remote=JSON.parse(fs.readFileSync(arg('--remote'),'utf8'));
if(!Array.isArray(remote)||!remote.length||remote.some(x=>!/^\d+$/.test(String(x.version))||typeof x.name!=='string'||!Array.isArray(x.statements)))throw Error('Invalid or empty migration export');
const norm=s=>s.replace(/\r\n/g,'\n').trim();
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function gather(repo,root){return fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>/^\d+_.+\.sql$/.test(n)).map(name=>{const sql=fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');return {repo,name,version:name.match(/^(\d+)_/)[1],logicalName:name.replace(/^\d+_/,'').replace(/^z+_/,'').replace(/\.sql$/,''),sql}})}
const local=[...gather('top100-tournaments',process.cwd()),...gather('top100-manager-lab',arg('--lab'))];
/* Supabase stores parsed SQL statements, not the raw file. An exact comparison
   requires the CLI's parser. We deliberately report raw-file comparisons as
   indicative only, never as proof of semantic SQL differences. */
const migrations=remote.map(r=>{const sql=r.statements.join('\n');return {version:r.version,name:r.name,remoteStatementCount:r.statements.length,remoteJoinedSha256:sha(sql),matches:local.filter(f=>f.version===r.version||f.logicalName===r.name).map(f=>({repo:f.repo,file:'supabase/migrations/'+f.name,version:f.version,rawExact:f.sql===sql,rawTrimmed:norm(f.sql)===norm(sql),rawSha256:sha(f.sql),comparisonStatus:'raw-comparison-only'}))}});
const versions=new Set(remote.map(x=>String(x.version)));
const localNotInRemote=local.filter(x=>!versions.has(x.version)).map(x=>({repo:x.repo,file:'supabase/migrations/'+x.name,version:x.version}));
const summary={remote:remote.length,local:local.length,remoteWithoutCandidate:migrations.filter(x=>!x.matches.length).length,rawExact:migrations.filter(x=>x.matches.some(y=>y.rawExact)).length,rawTrimmed:migrations.filter(x=>x.matches.some(y=>y.rawTrimmed)).length,localVersionsAbsentFromRemote:localNotInRemote.length,statementComparison:'not-performed'};
const output={summary,migrations,localNotInRemote};
if(arg('--output'))fs.writeFileSync(arg('--output'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(summary.remoteWithoutCandidate||summary.localVersionsAbsentFromRemote)process.exitCode=1;
