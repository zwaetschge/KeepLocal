const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');

test('a changed application changes worker identity and precaches its complete asset set',async()=>{
 const {stampServiceWorker}=await import(pathToFileURL(path.join(root,'build-tools/serviceWorkerBuild.mjs')));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'keeplocal-sw-'));
 try{
  const worker=await fs.readFile(path.join(root,'public/service-worker.js'),'utf8');
  await fs.mkdir(path.join(directory,'assets'));
  const build=async code=>{
   await fs.writeFile(path.join(directory,'service-worker.js'),worker);
   await fs.writeFile(path.join(directory,'index.html'),'<html><head></head><body></body></html>');
   await fs.writeFile(path.join(directory,'assets/app-same-name.js'),code);
   await fs.writeFile(path.join(directory,'assets/style-hashed.css'),'body{color:red}');
   return stampServiceWorker(directory,['assets/app-same-name.js','assets/style-hashed.css']);
  };
  const first=await build('versionA');const same=await build('versionA');const second=await build('versionB');
  assert.equal(first.buildId,same.buildId,'identical builds must not create update loops');
  assert.notEqual(first.buildId,second.buildId,'JS changes must change service-worker bytes, even with identical filenames');
  const result=await fs.readFile(path.join(directory,'service-worker.js'),'utf8');
  assert.ok(result.includes(second.buildId));assert.ok(result.includes('/assets/app-same-name.js'));assert.ok(result.includes('/assets/style-hashed.css'));
  assert.doesNotMatch(result,/__KEEPLOCAL_BUILD_/);new vm.Script(result);
  assert.ok((await fs.readFile(path.join(directory,'index.html'),'utf8')).includes(second.buildId));
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

async function registerFixture({alreadyInstalling=false,controller={}}={}){
 const source=await fs.readFile(path.join(root,'src/index.jsx'),'utf8');
 const script=source.slice(source.indexOf("if ('serviceWorker' in navigator")).replaceAll('import.meta.env.PROD','true');
 const events=[], listeners=new Map();
 const worker=new EventTarget();worker.state='installing';
 const registration=new EventTarget();registration.waiting=null;registration.installing=alreadyInstalling?worker:null;
 registration.update=async()=>{
  if(!alreadyInstalling){registration.installing=worker;registration.dispatchEvent(new Event('updatefound'));}
  worker.state='installed';registration.waiting=worker;worker.dispatchEvent(new Event('statechange'));
 };
 const context={navigator:{serviceWorker:{register:async()=>registration,controller}},window:{addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},console};
 vm.runInNewContext(script,context);await listeners.get('load')();
 return {events,worker};
}

test('updates finishing inside registration.update are announced',async()=>{
 const {events,worker}=await registerFixture();assert.ok(events.some(e=>e.type==='keeplocal:update-available'&&e.detail.sw===worker));
});
test('an installation already running when register resolves is observed',async()=>{
 const {events,worker}=await registerFixture({alreadyInstalling:true});assert.ok(events.some(e=>e.detail.sw===worker));
});
