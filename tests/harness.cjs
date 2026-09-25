const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const ts=require('typescript');
class TFile{constructor(p){this.path=p;this.name=path.basename(p);this.basename=this.name.replace(/\.[^.]+$/,'');this.extension=path.extname(p).slice(1);}}
function harness(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aag-sidenotes-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 function guard(p){const dest=path.resolve(root,p);if(dest!==root&&!dest.startsWith(root+path.sep))throw Error('Outside disposable vault');return dest;}
 const cache=new Map(),notices=[];
 const vault={adapter:{exists:async p=>fs.existsSync(guard(p)),read:async p=>fs.readFileSync(guard(p),'utf8'),write:async(p,s)=>fs.writeFileSync(guard(p),s),rename:async(a,b)=>fs.renameSync(guard(a),guard(b)),remove:async p=>fs.unlinkSync(guard(p))},getAbstractFileByPath:p=>fs.existsSync(guard(p))&&fs.statSync(guard(p)).isFile()?new TFile(p):null,getMarkdownFiles:()=>[],createFolder:async p=>fs.mkdirSync(guard(p),{recursive:true}),create:async(p,s)=>{fs.writeFileSync(guard(p),s,{flag:'wx'});return new TFile(p);},createBinary:async(p,b)=>{fs.writeFileSync(guard(p),Buffer.from(b),{flag:'wx'});return new TFile(p);},read:async f=>fs.readFileSync(guard(f.path),'utf8'),readBinary:async f=>{const b=fs.readFileSync(guard(f.path));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);},configDir:'.obsidian'};
 const obsidian=new Proxy({TFile,Notice:class{constructor(s){notices.push(s);}},debounce:f=>f},{get:(t,p)=>p in t?t[p]:class{}});
 const src=fs.readFileSync(path.join(__dirname,'../main.ts'),'utf8');
 const functions=['parseSideNotesTransferBundle','getSideNotesSettingsFromPluginData','sanitizeOptionalVaultPath','normalizeSideNotesId','getParagraphFingerprint','getBlockId','stripBlockId','extractInternalLinkPaths','cloneBlockNotesRecord','remapSideNoteMediaPaths','getProtectedRangeInsertPosition','getUnprotectedDeletionRanges','createBlockIdHiderExtension','normalizeSideNoteUrl','DEFAULT_SETTINGS','DEFAULT_DATA'];
 const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const context={require:n=>n==='obsidian'?obsidian:require(n),exports:{},console:{error(){},warn(){}},window:{},setTimeout,clearTimeout,URL,TextEncoder,TextDecoder,Buffer,atob,btoa,crypto:require('node:crypto').webcrypto};
 vm.runInNewContext(js+'\nexports.hooks={'+functions.join(',')+'};',context);
 const p=new context.exports.default();p.app={vault,metadataCache:{getFileCache:f=>({frontmatter:cache.get(f.path)||{},links:[],embeds:[]}),resolvedLinks:{},getFirstLinkpathDest:p=>vault.getAbstractFileByPath(p)},fileManager:{processFrontMatter:async(f,fn)=>{const data=cache.get(f.path)||{};fn(data);cache.set(f.path,data);}}};
 p.settings={...context.exports.hooks.DEFAULT_SETTINGS};p.sideNotesData={files:{},sideNoteIds:{},filesBySideNoteId:{}};p.saveData=async()=>{};p.loadData=async()=>({});p.refreshViews=()=>{};p.refreshContext=()=>{};
 return {p,h:context.exports.hooks,root,guard,vault,cache,notices,TFile};
}
module.exports={harness};
