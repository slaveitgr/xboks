import { expect, it } from 'vitest';
import { installationReadiness } from './installation-state';
import { demoSnapshot } from './demo-data';
import type { DownloadTask } from './types';
const game=demoSnapshot().games[0];
const task:DownloadTask={id:'job',kind:'install',title:game.title,productId:game.storeId ?? 'product',destination:game.path,status:'running',progress:100,phase:'Finalizing',log:[],startedAt:'2026-10-20'};
it('never equates 100 percent download progress with launch readiness', () => {
 expect(installationReadiness(task,[{...game,installState:'ready'}]).ready).toBe(false);
 expect(installationReadiness({...task,status:'complete'},[]).ready).toBe(false);
 expect(installationReadiness({...task,status:'complete',gameId:game.id},[{...game,installState:'incomplete'}]).ready).toBe(false);
});
it('requires completion and a matching verified installation; DLC cannot grant base-game readiness', () => {
 const done={...task,status:'complete' as const,gameId:game.id};
 expect(installationReadiness(done,[{...game,installState:'ready'}]).ready).toBe(true);
 expect(installationReadiness({...done,kind:'content'},[{...game,installState:'ready'}]).ready).toBe(false);
 expect(installationReadiness({...done,gameId:'other'},[{...game,installState:'ready'}]).ready).toBe(false);
});
