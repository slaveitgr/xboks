import fs from 'node:fs/promises';
class Signals {
 constructor(){this.signals=new Map();this.next=1;}
 connect(name,callback){const id=this.next++;this.signals.set(id,{name,callback});return id;}
 disconnect(id){this.signals.delete(id);}
 emit(name,...args){for(const signal of [...this.signals.values()])if(signal.name===name)signal.callback(this,...args);}
}
export async function policyFixture(){
 const windows=[],timers=new Map(),warnings=[],activated=[],raised=[],display=new Signals(),wm=new Signals(),tracker=new Signals();let allowed=true,nextTimer=1;
 const Meta={WindowType:{NORMAL:0,DIALOG:3,MODAL_DIALOG:4,DESKTOP:1},MaximizeFlags:{NONE:0,HORIZONTAL:1,VERTICAL:2,BOTH:3}};
 const GLib={PRIORITY_DEFAULT_IDLE:100,SOURCE_REMOVE:false,idle_add(_priority,callback){const id=nextTimer++;timers.set(id,callback);return id;},Source:{remove:id=>timers.delete(id)}};
 tracker.get_window_app=window=>window.app;
 const Shell={WindowTracker:{get_default:()=>tracker}};
 const Main={activateWindow(window){activated.push(window.id);display.focus_window=window;}};
 const global={display,window_manager:wm,get_window_actors:()=>windows.map(meta_window=>({meta_window})),get_current_time:()=>42};
 const source=(await fs.readFile('desktop/gnome/xboks-experience@slaveitgr.github.io/window-policy.js','utf8')).replace(/^import .*;\r?\n/gm,'').replace('export class ExperienceWindowPolicy','class ExperienceWindowPolicy');
 const Policy=new Function('GLib','Meta','Shell','Main','global',source+'\nreturn ExperienceWindowPolicy;')(GLib,Meta,Shell,Main,global);
 const policy=new Policy({allowed:()=>allowed,warn:warning=>warnings.push(warning)});
 const create=(id,options={})=>{
  const window=new Signals();
  Object.assign(window,{id,title:`App ${id}`,type:0,skip_taskbar:false,attached:false,transient:null,override:false,app:{},mapped:true,fullscreen:false,minimized:false,flags:0,alive:true,calls:[],...options,
   get_window_type(){return this.type;},is_attached_dialog(){return this.attached;},get_transient_for(){return this.transient;},is_override_redirect(){return this.override;},get_title(){return this.title;},raise(){raised.push(this.id);},
   is_fullscreen(){if(!this.alive)throw Error('closed');return this.fullscreen;},get_maximize_flags(){if(!this.alive)throw Error('closed');return this.flags;},can_maximize(){return !this.fixed;},
   change(property,value){this[property]=value;this.emit(`notify::${property}`);},
   setFlags(flags){this.flags=flags;this.emit('notify::maximized-horizontally');this.emit('notify::maximized-vertically');},
   make_fullscreen(){this.calls.push('fullscreen');if(this.rejectFullscreen)return;if(this.throwFullscreen)throw Error('client-refused');this.change('fullscreen',true);if(this.stealFocus)display.focus_window=this;},
   unmake_fullscreen(){this.calls.push('unfullscreen');this.change('fullscreen',false);},
   maximize(){this.calls.push('maximize');this.setFlags(3);},set_maximize_flags(flags){this.calls.push(`maximize-${flags}`);this.setFlags(this.flags|flags);},set_unmaximize_flags(flags){this.calls.push(`unmaximize-${flags}`);this.setFlags(this.flags&~flags);},
   minimize(){this.calls.push('minimize');this.change('minimized',true);},unminimize(){this.calls.push('unminimize');this.change('minimized',false);if(!this.mapped)this.change('mapped',true);},
   close(){this.emit('unmanaging');this.alive=false;windows.splice(windows.indexOf(this),1);this.emit('unmanaged');},
  });windows.push(window);return window;
 };
 return{policy,Meta,display,wm,tracker,windows,timers,warnings,activated,raised,create,
  set allowed(value){allowed=value;},get allowed(){return allowed;},
  idle(){for(const[id,callback]of[...timers]){timers.delete(id);callback();}},
 };
}
