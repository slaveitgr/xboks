import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { shortcutArguments } from './game-shortcuts.js';

const source = readFileSync('src/main/index.ts', 'utf8');
const document = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const identity = document.statements.find(statement => ts.isExpressionStatement(statement)
  && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(document) === 'app.setName');
const selection = document.statements.find(statement => ts.isTryStatement(statement)
  && statement.tryBlock.getText(document).includes('startupRequest = shortcutArguments('));
if (!identity || !selection) throw Error('Launcher identity/profile initialization was not found.');
const initialization = ts.transpileModule(`${identity.getText(document)}
let startupRequest = {}, startupError, pathMigration;
${selection.getText(document)}
return { startupRequest, startupError, pathMigration };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

it.each([undefined, '--xboks-profile', '--nexus-profile'])('keeps the canonical profile when display metadata is uppercase: %s', async flag => {
  let name = 'XBOKS';
  let profile: string | undefined;
  const events: string[] = [];
  const custom = '/mnt/my custom profile';
  const canonical = '/home/test/.config/xboks';
  const migrateManagedPaths = vi.fn(async (options: { profile: string }) => ({ profile: options.profile, warnings: [] }));
  const context = createContext({
    app: {
      setName(value: string) { events.push(`name:${value}`); name = value; },
      getPath(key: string) { events.push(`get:${key}`); return path.join('/home/test/.config', name); },
      setPath(key: string, value: string) { events.push(`set:${key}`); profile = value; },
    },
    process: { argv: ['launcher', ...(flag ? [flag, custom] : [])] },
    path, shortcutArguments, demoMode: false,
    managedPaths: () => ({ profile: canonical }), migrateManagedPaths,
    console: { warn: vi.fn() },
  });
  const value = await runInContext(`(async () => { ${initialization} })()`, context);
  expect(value.startupError).toBeUndefined();
  expect(events[0]).toBe('name:xboks');
  expect(profile).toBe(flag ? custom : canonical);
  expect(migrateManagedPaths).toHaveBeenCalledWith({ profile: flag ? custom : canonical,
    explicitProfile: Boolean(flag), retainStartupLock: true });
  expect(value.startupRequest.profile).toBe(flag ? custom : undefined);
  expect(identity.getStart(document)).toBeLessThan(selection.getStart(document));
});
