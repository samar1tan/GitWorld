export type Locale = "en" | "zh-CN";
export type Level = "world" | "region" | "process" | "event";
export type Viewport = { x: number; y: number; width: number; height: number };
export type WorkbenchPanel = "browse" | "history" | "snapshot" | "compare";
export type ViewState = {
  panel: WorkbenchPanel;
  selectedCommit: string | null;
  graphBranch: string | null;
  graphRef: string | null;
  requestedYear: number | null;
  level: Level;
  scopeId: string | null;
  processId: string | null;
  eventId: string | null;
  timeWindow: [number, number];
  cursor: number | null;
  viewport: Viewport;
};
export type Workspace = {
  view: ViewState;
  trail: ViewState[];
  locale: Locale;
  head: string | null;
  headRequestedYear: number | null;
  headRevision?: string | null;
  comparisonRevisions?: [string,string] | null;
  comparisonRequestedYears: [number | null, number | null] | null;
  comparison: [string, string] | null;
};
export const WORLD_VIEW: Viewport = { x: 0, y: 0, width: 1000, height: 520 };
export const initialView = (): ViewState => ({
  panel: "browse",
  selectedCommit: null,
  graphBranch: null,
  graphRef: null,
  requestedYear: null,
  level: "world",
  scopeId: null,
  processId: null,
  eventId: null,
  timeWindow: [600, 900],
  cursor: null,
  viewport: { ...WORLD_VIEW },
});
export const initialWorkspace = (): Workspace => ({
  view: initialView(),
  trail: [],
  locale: "en",
  head: null,
  headRequestedYear: null,
  comparisonRequestedYears: null,
  comparison: null,
});
const clone = <T>(value: T): T => structuredClone(value);

export function navigate(
  state: Workspace,
  patch: Partial<ViewState>,
): Workspace {
  return {
    ...state,
    trail: [...state.trail, clone(state.view)].slice(-60),
    view: { ...clone(state.view), ...clone(patch) },
  };
}
export function returnOne(state: Workspace): Workspace {
  if (!state.trail.length) return state;
  return {
    ...state,
    view: clone(state.trail.at(-1)!),
    trail: state.trail.slice(0, -1),
  };
}
export function returnToLevel(state: Workspace, level: Level): Workspace {
  if (state.view.level === level) {
    if (level === "world" || level === "region") return { ...state, view: { ...state.view, panel: "browse", selectedCommit: null, graphBranch: null, graphRef: null, requestedYear: null } };
    return state;
  }
  const index = state.trail.findLastIndex((item) => item.level === level);
  if (index >= 0)
    return {
      ...state,
      view: { ...clone(state.trail[index]), ...((level === "world" || level === "region") ? {panel: "browse" as const, selectedCommit: null, graphBranch: null, graphRef: null, requestedYear: null} : {}) },
      trail: state.trail.slice(0, index),
    };
  if (level === "world")
    return {
      ...state,
      view: { ...initialView(), timeWindow: [...state.view.timeWindow] },
      trail: [],
    };
  return state;
}
export function restoreBrowseHistory(current: Workspace, restored: Workspace): Workspace {
  return { ...initialWorkspace(), ...restored, view: { ...initialView(), ...restored.view }, locale: current.locale, head: current.head, headRequestedYear: current.headRequestedYear, comparison: current.comparison, comparisonRequestedYears: current.comparisonRequestedYears };
}
export function setWindow(
  state: Workspace,
  start: number,
  end: number,
): Workspace {
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start===0||end===0||start>end)return state;
  const from = Math.max(-1_000_000,start);
  const to = Math.min(1_000_000,end);
  return { ...state, view: { ...state.view, timeWindow: [from, to] } };
}
export function setViewport(state: Workspace, viewport: Viewport): Workspace {
  return { ...state, view: { ...state.view, viewport: { ...viewport } } };
}
