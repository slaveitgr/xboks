import fs from 'node:fs/promises';
import {SwitcherSelection, boundedLabel, primaryModifier, cardGeometry} from '../../../desktop/gnome/xboks-experience@slaveitgr.github.io/switcher-state.js';
class Signals {
 constructor(){this.signals=new Map();this.next=1;}
 connect(name,callback){const id=this.next++;this.signals.set(id,{name,callback});return id;}
 disconnect(id){this.signals.delete(id);}
 emit(name,...args){let result;for(const item of [...this.signals.values()])if(item.name===name)result=item.callback(this,...args);return result;}
}
class Actor extends Signals {
 constructor(options={}){super();Object.assign(this,options);this.children=[];this.actions=[];this.destroyed=false;this.destroyCount=0;}
 add_child(child){child.parent=this;this.children.push(child);}get_children(){return[...this.children];}
 set_position(x,y){this.x=x;this.y=y;}set_size(width,height){const oldWidth=this.width,oldHeight=this.height;this.width=width;this.height=height;if(oldWidth!==width)this.emit('notify::width');if(oldHeight!==height)this.emit('notify::height');}
 get_size(){return[this.width??1280,this.height??720];}set_child(child){child.parent=this;this.children=[child];}set_label(label){this.label=label;}
 add_action(action){this.actions.push(action);}grab_key_focus(){this.focused=true;}
 add_style_class_name(name){this.style_class=[...new Set(`${this.style_class??''} ${name}`.trim().split(/\s+/))].join(' ');}
 remove_style_class_name(name){this.style_class=(this.style_class??'').split(/\s+/).filter(value=>value!==name).join(' ');}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.destroyCount++;this.emit('destroy');for(const child of [...this.children])child.destroy();this.children=[];if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
}
export async function switcherFixture({modalAvailable=true,desktopPreference='default',systemPreference=0,desktopSettingsAvailable=true}={}){
 const timers=new Map(),clones=[],chrome=new Set(),activated=[],deleted=[],changes=[];let nextTimer=1,currentKey=0,currentModifiers=8,allowed=true,leaves=0,xbox=0,modal=0,clock='12:34:00';
 const Clutter={ActorAlign:{CENTER:0},FixedLayout:class{},EVENT_PROPAGATE:false,EVENT_STOP:true,ModifierType:{CONTROL_MASK:4,SUPER_MASK:67108864,MOD1_MASK:8,SHIFT_MASK:1},
  KEY_Left:65361,KEY_Right:65363,KEY_Up:65362,KEY_Down:65364,KEY_Escape:65307,KEY_Return:65293,KEY_space:32,KEY_Tab:65289,KEY_ISO_Left_Tab:65056,
  Clone:class extends Actor{constructor(options){super(options);clones.push(this);}},
  KeyController:class extends Signals{get_key(){return[true,currentKey,0];}get_state(){return[true,currentModifiers,0,0];}},
 };
 const desktop=new Signals(),system=new Signals();desktop.preference=desktopPreference;desktop.get_string=()=>desktop.preference;system.color_scheme=systemPreference;
 const Gio={SettingsSchemaSource:{get_default:()=>({lookup:()=>desktopSettingsAvailable?{has_key:()=>true}:null})},Settings:class{constructor(){return desktop;}}};
 const St={Widget:Actor,BoxLayout:Actor,Label:Actor,Icon:Actor,Button:Actor,Settings:{get:()=>system},SystemColorScheme:{DEFAULT:0,PREFER_DARK:1,PREFER_LIGHT:2}};
 const GLib={PRIORITY_DEFAULT:0,PRIORITY_DEFAULT_IDLE:100,SOURCE_CONTINUE:true,SOURCE_REMOVE:false,get_language_names:()=>['en_US'],
  timeout_add_seconds(_priority,_seconds,callback){const id=nextTimer++;timers.set(id,callback);return id;},
  idle_add(_priority,callback){const id=nextTimer++;timers.set(id,callback);return id;},Source:{remove:id=>timers.delete(id)},DateTime:{new_now_local:()=>({format:()=>clock})}};
 const wm=new Signals(),display=new Signals(),layout=new Signals(),tracker=new Signals(),windows=[];
 const makeWindow=(id,title)=>{
  const actor=new Actor({width:1280,height:720}),app={get_id:()=>`app${id}.desktop`,get_name:()=>`App ${id}`,create_icon_texture:size=>new Actor({iconSize:size})};
  const window=Object.assign(new Signals(),{id,app,title,skip_taskbar:false,is_attached_dialog:()=>false,get_stable_sequence:()=>id,get_wm_class:()=>`App${id}`,get_title(){return this.title;},get_compositor_private:()=>actor,
   delete(timestamp){deleted.push({id,timestamp});windows.splice(windows.indexOf(window),1);this.emit('unmanaged');wm.emit('destroy',actor);}});
  return window;
 };
 windows.push(makeWindow(1,'First real fixture window'),makeWindow(2,'Second window'));
 Object.assign(display,{get_tab_list:()=>windows,focus_window:windows[0]});
 Object.assign(layout,{focusMonitor:{x:1920,y:0,width:1920,height:1080},primaryMonitor:{x:0,y:0,width:1920,height:1080},addTopChrome:actor=>chrome.add(actor),removeChrome:actor=>chrome.delete(actor)});
 const grab=new Signals();grab.revoked=!modalAvailable;grab.is_revoked=()=>grab.revoked;
 const Main={layoutManager:layout,pushModal(){modal++;return grab;},popModal(){modal--;},activateWindow(window,timestamp){activated.push({id:window.id,timestamp});}};
 tracker.get_window_app=window=>window.app;
 const Shell={ActionMode:{ALL:0xffff},WindowTracker:{get_default:()=>tracker}},Meta={TabList:{NORMAL_ALL:0}};
 const themeSource=(await fs.readFile('desktop/gnome/xboks-experience@slaveitgr.github.io/switcher-theme.js','utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('export function ','function ').replace('export class SwitcherTheme','class SwitcherTheme');
 const SwitcherTheme=new Function('Gio','St',themeSource+'\nreturn SwitcherTheme;')(Gio,St);
 const source=(await fs.readFile('desktop/gnome/xboks-experience@slaveitgr.github.io/switcher.js','utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('export function ','function ').replace('export class XboksSwitcher','class XboksSwitcher');
 const Class=new Function('Clutter','GLib','Meta','Shell','St','Main','SwitcherSelection','boundedLabel','primaryModifier','cardGeometry','SwitcherTheme','global',source+'\nreturn XboksSwitcher;')(Clutter,GLib,Meta,Shell,St,Main,SwitcherSelection,boundedLabel,primaryModifier,cardGeometry,SwitcherTheme,{display,window_manager:wm,get_current_time:()=>42,get_pointer:()=>[0,0,currentModifiers]});
 const switcher=new Class({leave(){leaves++;},xbox(){xbox++;},changed:value=>changes.push(value),allowed:()=>allowed});
 return{switcher,windows,display,layout,tracker,chrome,clones,timers,activated,deleted,changes,Clutter,desktop,system,Actor,
  clock(value){clock=value;},
  theme(preference,systemValue=system.color_scheme){desktop.preference=preference;system.color_scheme=systemValue;desktop.emit('changed::color-scheme','color-scheme');system.emit('notify::color-scheme');},
  revoke(){grab.revoked=true;grab.emit('notify::revoked');},
  get modal(){return modal;},get leaves(){return leaves;},get xbox(){return xbox;},set allowed(value){allowed=value;},
  press(key,modifiers=0){currentKey=key;currentModifiers=modifiers;return switcher._root.actions[0].emit('key-press');},
  modifiers(modifiers){currentModifiers=modifiers;return switcher._root.actions[0].emit('modifier-change');},
  set pointerModifiers(modifiers){currentModifiers=modifiers;},
  runIdle(){for(const[id,callback]of[...timers]){if(callback()===false)timers.delete(id);}},
 };
}
