import { Pin, Star } from 'lucide-react';
import { ChevronRight, Gamepad2, Globe, GuideAudioIcon, GuideCaptureIcon, GuideFriendsIcon, GuideHomeIcon, GuideSettingsIcon, GuidePerformanceIcon, GuideWidgetsIcon, Images } from './XboxIcons';
import { SpotifyLogo } from './SpotifyLogo';
import { useReferenceLocale } from './ReferenceLocale';
import type { GuideWidgetId, GuideWidgetPreferences } from './guide-widget-preferences';
export const guideWidgetDefinitions = [
 {id:'home',label:'Home',greek:'Αρχική οθόνη',icon:GuideHomeIcon},
 {id:'settings',label:'Settings',greek:'Ρυθμίσεις',icon:GuideSettingsIcon},
 {id:'browser',label:'Browser',greek:'Πρόγραμμα περιήγησης',icon:Globe},
 {id:'audio',label:'Audio',greek:'Ήχος',icon:GuideAudioIcon},
 {id:'capture',label:'Capture',greek:'Εγγραφή',icon:GuideCaptureIcon},
 {id:'performance',label:'Performance',greek:'Επιδόσεις',icon:GuidePerformanceIcon,pinnable:true},
 {id:'spotify',label:'Spotify',greek:'Spotify',icon:SpotifyLogo,pinnable:true},
 {id:'social',label:'Xbox Social',greek:'Κοινωνική δικτύωση XBOX',icon:GuideFriendsIcon},
 {id:'gallery',label:'Gallery',greek:'Συλλογή',icon:Images,pinnable:true},
] as const;
export const guideWidgetDefinition=(id:GuideWidgetId)=>guideWidgetDefinitions.find(item=>item.id===id)!;
export function GuideWidgetDirectory({preferences,toggle,open}:{preferences:GuideWidgetPreferences;toggle:(key:'favorites'|'pinned',id:GuideWidgetId)=>void;open:(id:GuideWidgetId)=>void}) {
 const {text:t}=useReferenceLocale();return <div className="guide-widget-directory">
  <p className="guide-muted">{t('Choose a widget. Favorites appear on the Game Bar toolbar.','Επιλέξτε ένα γραφικό στοιχείο. Τα αγαπημένα εμφανίζονται στη γραμμή Game Bar.')}</p>
  {guideWidgetDefinitions.filter(item=>!preferences.hidden.includes(item.id)).map(item=><div className="guide-widget-directory-row" key={item.id}>
   <button className="guide-row" data-guide-widget-open={item.id} onClick={()=>open(item.id)}><item.icon/><span>{t(item.label,item.greek)}</span><ChevronRight/></button>
   <button aria-label={`${preferences.favorites.includes(item.id)?t('Remove favorite','Αφαίρεση αγαπημένου'):t('Favorite','Αγαπημένο')}: ${t(item.label,item.greek)}`} aria-pressed={preferences.favorites.includes(item.id)} onClick={()=>toggle('favorites',item.id)}><Star/></button>
   {'pinnable' in item?<button aria-label={`${t('Keep open in Game Bar','Διατήρηση ανοικτού στο Game Bar')}: ${t(item.label,item.greek)}`} aria-pressed={preferences.pinned.includes(item.id)} onClick={()=>toggle('pinned',item.id)}><Pin/></button>:null}
  </div>)}
  <hr/><h3><GuideWidgetsIcon/>{t('More widgets','Περισσότερα γραφικά στοιχεία')}</h3>
  {[[t('Widget Store','Χώρος αποθήκευσης γραφικών στοιχείων'),t('Windows Game Bar extensions cannot be installed in this Linux client.','Οι επεκτάσεις της γραμμής Game Bar των Windows δεν εγκαθίστανται σε αυτήν την εφαρμογή Linux.')],[t('Xbox Achievements','Επιτεύγματα XBOX'),t('Open a game in your library to view its available achievements.','Ανοίξτε ένα παιχνίδι στη βιβλιοθήκη για να δείτε τα διαθέσιμα επιτεύγματά του.')],[t('Looking for Group','Αναζήτηση για ομάδα XBOX'),t('Xbox group discovery is not available in this version.','Η αναζήτηση ομάδας Xbox δεν είναι διαθέσιμη σε αυτήν την έκδοση.')],[t('Display and Resources','Οθόνη και Πόροι'),t('Desktop display changes and per-process resource controls are not available in this widget.','Οι αλλαγές οθόνης και οι πόροι ανά διεργασία δεν είναι διαθέσιμοι σε αυτό το γραφικό στοιχείο.')]].map(([label,reason])=><div className="guide-unavailable-widget" key={label}><button className="guide-row" disabled><Gamepad2/>{label}</button><p className="guide-muted">{reason}</p></div>)}
  <p className="guide-muted">{t('Pinned widgets stay open beside the selected widget while Game Bar is open. Closing Game Bar hides all widgets.','Τα καρφιτσωμένα στοιχεία παραμένουν δίπλα στο επιλεγμένο όσο το Game Bar είναι ανοικτό. Το κλείσιμο του Game Bar αποκρύπτει όλα τα στοιχεία.')}</p>
 </div>;
}
