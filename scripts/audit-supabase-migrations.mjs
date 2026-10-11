#!/usr/bin/env node
/** Read-only inventory of archived, executable and Manager Lab migrations. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const args=process.argv.slice(2);
const arg=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const recoveredDir=arg('--recovered'),labDir=arg('--lab');
if(!recoveredDir||!labDir)throw new Error('Usage: --recovered docs/recovered-supabase-migrations --lab manager-lab [--output report.json]');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function files(dir){return fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort().map(name=>({name,version:name.split('_')[0],logicalName:name.replace(/^\d+_/,'').replace(/\.sql$/,''),sql:fs.readFileSync(path.join(dir,name),'utf8')}));}
const recovered=files(recoveredDir), executable=files('supabase/migrations'), lab=files(path.join(labDir,'supabase/migrations'));
if(!recovered.length)throw new Error('Recovered migration archive is empty');
const byVersion=new Map(executable.map(x=>[x.version,x]));
const matches=recovered.map(r=>{const e=byVersion.get(r.version);return{version:r.version,name:r.logicalName,executable:e?.name??null,identical:e?sha(e.sql)===sha(r.sql):false,sha256:sha(r.sql)};});
const missing=matches.filter(x=>!x.executable),different=matches.filter(x=>x.executable&&!x.identical);
const extra=executable.filter(x=>!recovered.some(r=>r.version===x.version)).map(x=>x.name);
const summary={recovered:recovered.length,executable:executable.length,managerLab:lab.length,missing:missing.length,different:different.length,extra:extra.length,scope:'Version and byte comparison of recovered SQL; not a production semantic SQL audit'};
const output={summary,missing,different,extra,matches};
if(arg('--output'))fs.writeFileSync(arg('--output'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(missing.length||different.length||extra.length)process.exitCode=1;
