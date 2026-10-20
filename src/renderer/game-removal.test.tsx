import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { GameRemovalContents } from './GameRemovalContents';

it('clearly confirms permanent deletion, warns about in-folder saves and keeps Cancel/files choices', () => {
  const html = renderToStaticMarkup(<GameRemovalContents game={demoSnapshot().games[0]} busy={false} close={() => {}} remove={() => {}} />);
  expect(html).toContain('permanently delete this installation folder');
  expect(html).toContain('files and saves inside it cannot be restored from Trash');
  expect(html).toContain('Saves stored outside this folder are not affected');
  expect(html).toContain('data-gamepad-cancel="true"');
  expect(html).toContain('Keep files'); expect(html).toContain('Delete files permanently');
  expect(html).not.toContain('Move files to Trash');
  expect(html).not.toContain('autofocus');
});

it('disables every removal action while the operation is running', () => {
  const html = renderToStaticMarkup(<GameRemovalContents game={demoSnapshot().games[0]} busy close={() => {}} remove={() => {}} />);
  const buttons = html.match(/<button[^>]*>/g)!;
  expect(buttons).toHaveLength(3); expect(buttons.every(button => button.includes('disabled=""'))).toBe(true);
});
