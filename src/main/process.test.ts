import { describe, expect, it } from 'vitest';
import { spawnTracked } from './process.js';
import { DownloadProgress, PROGRESS_PREFIX } from './download-progress.js';

describe('tracked terminal output', () => {
  it('keeps interleaved diagnostics out of structured stdout without losing line observations', async () => {
    const lines: string[] = [];
    const script = "process.stdout.write('{\\\"value\\\":\\\"');setTimeout(()=>{process.stderr.write('diagnostic\\n'+'x'.repeat(5000)+'\\n');setTimeout(()=>process.stdout.write('ok\\\"}\\n'),20)},20)";
    const result = await spawnTracked(process.execPath, ['-e', script], { stdoutOnly: true, maxOutput: 100, onLine: line => lines.push(line) }).result;
    expect(result.code).toBe(0); expect(JSON.parse(result.output)).toEqual({ value: 'ok' });
    expect(lines).toContain('diagnostic'); expect(lines).toContain('{"value":"ok"}');
  });
  it('assembles split UTF-8 and ANSI independently on stdout and stderr', async () => {
    const lines: string[] = [];
    const script = "process.stdout.write(Buffer.from([0xe2])); process.stderr.write('stderr\\n');setTimeout(()=>process.stdout.write(Buffer.from([0x82,0xac,27,91])),10);setTimeout(()=>process.stdout.write('32m Downloading 1 MiB/2 MiB 50%\\r'),20)";
    const result = await spawnTracked(process.execPath, ['-e', script], { onLine: line => lines.push(line) }).result;
    expect(result.code).toBe(0); expect(lines).toContain('stderr'); expect(lines).toContain('€ Downloading 1 MiB/2 MiB 50%');
  });
  it('emits carriage-return updates without a terminal utility', async () => {
    const lines: string[] = [];
    const tracked = spawnTracked('printf', ['Downloading 1 MiB/10 MiB 10%%\rDownloading 5 MiB/10 MiB 50%%\n'], {
      onLine: (line) => lines.push(line),
    });
    const result = await tracked.result;
    expect(result.code).toBe(0);
    expect(lines.some((line) => line.includes('1 MiB/10 MiB'))).toBe(true);
    expect(lines.some((line) => line.includes('5 MiB/10 MiB'))).toBe(true);
  });

  it('preserves paths with apostrophes without interpreting them as shell code', async () => {
    const tracked = spawnTracked('printf', ['%s\n', "a'b; echo UNSAFE"]);
    const result = await tracked.result;
    expect(result.code).toBe(0);
    expect(result.output).toContain("a'b; echo UNSAFE");
  });
});

describe('structured download transport', () => {
  it('handles split JSON records and stdin controls with empty PATH, no shell or PTY', async () => {
    const tracker = new DownloadProgress();
    const updates: unknown[] = [];
    const source = `
      const emit=(paused,sequence)=>{
        const s=${JSON.stringify(PROGRESS_PREFIX)}+JSON.stringify({schema:1,event:'progress',phase:'downloading',sequence,completedBytes:25,totalBytes:100,bytesPerSecond:0,canPause:true,paused})+'\\n';
        process.stdout.write(s.slice(0,15)); setTimeout(()=>process.stdout.write(s.slice(15)),5);
      };
      let text=''; process.stdin.on('data', bytes=>{text+=bytes; let i;
        while((i=text.indexOf('\\n'))>=0){const c=JSON.parse(text.slice(0,i));text=text.slice(i+1);
          emit(c.command==='pause',c.command==='pause'?1:2); if(c.command==='resume')setTimeout(()=>process.exit(0),30);
        }
      }); emit(false,0);
    `;
    const tracked = spawnTracked(process.execPath, ['-e', source], {
      env: { ...process.env, PATH: '' },
      onLine: line => {
        const patch = tracker.update(line); if (!patch) return;
        updates.push(patch.status);
        if (updates.length === 1) tracked.child.stdin.write('{"schema":1,"command":"pause"}\n');
        if (patch.status === 'paused') tracked.child.stdin.write('{"schema":1,"command":"resume"}\n');
      },
    });
    expect((await tracked.result).code).toBe(0);
    expect(updates).toEqual(['running', 'paused', 'running']);
  });
});
