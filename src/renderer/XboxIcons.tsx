import { forwardRef, type CSSProperties } from 'react';
import * as Lucide from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import './xbox-icons.css';

const asset = (filename: string) => new URL(`./original-xbox/${filename}`, document.baseURI).href;
/** The kit is generated locally from the supplied package; it is not in Git. */
export function loadOriginalXboxUi() {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = asset('theme.css');
  link.onload = () => { document.documentElement.setAttribute('data-original-xbox-ui', ''); };
  link.onerror = () => { document.documentElement.removeAttribute('data-original-xbox-ui'); };
  document.head.append(link);
}

function icon(name: string, fallback: LucideIcon, glyph?: string, font: 'mdl2' | 'xbox' = 'mdl2'): LucideIcon {
  const Component = forwardRef<SVGSVGElement, LucideProps>((props, ref) => {
    const { className = '', size, style, ...rest } = props;
    const Fallback = fallback;
    const mask = typeof document === 'undefined' ? '' : `url(${JSON.stringify(asset(`icons/${name}.svg`))})`;
    return <span className={`xbox-icon xbox-icon-${name} ${className}`} aria-hidden="true" style={{ ...(size ? { width: size, height: size } : {}), ...style }}>
      {glyph ? <span className={`xbox-original-glyph${font === 'xbox' ? ' xbox-fluent-glyph' : ''}`}>{glyph}</span> : <svg {...rest} className="xbox-original-icon" viewBox="0 0 32 32" style={{ maskImage: mask, WebkitMaskImage: mask } as CSSProperties}><rect width="32" height="32" fill="currentColor" /></svg>}
      <Fallback {...rest} className="xbox-fallback-icon" ref={ref} />
    </span>;
  });
  Component.displayName = `XboxIcon(${name})`;
  return Component;
}
export const Home = icon('Home', Lucide.Home);
export const Library = icon('Library', Lucide.Library, '\uE8F1');
export const Store = icon('Store', Lucide.Store);
export const Users = icon('XboxSocial', Lucide.Users, '\uE939', 'xbox');
export const Bell = icon('Ringer', Lucide.Bell);
export const MonitorPlay = icon('RemotePlay', Lucide.MonitorPlay, '\uE9E9', 'xbox');
export const Cable = icon('NetworkConnected', Lucide.Cable);
export const Search = icon('Search', Lucide.Search);
export const Settings = icon('Settings', Lucide.Settings);
export const Settings2 = icon('Settings', Lucide.Settings2);
export const Cog = icon('Settings', Lucide.Cog);
export const Gamepad2 = icon('ControllerSettings', Lucide.Gamepad2);
export const CircleUserRound = icon('Profile', Lucide.CircleUserRound);
export const ChevronLeft = icon('ChevronLeft', Lucide.ChevronLeft);
export const ChevronRight = icon('ChevronRight', Lucide.ChevronRight);
export const ChevronUp = icon('ChevronUp', Lucide.ChevronUp);
export const ChevronDown = icon('ChevronDown', Lucide.ChevronDown);
export const X = icon('Close', Lucide.X);
export const MoreHorizontal = icon('MoreActions', Lucide.MoreHorizontal);
export const Download = icon('Download', Lucide.Download);
export const ArrowDownToLine = icon('Download', Lucide.ArrowDownToLine);
export const Pause = icon('Pause', Lucide.Pause);
export const Play = icon('Play', Lucide.Play);
export const RefreshCw = icon('Refresh', Lucide.RefreshCw);
export const Check = icon('Accept', Lucide.Check);
export const Plus = icon('Add', Lucide.Plus);
export const FolderOpen = icon('Folder', Lucide.FolderOpen);
export const Trash2 = icon('Delete', Lucide.Trash2);
export const CircleAlert = icon('Warning', Lucide.CircleAlert);
export const Info = icon('Info', Lucide.Info);
export const ListFilter = icon('Filter', Lucide.ListFilter);
export const ArrowDownWideNarrow = icon('SortLInes', Lucide.ArrowDownWideNarrow);
export const BookmarkPlus = icon('PlaylistAdd', Lucide.BookmarkPlus);
export const Clock3 = icon('Clock', Lucide.Clock3);
export const Gift = icon('GiftCard', Lucide.Gift);
export const ExternalLink = icon('Launch', Lucide.ExternalLink);
export const LogOut = icon('SignOut', Lucide.LogOut);
export const Globe = icon('Globe', Lucide.Globe);
export const Camera = icon('Camera', Lucide.Camera, '\uE722');
export const Volume2 = icon('Volume', Lucide.Volume2);
export const VolumeX = icon('MuteSolid', Lucide.VolumeX);
export const Heart = icon('Heart', Lucide.Heart);
export const Maximize = icon('GamingFullScreen', Lucide.Maximize);
export const Minimize = icon('BackToWindow', Lucide.Minimize, '\uE7E3', 'xbox');
export const CheckCheck = icon('Completed', Lucide.CheckCheck);

export const GamePassBadge = icon('GamePassOutline', Lucide.Gamepad2);
export const Mic = icon('Microphone', Lucide.Mic, '\uE963', 'xbox');
export const HelpCircle = icon('Help', Lucide.HelpCircle, '\uE897');
export const Shield = icon('XboxInsiderHelmet', Lucide.Shield);
export const ArrowLeft = icon('ChevronLeft', Lucide.ArrowLeft);
export const Images = icon('Images', Lucide.Images, '\uE927', 'xbox');
export const Eye = icon('View', Lucide.Eye);
export const LockKeyhole = icon('Lock', Lucide.LockKeyhole);
export const Trophy = icon('Trophy', Lucide.Trophy, '\uE9C1', 'xbox');
export const PackageCheck = icon('Completed', Lucide.PackageCheck);
export const Rocket = icon('GameLaunch', Lucide.Rocket);
export const InstalledCheck = icon('CheckInCircle', Lucide.Check);
// Game Bar uses the filled variants, while the launcher's rail uses outlines.
export const GuideHomeIcon = icon('GuideHome', Lucide.Home, '\uEABF', 'xbox');
export const GuideSettingsIcon = icon('GuideSettings', Lucide.Cog, '\uEACD', 'xbox');
export const GuideFriendsIcon = icon('GuideFriends', Lucide.Users, '\uE822', 'xbox');
export const GuideAudioIcon = icon('GuideAudio', Lucide.Volume2, '\uE80C', 'xbox');
export const GuideCaptureIcon = icon('GuideCapture', Lucide.Camera, '\uE7D3', 'xbox');
