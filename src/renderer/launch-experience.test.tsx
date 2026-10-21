import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LaunchExperience } from './LaunchExperience';
import type { GameOperation } from '../shared/types';
const operation:GameOperation={id:'launch',gameId:'game',title:'Example Game',kind:'launch',status:'preparing',phase:'Preparing xboks Engine…',log:[],startedAt:'2026-10-20'};
it('shows actual launch preparation without fabricating sync or a percentage',()=>{
 const html=renderToStaticMarkup(<LaunchExperience operation={operation} close={()=>{}} />);
 expect(html).toContain('aria-modal="true"');expect(html).toContain('Preparing your game');expect(html).toContain(operation.phase);
 expect(html).not.toContain('Syncing');expect(html).not.toContain('aria-valuenow');expect(html).toContain('Keep browsing');
});
it('preserves the real preparation error and offers diagnostic details',()=>{
 const html=renderToStaticMarkup(<LaunchExperience operation={{...operation,status:'failed',error:'Runtime is unavailable',phase:'Runtime is unavailable',logPath:'/private/log'}} close={()=>{}} />);
 expect(html).toContain('Unable to launch your game');expect(html).toContain('Runtime is unavailable');expect(html).toContain('Read diagnostic log');expect(html).not.toContain('/private/log');
});
