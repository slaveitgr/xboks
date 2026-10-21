import {describe, expect, it} from 'vitest';
import {claimStreamInput, releaseStreamInput} from './stream-input';

describe('stream input ownership', () => {
  it('does not let an inactive or stale host clear a newer session', () => {
    const document = {documentElement: {dataset: {}}} as unknown as Document;
    const cloud = Symbol('cloud'), console = Symbol('console');
    claimStreamInput(document, cloud, 'active');
    claimStreamInput(document, console, 'menu');
    releaseStreamInput(document, cloud);
    expect(document.documentElement.dataset.cloudStreamInput).toBe('menu');
    claimStreamInput(document, console, 'active');
    releaseStreamInput(document, cloud);
    expect(document.documentElement.dataset.cloudStreamInput).toBe('active');
    releaseStreamInput(document, console);
    expect(document.documentElement.dataset.cloudStreamInput).toBeUndefined();
  });
  it('keeps ownership independent between documents', () => {
    const a = {documentElement: {dataset: {}}} as unknown as Document;
    const b = {documentElement: {dataset: {}}} as unknown as Document;
    const owner = Symbol('stream');
    claimStreamInput(a, owner, 'menu'); claimStreamInput(b, owner, 'active');
    releaseStreamInput(a, owner);
    expect(b.documentElement.dataset.cloudStreamInput).toBe('active');
  });
});
