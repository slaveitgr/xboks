import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HandheldCompatibilityDialog, HandheldCompatibilityEntry } from './HandheldCompatibility';
import type { HandheldCompatibility } from '../shared/handheld-compatibility';

const value = (rating: HandheldCompatibility['rating']): HandheldCompatibility => ({ rating, source: 'microsoft-catalog', platform: 'windows-pc', rawRating: ({ unknown: 0, optimized: 1, unsupported: 2, playable: 3 })[rating] });
it('leaves an absent classification unknown and never presents passed criteria or a Linux verification', () => {
  const html = renderToStaticMarkup(<HandheldCompatibilityDialog title="Example game" close={() => {}} />);
  expect(html).toContain('compatibility has not been provided');
  expect(html.match(/data-criterion-state="not-provided"/g)).toHaveLength(5);
  expect(html).not.toContain('data-criterion-state="optimized"');
  expect(html).toContain('Linux / Proton compatibility has not been verified.');
  expect(html).toContain('role="dialog"');
});
it('does not infer individual successes from an overall optimized rating', () => {
  const html = renderToStaticMarkup(<HandheldCompatibilityDialog title="Example game" value={value('optimized')} close={() => {}} />);
  expect(html.match(/data-criterion-state="not-provided"/g)).toHaveLength(5);
  expect(html).not.toContain('data-criterion-state="optimized"');
  expect(html).toContain('Windows handhelds');
  expect(html).not.toMatch(/FPS|frames per second|Linux verified|Steam Deck Verified/);
});
it('renders explicit individual results independently of the overall rating', () => {
  const classification = { ...value('playable'), criteria: [{ id: 'iconography' as const, rating: 'optimized' as const }, { id: 'text-input' as const, rating: 'unsupported' as const }] };
  const html = renderToStaticMarkup(<HandheldCompatibilityDialog title="Example game" value={classification} close={() => {}} />);
  expect(html.match(/data-criterion-state="optimized"/g)).toHaveLength(1);
  expect(html.match(/data-criterion-state="unsupported"/g)).toHaveLength(1);
  expect(html.match(/data-criterion-state="not-provided"/g)).toHaveLength(3);
});
it.each(['playable', 'unsupported'] as const)('does not invent individual test successes for %s', rating => {
  const html = renderToStaticMarkup(<HandheldCompatibilityDialog title="Example game" value={value(rating)} close={() => {}} />);
  expect(html).not.toContain('data-criterion-state="optimized"');
  expect(html.match(/data-criterion-state="not-provided"/g)).toHaveLength(5);
});
it('keeps the information entry available when no rating is returned', () => {
  const html = renderToStaticMarkup(<HandheldCompatibilityEntry open={() => {}} />);
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('data-handheld-rating="unknown"');
  expect(html).not.toContain('disabled');
});
