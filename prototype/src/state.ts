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
    trail: [...state.trail, clone(state.view)],
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
  const from = Math.max(600, Math.min(890, Math.round(start)));
  const to = Math.max(from + 10, Math.min(900, Math.round(end)));
  return { ...state, view: { ...state.view, timeWindow: [from, to] } };
}
export function setViewport(state: Workspace, viewport: Viewport): Workspace {
  return { ...state, view: { ...state.view, viewport: { ...viewport } } };
}
export function toQuery(state: Workspace): string {
  const v = state.view;
  const p = new URLSearchParams({
    panel: v.panel ?? "browse",
    view: v.level,
    lang: state.locale,
    from: String(v.timeWindow[0]),
    to: String(v.timeWindow[1]),
  });
  if (state.head) p.set("head", state.head);
  if (state.headRequestedYear != null) p.set("headAt", String(state.headRequestedYear));
  if (state.comparisonRequestedYears?.[0] != null) p.set("aAt", String(state.comparisonRequestedYears[0]));
  if (state.comparisonRequestedYears?.[1] != null) p.set("bAt", String(state.comparisonRequestedYears[1]));
  if (v.requestedYear != null) p.set("requested", String(v.requestedYear));
  if (state.comparison) { p.set("a", state.comparison[0]); p.set("b", state.comparison[1]); }
  if (v.selectedCommit) p.set("selected", v.selectedCommit);
  if (v.graphBranch) p.set("branch", v.graphBranch);
  if (v.graphRef) p.set("log", v.graphRef);
  if (v.scopeId) p.set("scope", v.scopeId);
  if (v.processId) p.set("process", v.processId);
  if (v.eventId) p.set("event", v.eventId);
  if (v.cursor !== null) p.set("at", String(v.cursor));
  p.set(
    "map",
    [v.viewport.x, v.viewport.y, v.viewport.width, v.viewport.height]
      .map((n) => Number(n.toFixed(2)))
      .join(","),
  );
  return `?${p.toString()}`;
}

export function readQuery(
  search: string,
): Partial<ViewState> & { locale: Locale; head: string | null; headRequestedYear: number | null; comparisonRequestedYears: [number | null, number | null] | null; comparison: [string, string] | null } {
  const p = new URLSearchParams(search);
  const level = (
    ["world", "region", "process", "event"].includes(p.get("view") || "")
      ? p.get("view")
      : "world"
  ) as Level;
  const from = Number(p.get("from") ?? 600),
    to = Number(p.get("to") ?? 900);
  const validWindow =
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    from >= 600 &&
    to <= 900 &&
    from < to;
  const map = p.get("map")?.split(",").map(Number);
  const validMap =
    map?.length === 4 &&
    map.every(Number.isFinite) &&
    map[2] >= 80 &&
    map[3] >= 40 &&
    map[2] <= 1800;
  const at = p.get("at");
  return {
    panel: ["history", "snapshot", "compare"].includes(p.get("panel") ?? "") ? p.get("panel") as WorkbenchPanel : "browse",
    selectedCommit: p.get("selected"),
    graphBranch: p.get("branch"),
    graphRef: p.get("log"),
    head: p.get("head"),
    requestedYear: p.has("requested") && Number.isFinite(Number(p.get("requested"))) ? Number(p.get("requested")) : null,
    headRequestedYear: p.has("headAt") && Number.isFinite(Number(p.get("headAt"))) ? Number(p.get("headAt")) : null,
    comparisonRequestedYears: [p.has("aAt") && Number.isFinite(Number(p.get("aAt"))) ? Number(p.get("aAt")) : null, p.has("bAt") && Number.isFinite(Number(p.get("bAt"))) ? Number(p.get("bAt")) : null],
    comparison: p.get("a") && p.get("b") ? [p.get("a")!, p.get("b")!] : null,
    level,
    scopeId: p.get("scope"),
    processId: p.get("process"),
    eventId: p.get("event"),
    timeWindow: validWindow ? [from, to] : [600, 900],
    cursor: at !== null && Number.isFinite(Number(at)) ? Number(at) : null,
    ...(validMap
      ? {
          viewport: { x: map![0], y: map![1], width: map![2], height: map![3] },
        }
      : {}),
    locale: p.get("lang") === "zh-CN" ? "zh-CN" : "en",
  };
}
