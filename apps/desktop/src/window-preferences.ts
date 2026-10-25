export const VIEW_SHORTCUTS = Object.freeze({ zoomIn: 'CommandOrControl+=', zoomOut: 'CommandOrControl+-', resetZoom: 'CommandOrControl+0' });
export type WorkArea = { x: number; y: number; width: number; height: number };
export type WindowPreferences = WorkArea & { zoomFactor: number };
export function fitWindow(input: unknown, area: WorkArea): WindowPreferences {
  const value = input && typeof input === 'object' ? input as Partial<WindowPreferences> : {};
  const valid = (number: unknown): number is number => typeof number === 'number' && Number.isFinite(number);
  const width = Math.min(area.width, Math.max(Math.min(1060, area.width), valid(value.width) ? value.width : Math.min(1600, area.width - 64)));
  const height = Math.min(area.height, Math.max(Math.min(700, area.height), valid(value.height) ? value.height : Math.min(960, area.height - 64)));
  const x = Math.max(area.x, Math.min(area.x + area.width - width, valid(value.x) ? value.x : area.x + (area.width - width) / 2));
  const y = Math.max(area.y, Math.min(area.y + area.height - height, valid(value.y) ? value.y : area.y + (area.height - height) / 2));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), zoomFactor: valid(value.zoomFactor) ? Math.max(0.75, Math.min(2, value.zoomFactor)) : 1 };
}
