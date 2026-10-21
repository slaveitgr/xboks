// Synthetic Spotify-shaped MPRIS service. Run ONLY inside dbus-run-session.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
const name = ARGV[0] ?? 'org.mpris.MediaPlayer2.spotify';
const loop = new GLib.MainLoop(null, false), connection = Gio.DBus.session;
const PLAYER='org.mpris.MediaPlayer2.Player', ROOT='org.mpris.MediaPlayer2';
let playback = 'Playing', position = 12345000, canControl = true, title = 'Track "one" Δ', canPause = true;
const metadata = () => ({ 'mpris:trackid': new GLib.Variant('o', '/com/spotify/track/synthetic'),
  'mpris:length': new GLib.Variant('x', 180000000), 'xesam:title': new GLib.Variant('s', title),
  'xesam:artist': new GLib.Variant('as', ['Synthetic artist']), 'xesam:album': new GLib.Variant('s', 'Fixture album'),
  'mpris:artUrl': new GLib.Variant('s', 'https://i.scdn.co/image/synthetic') });
const event = (method, detail) => print(JSON.stringify({ event: 'called', method, ...(detail ? {detail} : {}) }));
const service={
  get Identity(){return 'Spotify';}, get DesktopEntry(){return 'spotify';}, get CanRaise(){return true;},
  get PlaybackStatus(){return playback;}, get Metadata(){return metadata();}, get Position(){return position;},
  get CanControl(){return canControl;}, get CanPlay(){return true;}, get CanPause(){return canPause;},
  get CanSeek(){return true;}, get CanGoNext(){return true;}, get CanGoPrevious(){return false;},
  Raise(){event('Raise');}, Next(){event('Next');title='Next synthetic track'; changed();}, Previous(){event('Previous');},
  Pause(){event('Pause');playback='Paused';changed();}, Play(){event('Play');playback='Playing';changed();},
  SetPosition(track, value){event('SetPosition',{track,position:value});if(track==='/com/spotify/track/synthetic'){position=value;exported.emit_signal('Seeked',new GLib.Variant('(x)',[position]));}},
};
const definition=`<node>
<interface name="${ROOT}"><method name="Raise"/><property name="Identity" type="s" access="read"/><property name="DesktopEntry" type="s" access="read"/><property name="CanRaise" type="b" access="read"/></interface>
<interface name="${PLAYER}"><method name="Pause"/><method name="Play"/><method name="Next"/><method name="Previous"/><method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method><signal name="Seeked"><arg type="x"/></signal>
<property name="PlaybackStatus" type="s" access="read"/><property name="Metadata" type="a{sv}" access="read"/><property name="Position" type="x" access="read"/>
<property name="CanControl" type="b" access="read"/><property name="CanPlay" type="b" access="read"/><property name="CanPause" type="b" access="read"/><property name="CanSeek" type="b" access="read"/><property name="CanGoNext" type="b" access="read"/><property name="CanGoPrevious" type="b" access="read"/>
</interface></node>`;
const node=Gio.DBusNodeInfo.new_for_xml(definition);
const rootExported=Gio.DBusExportedObject.wrapJSObject(node.interfaces[0],service);
const exported=Gio.DBusExportedObject.wrapJSObject(node.interfaces[1],service);
function changed(){exported.emit_property_changed('PlaybackStatus',new GLib.Variant('s',playback));exported.emit_property_changed('CanControl',new GLib.Variant('b',canControl));exported.emit_property_changed('CanPause',new GLib.Variant('b',canPause));exported.emit_property_changed('Metadata',new GLib.Variant('a{sv}',metadata()));}
rootExported.export(connection,'/org/mpris/MediaPlayer2');
exported.export(connection,'/org/mpris/MediaPlayer2');
Gio.bus_own_name_on_connection(connection,name,Gio.BusNameOwnerFlags.NONE,()=>print(JSON.stringify({event:'ready',name})),()=>loop.quit());
const input=new Gio.DataInputStream({base_stream:new GioUnix.InputStream({fd:0,close_fd:false})});
function read(){input.read_line_async(GLib.PRIORITY_DEFAULT,null,(stream,result)=>{try{const[line]=stream.read_line_finish_utf8(result);if(line===null){loop.quit();return;}const value=JSON.parse(line);if(typeof value.canControl==='boolean')canControl=value.canControl;if(typeof value.canPause==='boolean')canPause=value.canPause;if(typeof value.playback==='string')playback=value.playback;changed();print(JSON.stringify({event:'configured'}));read();}catch{loop.quit();}});}
read();loop.run();
