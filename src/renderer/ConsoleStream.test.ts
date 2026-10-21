import {describe, expect, it} from 'vitest';
import {observeConsoleSession} from './ConsoleStream';
import type {ConsoleStreamState} from '../shared/console-stream';

describe('console session observation', () => {
  it('keeps a newer push when an old initial snapshot arrives late', async () => {
    let deliver!: (value: ConsoleStreamState) => void, complete!: (value: ConsoleStreamState) => void;
    const values: ConsoleStreamState[] = [];
    let removed = false;
    const dispose = observeConsoleSession({onConsoleStreamState: callback => {deliver = callback; return () => {removed = true;};}, getConsoleStreamState: () => new Promise(resolve => {complete = resolve;})}, state => values.push(state));
    deliver({phase: 'provisioning', id: 'new'}); complete({phase: 'closed'}); await Promise.resolve();
    expect(values).toEqual([{phase: 'provisioning', id: 'new'}]);
    dispose(); deliver({phase: 'error'});
    expect(removed).toBe(true); expect(values).toHaveLength(1);
  });
  it('ignores a snapshot after the host is removed', async () => {
    let complete!: (value: ConsoleStreamState) => void;
    const values: ConsoleStreamState[] = [];
    const dispose = observeConsoleSession({getConsoleStreamState: () => new Promise(resolve => {complete = resolve;})}, value => values.push(value));
    dispose(); complete({phase: 'ready', id: 'old'}); await Promise.resolve();
    expect(values).toEqual([]);
  });
});
