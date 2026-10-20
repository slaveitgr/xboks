import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GuideAudio } from '../shared/types.js';
const run = promisify(execFile);
export function parseGuideVolume(output: string): GuideAudio {
  const match = /^Volume:\s+([0-9]+(?:\.[0-9]+)?)(?:\s+\[MUTED\])?\s*$/.exec(output.trim());
  if (!match) return { available: false, reason: 'The audio service returned an unsupported response.' };
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return { available: false, reason: 'Audio volume is unavailable.' };
  return { available: true, volume: Math.min(100, Math.round(value * 100)), muted: output.includes('[MUTED]') };
}
export async function guideAudio(patch?: { volume?: number; muted?: boolean }): Promise<GuideAudio> {
  if (patch?.volume !== undefined && (!Number.isFinite(patch.volume) || patch.volume < 0 || patch.volume > 100)) throw new Error('Volume must be between 0 and 100.');
  if (patch?.muted !== undefined && typeof patch.muted !== 'boolean') throw new Error('Invalid mute setting.');
  try {
    if (patch?.volume !== undefined) await run('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', `${Math.round(patch.volume)}%`], { timeout: 3000 });
    if (patch?.muted !== undefined) await run('wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', patch.muted ? '1' : '0'], { timeout: 3000 });
    const { stdout } = await run('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@'], { timeout: 3000 });
    return parseGuideVolume(stdout);
  } catch {
    return { available: false, reason: 'System audio needs PipeWire/WirePlumber and the wpctl utility.' };
  }
}
