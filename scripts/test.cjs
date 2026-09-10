const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');let failed=false;const totals={tests:0,pass:0,fail:0,skipped:0};
for(const file of fs.readdirSync(path.join(root,'tests')).filter(f=>/\.test\.(?:cjs|js)$/.test(f)).sort()){
 const r=spawnSync(process.execPath,[path.join(root,'tests',file)],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
 const text=(r.stdout||'')+(r.stderr||'');process.stdout.write(text);if(r.status!==0)failed=true;
 for(const key of Object.keys(totals)){const matches=[...text.matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];if(matches.length)totals[key]+=Number(matches.at(-1)[1]);}
}
console.log('AAG_TEST_TOTALS='+JSON.stringify(totals));process.exitCode=failed?1:0;
