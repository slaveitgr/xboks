import {afterEach, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProfilePage} from './ProfilePage';
import {SubscriptionBadge} from './SubscriptionBadge';
import {Sidebar} from './App';
import {ShellFlyout} from './XboxShell';
import {demoSnapshot} from '../shared/demo-data';
afterEach(()=>vi.unstubAllGlobals());
const active=(ids:string[])=>({status:'active',productIds:ids,checkedAt:new Date().toISOString()});
const auth=()=>({stored:true as const,running:false,username:'example@example.test',gamertag:'ExampleGamer',note:'',profile:{gamertag:'ExampleGamer',gamerscore:0,bio:'A real biography\nwith two lines',location:'Example location'},subscription:active(['CFQ7TTC0KHS0']) as any});
it('shows returned identity, zero score, biography and subscription without fabricated online/follower counts',()=>{
 const html=renderToStaticMarkup(<ProfilePage auth={auth()} settings={()=>{}} friends={()=>{}}/>);
 for(const text of['ExampleGamer','Gamerscore','A real biography','Example location','ULTIMATE'])expect(html).toContain(text);
 for(const absent of['Online','Following','Followers','AccountTier','999'])expect(html).not.toContain(absent);
 expect(html).toContain('<strong>0</strong>');
});
it('discards private stale profile data after sign-out and handles absent score distinctly',()=>{
 const data={...auth(),stored:false};
 const html=renderToStaticMarkup(<ProfilePage auth={data} settings={()=>{}} friends={()=>{}}/>);
 expect(html).toContain('Sign in to view your profile');
 for(const absent of['ExampleGamer','example@example.test','ULTIMATE','A real biography'])expect(html).not.toContain(absent);
 expect(renderToStaticMarkup(<ProfilePage auth={{...auth(),profile:undefined}} settings={()=>{}} friends={()=>{}}/>)).toContain('Gamerscore is unavailable');
});
it('labels cached data and generic refresh error without rendering arbitrary provider error strings',()=>{
 const html=renderToStaticMarkup(<ProfilePage auth={{...auth(),profileSource:'cache',profileError:'sensitive raw backend payload'}} settings={()=>{}} friends={()=>{}}/>);
 expect(html).toContain('Showing saved profile information');expect(html).toContain('could not be refreshed');expect(html).not.toContain('sensitive raw');
});
it('uses only the genuine local badge assets, with accessible text and no invented subscription',()=>{
 const cases=[['CFQ7TTC0KHS0','GamePassUltimateFullHeight'],['CFQ7TTC0P85B','BadgePremium'],['CFQ7TTC0K5DJ','BadgeEssential'],['CFQ7TTC0KGQ8','BadgePCGames']];
 for(const[id,icon]of cases)expect(renderToStaticMarkup(<SubscriptionBadge value={active([id])}/>)).toContain(`/icons/${icon}.svg`);
 expect(renderToStaticMarkup(<SubscriptionBadge value={{status:'unknown',productIds:[],checkedAt:new Date().toISOString()}}/>)).toBe('');
 expect(renderToStaticMarkup(<SubscriptionBadge value={active(['CFQ7TTC0K6L8'])}/>)).toContain('GAME PASS CONSOLE');
});
it('adds Cloud between library and Store and enables View profile in the account menu',()=>{
 const data=demoSnapshot();data.auth=auth();
 const html=renderToStaticMarkup(<Sidebar data={data} page="cloud" go={()=>{}}/>);
 expect(html.indexOf('My Library')).toBeLessThan(html.indexOf('Cloud gaming'));expect(html.indexOf('Cloud gaming')).toBeLessThan(html.indexOf('>Store<'));
 expect(html).toContain('ExampleGamer · ULTIMATE');
 const menu=renderToStaticMarkup(<ShellFlyout panel="account" data={data} close={()=>{}} go={()=>{}}/>);
 expect(menu).toContain('View profile');expect(menu).not.toContain('requires a verified XUID');
});
it('renders Greek profile controls and never reads services while rendering',()=>{
 vi.stubGlobal('localStorage',{getItem:()=> 'el'});const refresh=vi.fn();
 const html=renderToStaticMarkup(<ProfilePage auth={auth()} refresh={refresh} settings={()=>{}} friends={()=>{}}/>);
 expect(html).toContain('Ανανέωση προφίλ');expect(html).toContain('Βαθμολογία παίκτη');expect(refresh).not.toHaveBeenCalled();
});
