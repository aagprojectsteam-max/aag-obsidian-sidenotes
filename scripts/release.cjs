// Local packaging validation only; publication remains gated separately.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),m=require('../manifest.json'),p=require('../package.json'),v=require('../versions.json'),out=path.join(root,'dist/release');
assert.equal(m.version,p.version);assert.equal(v[m.version],m.minAppVersion);for(const key of ['version','minAppVersion'])assert.match(m[key],/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);assert.match(m.id,/^[a-z0-9-]+$/);assert.equal(typeof m.isDesktopOnly,'boolean');
const files=['main.js','manifest.json','styles.css'];const candidate="dist/build/main.js";
if(process.argv[2]==='stage'){fs.mkdirSync(out,{recursive:true});for(const f of files)fs.copyFileSync(path.join(root,f==='main.js'?candidate:f),path.join(out,f));}
assert.deepEqual(fs.readdirSync(out).sort(),files);for(const f of files){const bytes=fs.readFileSync(path.join(out,f));assert.deepEqual(bytes,fs.readFileSync(path.join(root,f==='main.js'?candidate:f)));assert.ok(bytes.length);console.log(f,crypto.createHash('sha256').update(bytes).digest('hex'));}
console.log('PACKAGING=PASS; PUBLICATION=BLOCKED_PENDING_REVIEW');
