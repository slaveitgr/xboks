import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { formatMinutes, galleryIndex, GameDetailsContent, Gallery } from './GameDetails';
import type { GameActivity, GameStoreDetails } from '../shared/types';
const game=demoSnapshot().games[0];
const details: GameStoreDetails={productId:game.storeId!,title:game.title,description:'<script>literal text</script>',publisher:'Example publisher',categories:['Strategy','Card & board'],screenshots:['https://store-images.s-microsoft.com/example'],releaseDate:'invalid'};
const render=(activity: GameActivity, data: GameStoreDetails|undefined=details)=>renderToStaticMarkup(<GameDetailsContent game={game} details={data} activity={activity} play={<button>Play</button>} manage={<button>Manage content</button>} back={()=>{}} refresh={()=>{}} />);
it.each([[undefined,'Unavailable'],[NaN,'Unavailable'],[-1,'Unavailable'],[0,'0 min'],[0.5,'&lt;1 min'],[12,'12 min'],[60,'1 h'],[2052,'34 h 12 min']] as const)('formats remote minutes %s as %s', (minutes,expected)=>{
  expect(renderToStaticMarkup(<span>{formatMinutes(minutes)}</span>)).toContain(expected);
});
it('renders real metadata as escaped text and gallery thumbnails, never executable HTML',()=>{
  const html=render({status:'available',minutesPlayed:2052,lastPlayed:'2026-01-01T12:00:00Z'});
  expect(html).toContain('34 h 12 min'); expect(html).toContain('From Xbox'); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;literal text&lt;/script&gt;');
  expect(html).toContain('Card &amp; board'); expect(html).toContain('Open screenshot 1'); expect(html).not.toContain('Invalid Date'); expect(html).toContain('data-gamepad-detail-back');
  expect(html).toContain('data-gamepad-action-row'); expect(html).not.toMatch(/data-game-menu(?:=|\s)/);
  expect(html).toContain('data-game-menu-trigger'); expect(html).toContain('aria-haspopup="menu"');
});
it.each(['unavailable','unsupported','signed-out','error'] as const)('never displays a fabricated zero for %s',status=>{
  const html=render({status},undefined); expect(html).toContain('Unavailable'); expect(html).not.toContain('>0 min<'); expect(html).not.toContain('Sample data');
});
it('does not present missing screenshots or failed metadata as an installation blocker',()=>{
  const html=render({status:'unavailable'},{...details,screenshots:[],description:''});
  expect(html).toContain('No screenshots available'); expect(html).toContain('>Play</button>'); expect(html).not.toContain('Open screenshot');
});
it('uses the shared secondary close button and advertises scoped gallery controller shortcuts',()=>{
  const html=renderToStaticMarkup(<Gallery title="Example" images={details.screenshots} initial={0} close={()=>{}} />);
  expect(html).toContain('class="secondary gd-gallery-close"');
  expect(html).toContain('data-gamepad-cancel'); expect(html).toContain('data-gamepad-gallery=""');
  expect(html).toContain('data-gamepad-gallery-previous'); expect(html).toContain('data-gamepad-gallery-next');
  for (const key of ['B','L1','R1']) expect(html).toContain(`aria-hidden="true">${key}</span>`);
  expect(html).toContain('aria-live="polite"'); expect(html).not.toContain('icon-button');
});
it('places installed actions in the left summary, real artwork/thumbnails on the right and tabbed information below',()=>{
  const html=render({status:'available',minutesPlayed:12},{...details,heroUrl:'https://store-images.s-microsoft.com/hero'});
  expect(html.indexOf('gd-hero-copy')).toBeLessThan(html.indexOf('gd-hero-media'));
  expect(html.indexOf('gd-play-controls')).toBeLessThan(html.indexOf('gd-hero-media'));
  expect(html.indexOf('gd-hero-thumbnails')).toBeLessThan(html.indexOf('gd-meta-bar'));
  expect(html.indexOf('gd-meta-bar')).toBeLessThan(html.indexOf('role="tablist"'));
  for(const tab of ['details','reviews','more']) {
    expect(html).toContain(`id="installed-${game.id}-tab-${tab}"`);
    expect(html).toContain(`aria-controls="installed-${game.id}-panel-${tab}"`);
    expect(html).toContain(`aria-labelledby="installed-${game.id}-tab-${tab}"`);
  }
  expect(html).toContain('Reviews are not returned by the connected catalog service.');
  expect(html).not.toContain('PEGI'); expect(html).not.toContain('Xbox Play Anywhere');
});
it('preserves the actual launch disabled state, notices, achievements and technical tools while metadata fails',()=>{
  const html=renderToStaticMarkup(<GameDetailsContent game={game} metadataError activity={{status:'error'}}
    play={<button disabled title="Runtime is unavailable">Play</button>} manage={<button disabled>Guarded operation</button>}
    technical={<p>Actual installation location</p>} achievements={<p>Actual achievement response</p>} notices={<p role="alert">Operation failed</p>}
    back={()=>{}} refresh={()=>{}} />);
  expect(html).toContain('<button disabled="" title="Runtime is unavailable">Play</button>');
  expect(html).toContain('Actual installation location'); expect(html).toContain('Actual achievement response');
  expect(html).toContain('<p role="alert">Operation failed</p>'); expect(html).toContain('<button disabled="">Guarded operation</button>');
  expect(html).not.toContain('>0 min<'); expect(html).toContain('Game information could not be loaded. You can still play.');
});
it.each([[-1,3,0],[20,3,2],[1.9,3,1],[NaN,3,0],[2,0,0],[1,1,0]] as const)('clamps screenshot index %s with %s images to %s', (index,length,expected)=>{
  expect(galleryIndex(index,length)).toBe(expected);
});
it('does not enable gallery navigation for an empty or single-image response',()=>{
  for(const images of [[],details.screenshots]) {
    const html=renderToStaticMarkup(<Gallery title="Example" images={images} initial={99} close={()=>{}} />);
    expect(html).toMatch(/aria-label="Previous screenshot" disabled=""/);
    expect(html).toMatch(/aria-label="Next screenshot" disabled=""/);
    expect(html).not.toContain('100 /');
  }
});
