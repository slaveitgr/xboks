import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { XboxFriendsList, XboxSocialPanel, validXboxMessage, xboxConversationMatches, xboxFriendGroups, xboxMessageLength, xboxMessageText, xboxPartyVoiceReason, xboxSocialAccountKey } from './XboxSocialPanel';
import { noXboxSocialCapabilities, type XboxFriend, type XboxSocialResult } from '../shared/xbox-social';
import { demoSnapshot } from '../shared/demo-data';
import { ShellFlyout } from './XboxShell';

const t = (en: string, _el?: string) => en;
const people: XboxFriend[] = [
  { xuid: '1', gamertag: 'Observed online', presence: 'online', activity: 'Reported activity' },
  { xuid: '2', gamertag: 'Observed away', presence: 'away' },
  { xuid: '3', gamertag: 'Observed offline', presence: 'offline' },
  { xuid: '4', gamertag: 'Presence unknown', presence: 'unknown' },
];
function fixture(): XboxSocialResult { return { status: 'ready', checkedAt: '2026-10-21T10:00:00Z', selfXuid: '99', capabilities: { friends:true,presence:true,inbox:true,conversation:true,send:true,search:true,partyVoice:false }, friends: people }; }
afterEach(() => vi.unstubAllGlobals());

describe('Xbox social privacy and observed data', () => {
  it('keeps server online/away/offline/unknown groups separate', () => {
    const groups = xboxFriendGroups(people, true);
    for (const status of ['online','away','offline','unknown'] as const) expect(groups[status]).toHaveLength(1);
  });
  it('does not infer presence when the server capability is unavailable', () => {
    const groups = xboxFriendGroups(people, false);
    expect(groups.online).toEqual([]); expect(groups.offline).toEqual([]); expect(groups.unknown).toEqual(people);
  });
  it('keys a private UI session to stored/running/account identity changes', () => {
    const auth = demoSnapshot().auth, initial = xboxSocialAccountKey(auth);
    for (const patch of [{stored:false},{running:!auth.running},{username:'other-account'}]) expect(xboxSocialAccountKey({...auth,...patch})).not.toBe(initial);
    expect(xboxSocialAccountKey({...auth,note:'new status text'})).toBe(initial);
    expect(xboxSocialAccountKey({...auth,gamertag:'Refreshed profile name'})).toBe(initial);
  });
  it('never reveals text from a deleted message', () => {
    expect(xboxMessageText({id:'deleted',senderXuid:'1',deleted:true,text:'PRIVATE DELETED CONTENT'},t)).toBe('Deleted message');
  });
  it('does not invent message content for a filtered/unsupported body', () => {
    expect(xboxMessageText({id:'filtered',senderXuid:'1',deleted:false},t)).toContain('unavailable or filtered');
    expect(xboxMessageText({id:'actual',senderXuid:'1',deleted:false,text:'Actual response'},t)).toBe('Actual response');
  });
  it('binds a conversation to its exact peer and self identities', () => {
    const result = {...fixture(),peerXuid:'1',messages:[{id:'1',senderXuid:'1',deleted:false,text:'Received'},{id:'2',senderXuid:'99',deleted:false,text:'Sent'}]};
    expect(xboxConversationMatches(result,'1')).toBe(true); expect(xboxConversationMatches(result,'2')).toBe(false);
    expect(xboxConversationMatches({...result,selfXuid:undefined},'1')).toBe(false);
    expect(xboxConversationMatches({...result,messages:[{id:'bad',senderXuid:'3',deleted:false}]},'1')).toBe(false);
  });
  it('does not treat an unsupported or failed response as an empty verified conversation', () => {
    const result = {...fixture(),peerXuid:'1',messages:[]};
    expect(xboxConversationMatches(result,'1')).toBe(true);
    expect(xboxConversationMatches({...result,status:'error'},'1')).toBe(false);
    expect(xboxConversationMatches({...result,status:'unsupported'},'1')).toBe(false);
  });
});

describe('Xbox explicit message composition limits', () => {
  it.each(['',' ','\n\t'])('rejects an empty message: %j', text => expect(validXboxMessage(text)).toBe(false));
  it('counts Unicode code points, not UTF-16 units', () => {
    const text = '🎮'.repeat(256); expect(text.length).toBe(512); expect(xboxMessageLength(text)).toBe(256); expect(validXboxMessage(text)).toBe(true);
    expect(validXboxMessage(`${text}🎮`)).toBe(false);
  });
  it('permits an explicit 1–256 point text, including line breaks', () => {
    expect(validXboxMessage('a')).toBe(true); expect(validXboxMessage('a'.repeat(256))).toBe(true); expect(validXboxMessage('a'.repeat(257))).toBe(false);
    expect(validXboxMessage('First line\nSecond line')).toBe(true);
  });
});

describe('Xbox social rendered surfaces', () => {
  it('renders exact people IDs, service activity, and presence labels without invoking navigation', () => {
    const select = vi.fn(); const html = renderToStaticMarkup(<XboxFriendsList result={fixture()} select={select} t={t} />);
    expect(html).toContain('data-social-peer="1"'); expect(html).toContain('Reported activity'); expect(html).toContain('Presence unavailable (1)');
    expect(select).not.toHaveBeenCalled();
  });
  it('renders capability-free presence as unknown and disables unavailable conversations', () => {
    const result = fixture(); result.capabilities = {...result.capabilities,presence:false,conversation:false};
    const html = renderToStaticMarkup(<XboxFriendsList result={result} select={() => {}} t={t} />);
    expect(html).toContain('Presence unavailable (4)'); expect(html).not.toContain('Online ('); expect(html).not.toContain('Reported activity');
    expect(html.match(/class="xbox-social-person" disabled=""/g)).toHaveLength(4);
  });
  it('shows a signed-out surface without a stale profile or private data', () => {
    const auth = {...demoSnapshot().auth,stored:false,gamertag:'StalePrivateProfile'};
    const html = renderToStaticMarkup(<XboxSocialPanel auth={auth} variant="guide" accountSettings={() => {}} />);
    expect(html).toContain('Not signed in'); expect(html).toContain('Sign in to your Xbox account'); expect(html).not.toContain('StalePrivateProfile');
    expect(html).not.toContain('Observed online');
  });
  it('disables search before actual capability data and never calls a missing adapter during rendering', () => {
    const calls = vi.fn(); vi.stubGlobal('window',{launcher:{getXboxFriends:calls}});
    const html = renderToStaticMarkup(<XboxSocialPanel auth={demoSnapshot().auth} accountSettings={() => {}} />);
    expect(html).toMatch(/aria-label="Search people"[^>]*disabled=""/); expect(calls).not.toHaveBeenCalled(); expect(html).toContain('Loading Xbox social');
  });
  it('leaves party voice explicitly disabled with its actual missing dependency', () => {
    const html = renderToStaticMarkup(<XboxSocialPanel auth={demoSnapshot().auth} accountSettings={() => {}} />);
    expect(html).toContain(xboxPartyVoiceReason); expect(html).toMatch(/<button type="button" disabled="" title="Xbox party voice is not available in this version\."/);
  });
  it('uses the same component inside the application friends flyout', () => {
    const html = renderToStaticMarkup(<ShellFlyout panel="friends" data={demoSnapshot()} close={() => {}} go={() => {}} />);
    expect(html).toContain('xbox-social-shell'); expect(html).not.toContain('Your Xbox friends list is not connected yet');
  });
  it('localizes social tabs, search, status, and the party limitation in Greek', () => {
    vi.stubGlobal('localStorage',{getItem:()=> 'el'});
    const html = renderToStaticMarkup(<XboxSocialPanel auth={{...demoSnapshot().auth,stored:false}} accountSettings={() => {}} />);
    for (const label of ['Φίλοι','Συνομιλίες','Αναζήτηση ατόμων','Ρυθμίσεις λογαριασμού','Η φωνητική ομάδα Xbox δεν είναι διαθέσιμη']) expect(html).toContain(label);
  });
  it('keeps unsupported capability defaults false', () => {
    expect(Object.values(noXboxSocialCapabilities).every(value=>value===false)).toBe(true);
  });
});
