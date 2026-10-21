import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const source=await fs.readFile('scripts/linux/deb-after-install.sh','utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'xboks-native-package-'));
 const parent=path.join(root,'system opt'),app=path.join(parent,'xboks'),tools=path.join(root,'tools'),state=path.join(root,'calls.json');
 await fs.mkdir(path.join(app,'resources'),{recursive:true});await fs.mkdir(tools);await fs.writeFile(state,JSON.stringify({calls:[],modes:{}}));
 for(const directory of[parent,app,path.join(app,'resources')])await fs.chmod(directory,0o755);
 const native=Buffer.from('Synthetic native fixture, never executed.'),helper=Buffer.from('Matching helper fixture, never executed.');
 await fs.writeFile(path.join(app,'xboks'),'#!/bin/sh\nexit 99\n',{mode:0o755});
 await fs.writeFile(path.join(app,'xboks.bin'),native,{mode:0o755});await fs.writeFile(path.join(app,'chrome-sandbox'),helper,{mode:0o755});
 await fs.writeFile(path.join(app,'resources/xboks-sandbox.sha256'),`${hash(native)}  xboks.bin\n${hash(helper)}  chrome-sandbox\n`,{mode:0o644});
 // Only this disposable copy substitutes the root directory and command PATH.
 // The shipped script accepts neither a root override nor test environment.
 const script=path.join(root,'postinst');
 await fs.writeFile(script,source.replace('PATH=/usr/sbin:/usr/bin:/sbin:/bin',`PATH='${tools}:/usr/bin:/bin'`)
  .replace("APP_DIR='/opt/xboks'",`APP_DIR='${app}'`).replace("PARENT_DIR='/opt'",`PARENT_DIR='${parent}'`));
 const tool=`#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),name=path.basename(process.argv[1]),stateFile=process.env.SANDBOX_FIXTURE_STATE,state=JSON.parse(fs.readFileSync(stateFile));
if(name==='id'){process.stdout.write((process.env.SANDBOX_FIXTURE_UID||'0')+'\\n');}
else if(name==='stat'){const file=args.at(-1),st=fs.lstatSync(file),fmt=args[args.indexOf('-c')+1],mode=state.modes[file]||(st.mode&0o7777).toString(8),uid=file===process.env.SANDBOX_FIXTURE_UNOWNED?'1000':'0';const values={'%u:%g':uid+':0','%a':mode,'%h':String(st.nlink),'%s':String(st.size),'%u:%g:%a':uid+':0:'+mode};if(!(fmt in values))process.exit(98);process.stdout.write(values[fmt]+'\\n');}
else{state.calls.push({name,args});if(name==='chmod')state.modes[args.at(-1)]=args[0];fs.writeFileSync(stateFile,JSON.stringify(state));}
`;
 for(const name of['id','stat','chmod','chown','update-alternatives','update-mime-database','update-desktop-database'])await fs.writeFile(path.join(tools,name),tool,{mode:0o755});
 const run=(extra={})=>spawnSync('/bin/sh',[script,'configure'],{env:{...process.env,SANDBOX_FIXTURE_STATE:state,...extra},encoding:'utf8',timeout:10000});
 return{root,parent,app,state,run,calls:async()=>JSON.parse(await fs.readFile(state,'utf8')).calls};
}
async function scenario(action){const f=await fixture();try{await action(f);}finally{await fs.rm(f.root,{recursive:true,force:true});}}
test('native DEB validates the exact packaged pair and enables only its root-owned helper',()=>scenario(async f=>{
 const result=f.run();assert.equal(result.status,0,result.stderr);
 const calls=await f.calls();assert.deepEqual(calls.slice(0,3),[
  {name:'chown',args:['0:0','--',path.join(f.app,'chrome-sandbox')]},
  {name:'chmod',args:['4755','--',path.join(f.app,'chrome-sandbox')]},
  {name:'update-alternatives',args:['--install','/usr/bin/xboks','xboks',path.join(f.app,'xboks'),'100']},
 ]);
 // Elevation commands are recorded, not performed on any fixture or host file.
 assert.equal((await fs.stat(path.join(f.app,'chrome-sandbox'))).mode&0o7777,0o755);
}));
test('a non-root configuration fails before permission or system integration changes',()=>scenario(async f=>{
 const result=f.run({SANDBOX_FIXTURE_UID:'1000'});assert.notEqual(result.status,0);assert.match(result.stderr,/configured.*root/);assert.deepEqual(await f.calls(),[]);
}));
test('changed native/helper bytes are refused before granting SUID',async()=>{
 for(const name of['xboks.bin','chrome-sandbox'])await scenario(async f=>{
  await fs.appendFile(path.join(f.app,name),'changed');const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/checksum mismatch/);assert.deepEqual(await f.calls(),[]);
 });
});
test('symlinked, writable or unowned paths are refused before SUID or alternatives',async()=>{
 for(const change of[
  async f=>{const helper=path.join(f.app,'chrome-sandbox');await fs.rename(helper,helper+'.original');await fs.symlink(helper+'.original',helper);},
  async f=>fs.chmod(f.app,0o777),async f=>fs.chmod(path.join(f.app,'chrome-sandbox'),0o775),
 ])await scenario(async f=>{await change(f);assert.notEqual(f.run().status,0);assert.deepEqual(await f.calls(),[]);});
 await scenario(async f=>{assert.notEqual(f.run({SANDBOX_FIXTURE_UNOWNED:path.join(f.app,'xboks.bin')}).status,0);assert.deepEqual(await f.calls(),[]);});
});
test('missing, malformed and extra checksum paths cannot select another elevated helper',async()=>{
 for(const value of[null,`${'a'.repeat(64)}  ../other\n${'b'.repeat(64)}  chrome-sandbox\n`,`${'a'.repeat(64)}  xboks.bin\n${'b'.repeat(64)}  chrome-sandbox\nextra\n`])await scenario(async f=>{
  const manifest=path.join(f.app,'resources/xboks-sandbox.sha256');if(value===null)await fs.unlink(manifest);else await fs.writeFile(manifest,value);
  assert.notEqual(f.run().status,0);assert.deepEqual(await f.calls(),[]);
 });
});
test('production packaging keeps both targets and never adds a sandbox-disable fallback',async()=>{
 const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
 assert.ok(pkg.build.linux.target.includes('deb'));assert.ok(pkg.build.linux.target.includes('AppImage'));
 assert.equal(pkg.build.deb.afterInstall,'scripts/linux/deb-after-install.sh');
 assert.match(source,/APP_DIR='\/opt\/xboks'/);assert.match(source,/PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
 assert.doesNotMatch(source,/--no-sandbox|disable-setuid-sandbox|apparmor_restrict_unprivileged_userns|sysctl|CHROME_DEVEL_SANDBOX/);
 assert.doesNotMatch(await fs.readFile('scripts/launcher-font-wrapper.sh','utf8'),/--no-sandbox|disable-setuid-sandbox/);
});
