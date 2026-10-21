export interface DesktopForegroundApp { desktopId: string; name: string; title: string }
export const shellSwitcherActions = ['toggle', 'open', 'next', 'previous', 'accept', 'cancel', 'desktop', 'xbox', 'up', 'down', 'left', 'right', 'close-window'] as const;
export type ShellSwitcherAction = typeof shellSwitcherActions[number];
export const guideInputActions = ['up', 'down', 'left', 'right', 'accept', 'back', 'previous', 'next'] as const;
export type GuideInputAction = typeof guideInputActions[number];
export function desktopForegroundApp(value: unknown): DesktopForegroundApp | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !['desktopId', 'name', 'title'].includes(key))) return;
  if (typeof item.desktopId !== 'string' || typeof item.name !== 'string' || typeof item.title !== 'string') return;
  if (item.desktopId.length > 256 || item.name.length > 256 || item.title.length > 512 || !item.name.trim() ||
    /[\x00-\x1f\x7f]/.test(item.desktopId + item.name + item.title)) return;
  return { desktopId: item.desktopId, name: item.name, title: item.title };
}
