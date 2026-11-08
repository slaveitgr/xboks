import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { HomePage, LibraryPage } from './App';
import { collectionKey } from './LibraryChrome';

describe('EAC presentation', () => {
  it('does not turn EAC detection or a legacy route into an offline-only claim', () => {
    const data = demoSnapshot();
    // Exercise existing profiles too, not just the refreshed demo fixture.
    Object.assign(data.games[0], { launchSupport: 'offline-only-eac',
      launchBlockReason: 'Easy Anti-Cheat detected. Only offline play is supported.' });
    const key=collectionKey(data.auth);
    vi.stubGlobal('localStorage',{getItem:(requested:string)=>requested===key?JSON.stringify({later:[],history:{[data.games[0].id]:Date.UTC(2026,10,8)}}):null});
    onTestFinished(()=>{vi.unstubAllGlobals();});
    const home = renderToStaticMarkup(<HomePage data={data} go={() => {}} action={() => {}} />);
    const library = renderToStaticMarkup(<LibraryPage data={data} selection={{ id: data.games[0].id }} toast={() => {}} />);
    for (const html of [home, library]) {
      expect(html).toContain('Gears of War: E-Day');
      expect(html).not.toMatch(/offline only|only offline|attestation/i);
      expect(html).not.toContain('Easy Anti-Cheat detected.');
    }
    expect(home).toContain('new-home-mru');
    expect(library).toContain('Ready');
  });

  it('keeps incomplete-installation warnings visible', () => {
    const data = demoSnapshot();
    data.games[0].installState = 'incomplete';
    data.games[0].installMessage = 'The download was not completed.';
    const html = renderToStaticMarkup(<LibraryPage data={data} selection={{ id: data.games[0].id }} toast={() => {}} />);
    expect(html).toContain('Incomplete');
    expect(html).toContain('The download was not completed.');
  });
});
