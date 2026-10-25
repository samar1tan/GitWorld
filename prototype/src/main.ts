import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./style.css";
import "./workbench-style.css";
import { createWorkbench, historyEngine } from "./workbench-ui";
import {
  scopes,
  processes,
  events,
  sources,
  mapPlaces,
  datasetVersion,
  type LocalizedText,
  type HistoricalScope,
  type HistoricalProcess,
  type HistoricalEvent,
} from "./content";
import {
  messages,
  formatMessage,
  type MessageKey,
  type MessageParameters,
} from "./locales";
import {
  initialWorkspace,
  initialView,
  navigate,
  returnOne,
  returnToLevel,
  restoreBrowseHistory,
  setWindow,
  setViewport,
  toQuery,
  readQuery,
  WORLD_VIEW,
  type Workspace,
  type Level,
  type Viewport,
} from "./state";

const app = document.querySelector<HTMLDivElement>("#app")!;
let landMarkup = "";
let landStatus: "loading" | "ready" | "error" = "loading";
let modal: "coverage" | "sources" | null = null;
let state = initialWorkspace();
const text = (value: LocalizedText) => value[state.locale];
const t = (key: MessageKey) => messages[state.locale][key];
const fmt = <K extends keyof MessageParameters>(
  key: K,
  values: MessageParameters[K],
) => formatMessage(state.locale, key, values);
const esc = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const scopeById = (id: string | null) => scopes.find((item) => item.id === id);
const processById = (id: string | null) =>
  processes.find((item) => item.id === id);
const eventById = (id: string | null) => events.find((item) => item.id === id);
const currentScope = () => scopeById(state.view.scopeId);
const currentProcess = () => processById(state.view.processId);
const currentEvent = () => eventById(state.view.eventId);
const year = (value: number) => fmt("yearValue", { year: value });
const period = () =>
  fmt("periodValue", {
    from: state.view.timeWindow[0],
    to: state.view.timeWindow[1],
  });
const activeProcesses = (scope?: HistoricalScope) =>
  processes.filter(
    (item) =>
      (!scope || item.scopeId === scope.id) &&
      item.start <= state.view.timeWindow[1] &&
      item.end >= state.view.timeWindow[0],
  );
const processEvents = (process: HistoricalProcess) =>
  process.eventIds
    .map(eventById)
    .filter((item): item is HistoricalEvent => Boolean(item));
const inWindow = (value: number) =>
  value >= state.view.timeWindow[0] && value <= state.view.timeWindow[1];
const action = (name: string, label: string, options = "") =>
  `<button type="button" data-action="${name}" ${options}>${label}</button>`;
const icon = (name: string) => {
  const paths: Record<string, string> = {
    branch:
      '<path d="M7 5v9a4 4 0 0 0 4 4h3M7 10h5a5 5 0 0 0 5-5"/><circle cx="7" cy="4" r="2"/><circle cx="17" cy="4" r="2"/><circle cx="16" cy="18" r="2"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 17l9 5 9-5"/>',
    link: '<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 5H4v15h15v-6"/>',
    focus:
      '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
};

function fromUrl(): Workspace {
  const query = readQuery(location.search);
  let result = initialWorkspace();
  result.locale = query.locale;
  result.view.timeWindow = query.timeWindow!;
  result.view.cursor = query.cursor ?? null;
  const scope = scopeById(query.scopeId ?? null);
  const process = processById(query.processId ?? null);
  const event = eventById(query.eventId ?? null);
  if (query.level !== "world" && scope) {
    result = navigate(result, {
      level: "region",
      scopeId: scope.id,
      viewport: { ...scope.viewBox },
    });
    if (
      (query.level === "process" || query.level === "event") &&
      process?.scopeId === scope.id
    ) {
      result = navigate(result, { level: "process", processId: process.id });
      if (query.level === "event" && event?.processId === process.id)
        result = navigate(result, { level: "event", eventId: event.id });
    }
  }
  if (query.viewport) result.view.viewport = query.viewport;
  result.head = query.head && historyEngine.commits.has(query.head) ? query.head : null;
  result.headRequestedYear = query.headRequestedYear;
  result.comparison = query.comparison?.every(id => historyEngine.commits.has(id)) ? query.comparison : null;
  result.comparisonRequestedYears = query.comparisonRequestedYears;
  result.view.panel = query.panel ?? 'browse';
  result.view.selectedCommit = query.selectedCommit && historyEngine.commits.has(query.selectedCommit) ? query.selectedCommit : null;
  result.view.graphBranch = query.graphBranch && historyEngine.branches.has(query.graphBranch) ? query.graphBranch : null;
  result.view.requestedYear = query.requestedYear ?? null;
  result.view.graphRef = query.graphRef && historyEngine.log(query.graphRef, {head:result.head}).ok ? query.graphRef : null;
  if (result.view.panel === 'snapshot' && !result.head) result.view.panel = 'history';
  return result;
}
// A reload keeps the original ancestor viewports stored in browser history.
const savedWorkspace = history.state?.view
  ? (history.state as Workspace)
  : null;
state =
  savedWorkspace && toQuery(savedWorkspace) === location.search
    ? savedWorkspace
    : fromUrl();
state = { ...initialWorkspace(), ...state, view: { ...initialView(), ...state.view } };
const workbench = createWorkbench({ getState: () => state, update, render });
history.replaceState(state, "", toQuery(state));

function update(
  next: Workspace,
  mode: "push" | "replace" = "push",
  focusMain = false,
) {
  state = next;
  modal = null;
  history[mode === "push" ? "pushState" : "replaceState"](
    state,
    "",
    toQuery(state),
  );
  render();
  if (focusMain) {
    document
      .querySelector<HTMLElement>(".view-title")
      ?.focus({ preventScroll: true });
    if (matchMedia("(max-width: 860px)").matches) window.scrollTo({ top: 0 });
  }
}
function enterScope(id: string) {
  const scope = scopeById(id);
  if (!scope) return;
  update(
    navigate(state, {
      level: "region",
      panel: "browse", selectedCommit: null, graphBranch: null, graphRef: null, requestedYear: null,
      scopeId: id,
      processId: null,
      eventId: null,
      viewport: { ...scope.viewBox },
    }),
    "push",
    true,
  );
}
function enterProcess(id: string) {
  const process = processById(id),
    scope = scopeById(process?.scopeId ?? null);
  if (!process || !scope) return;
  let next = state;
  if (state.view.scopeId !== scope.id || state.view.level === "world")
    next = navigate(next, {
      level: "region",
      scopeId: scope.id,
      processId: null,
      eventId: null,
      viewport: { ...scope.viewBox },
    });
  update(
    navigate(next, { level: "process", processId: id, eventId: null, panel: workbench.hasProcess(id) ? "history" : "browse", selectedCommit: null, graphBranch: null, graphRef: null, requestedYear: null }),
    "push",
    true,
  );
}
function enterEvent(id: string) {
  const event = eventById(id);
  if (!event) return;
  update(navigate(state, { level: "event", eventId: id }), "push", true);
  const title = document.querySelector<HTMLElement>(".event-inspector h2");
  title?.setAttribute("tabindex", "-1");
  title?.focus({ preventScroll: true });
  if (matchMedia("(max-width: 860px)").matches)
    document
      .querySelector(".event-inspector")
      ?.scrollIntoView({ block: "start" });
}
function sourceList(ids: string[]) {
  return [...new Set(ids)]
    .map((id) => sources[id])
    .filter(Boolean)
    .map(
      (source) =>
        `<a class="source-link" href="${esc(source.url)}" target="_blank" rel="noreferrer" data-figma-name="Source / ${esc(source.id)}"><span><strong>${esc(source.title)}</strong><small>${esc(source.publisher)}</small></span>${icon("external")}</a>`,
    )
    .join("");
}
function breadcrumb() {
  const s = currentScope(),
    p = currentProcess(),
    e = currentEvent();
  return `<nav class="breadcrumbs" aria-label="${t("navigation")}" data-figma-name="Scope path">
    ${action("back", icon("back"), `class="icon-button back-button" aria-label="${t("back")}" ${state.trail.length ? "" : "disabled"}`)}
    ${action("world", `${icon("globe")}<span>${t("world")}</span>`, `class="crumb ${state.view.level === "world" ? "current" : ""}"`)}
    ${s ? `${icon("arrow")}${action("parent-region", esc(text(s.name)), `class="crumb ${state.view.level === "region" ? "current" : ""}" data-scope-id="${s.id}"`)}` : ""}
    ${p ? `${icon("arrow")}${action("parent-process", esc(text(p.name)), `class="crumb ${state.view.level === "process" ? "current" : ""}"`)}` : ""}
    ${e ? `${icon("arrow")}<span class="crumb current event-crumb">${esc(e.year)}</span>` : ""}
  </nav>`;
}
function sidebar() {
  const s = currentScope();
  return `<aside class="sidebar" data-figma-name="Scope explorer">
    <div class="sidebar-label">${t("regions")}</div>
    ${action("world", `${icon("globe")}<span>${t("world")}</span>`, `class="scope-nav ${!s ? "active" : ""}"`)}
    <div class="scope-list">${scopes.map((item) => action("scope", `<span class="scope-dot scope-${item.id}"></span><span>${esc(text(item.name))}</span>${icon("arrow")}`, `class="scope-nav ${s?.id === item.id ? "active" : ""}" data-id="${item.id}" data-scope-id="${item.id}" data-figma-name="Scope / ${item.id}"`)).join("")}</div>
    ${
      s
        ? `<div class="sidebar-label process-nav-heading">${t("continuous")}</div><div class="process-nav-list">${s.processIds
            .map(processById)
            .filter((item): item is HistoricalProcess => Boolean(item))
            .map((item) =>
              action(
                "process",
                `<span class="branch-symbol">⌁</span><span>${esc(text(item.name))}<small>${item.start}–${item.end}</small></span>`,
                `class="process-nav ${state.view.processId === item.id ? "active" : ""}" data-id="${item.id}" data-figma-name="Process / ${item.id}"`,
              ),
            )
            .join("")}</div>`
        : ""
    }
    ${workbench.sidebar()}
    <div class="sidebar-bottom"><span class="sidebar-label">${t("selectedCoverage")}</span><span class="coverage-count">${scopes.length} <span>${fmt("coverageCount", { count: processes.length })}</span></span>${action("coverage", `${icon("layers")} ${t("coverage")}`, 'class="text-button"')}</div>
  </aside>`;
}
function map() {
  const s = currentScope(),
    isWorld = state.view.level === "world";
  const v = state.view.viewport;
  const focusNames: Record<string, MessageKey> = {
    europe: "europeFocus",
    "west-asia": "westAsiaFocus",
    "east-asia": "eastAsiaFocus",
  };
  const markers = scopes
    .filter((item) => isWorld || (item.id === s?.id && !mapPlaces.length))
    .map((item) => {
      const selected = item.id === s?.id;
      return `<button type="button" class="map-marker marker-${item.id} ${selected ? "selected" : ""}" data-action="scope" data-id="${item.id}" data-scope-id="${item.id}" data-map-x="${item.location.x}" data-map-y="${item.location.y}" data-figma-name="Map marker / ${item.id}"><span class="map-point"><span></span></span><span class="marker-label"><strong>${esc(text(item.name))}</strong><small>${t(focusNames[item.id])} ${selected ? "" : "↗"}</small></span></button>`;
    })
    .join("");
  return `<section class="map-shell ${isWorld ? "world-map" : "focused-map"}" data-figma-name="Geographic canvas"><div class="map-surface" data-figma-name="Map viewport">
    <svg class="land-map" viewBox="${v.x} ${v.y} ${v.width} ${v.height}" role="img" aria-label="${t("labelMap")}" data-figma-name="Natural geography"><defs><radialGradient id="mapLight"><stop offset="0" stop-color="#263445"/><stop offset="1" stop-color="#19212a"/></radialGradient></defs><rect x="-1000" y="-600" width="3000" height="2000" fill="url(#mapLight)"/>${landMarkup}<g class="geographic-grid" opacity=".15"><path d="M0 260H1000M500 0V520" fill="none" stroke="#8292a3" stroke-width=".5"/></g></svg>
    ${markers}
    ${isWorld ? `<span class="ocean-label atlantic">${t("atlantic")}</span><span class="ocean-label pacific">${t("pacific")}</span>` : mapPlaceLabels(s!.id)}
    <div class="map-controls" data-figma-name="Map controls">${action("zoom-in", "+", `class="map-control" aria-label="${t("zoomIn")}"`)}${action("zoom-out", "−", `class="map-control" aria-label="${t("zoomOut")}"`)}${action("fit", icon("focus"), `class="map-control" aria-label="${t("fit")}"`)}</div>
    <div class="map-caption"><span class="caption-dot"></span>${t("mapMeaning")}</div>${landStatus === "ready" ? "" : `<div class="map-load-state" role="status">${landStatus === "loading" ? t("mapLoading") : `${t("mapError")}${action("retry-map", t("retry"), 'class="text-button"')}`}</div>`}
  </div></section>`;
}
function mapPlaceLabels(scopeId: string) {
  const groups: (typeof mapPlaces)[] = [];
  for (const place of mapPlaces.filter((item) =>
    item.scopeIds.includes(scopeId),
  )) {
    const group = groups.find(
      (items) =>
        Math.hypot(
          items[0].location.x - place.location.x,
          items[0].location.y - place.location.y,
        ) < 10,
    );
    if (group) group.push(place);
    else groups.push([place]);
  }
  return groups
    .map(
      (items) =>
        `<div class="map-place" data-map-x="${items.reduce((sum, item) => sum + item.location.x, 0) / items.length}" data-map-y="${items.reduce((sum, item) => sum + item.location.y, 0) / items.length}" data-figma-name="Place / ${items.map((item) => item.id).join(" + ")}"><span class="place-dot"></span><span>${items.map((item) => esc(text(item.name))).join(" / ")}</span></div>`,
    )
    .join("");
}
function ticks() {
  const [start, end] = state.view.timeWindow,
    interval = end - start <= 100 ? 25 : 50;
  const values = [start];
  for (let y = Math.ceil(start / interval) * interval; y < end; y += interval)
    if (y > start) values.push(y);
  values.push(end);
  return values
    .map(
      (value, index) =>
        `<span style="left:${((value - start) / (end - start)) * 100}%" class="axis-tick ${index === 0 ? "first" : index === values.length - 1 ? "last" : ""}">${value}</span>`,
    )
    .join("");
}
function timeline() {
  const scope = currentScope();
  const rows =
    state.view.level === "world"
      ? scopes
          .map((item) => activeProcesses(item)[0])
          .filter((item): item is HistoricalProcess => Boolean(item))
      : activeProcesses(scope);
  const [start, end] = state.view.timeWindow;
  const pct = (value: number) =>
    Math.max(0, Math.min(100, ((value - start) / (end - start)) * 100));
  return `<section class="overview-timeline" data-figma-name="Parallel processes"><div class="section-heading"><h2>${t("processes")}</h2><span>${t("timelineHint")}</span></div>
    <div class="timeline-axis"><span class="axis-label">${t("period")}</span><div class="axis-track">${ticks()}</div></div>
    <div class="timeline-rows">${
      rows.length
        ? rows
            .map((process) => {
              const region = scopeById(process.scopeId)!;
              return `<button type="button" class="timeline-row scope-${region.id}" data-action="process" data-id="${process.id}" data-figma-name="Timeline / ${process.id}"><span class="timeline-label"><strong>${esc(text(process.name))}</strong><small>${state.view.level === "world" ? esc(text(region.name)) : `${process.start}–${process.end}`}</small></span><span class="timeline-track"><span class="duration-line" style="left:${pct(process.start)}%;width:${Math.max(1, pct(process.end) - pct(process.start))}%"></span>${processEvents(
                process,
              )
                .filter((item) => inWindow(item.year))
                .map(
                  (item) =>
                    `<span class="time-node" style="left:${pct(item.year)}%" aria-hidden="true"></span>`,
                )
                .join(
                  "",
                )}<span class="track-arrow" aria-hidden="true">→</span></span></button>`;
            })
            .join("")
        : `<div class="empty-state">${t("noProcesses")} ${action("reset-time", t("widen"), 'class="text-button"')}</div>`
    }</div>
  </section>`;
}
function controls() {
  const [start, end] = state.view.timeWindow;
  return `<div class="time-controls" data-figma-name="Time window"><div class="time-label">${icon("clock")}<span>${t("period")}<strong data-period-output>${period()}</strong></span></div><div class="range-fields"><label><span>${t("from")} <output id="from-value">${start}</output></span><input aria-label="${t("from")}" id="time-from" type="range" min="600" max="890" step="1" value="${start}" /></label><label><span>${t("to")} <output id="to-value">${end}</output></span><input aria-label="${t("to")}" id="time-to" type="range" min="610" max="900" step="1" value="${end}" /></label></div>${action("reset-time", t("resetPeriod"), 'class="range-reset"')}<span class="range-note">${t("periodOnly")}</span></div>`;
}
function processCanvas(process: HistoricalProcess) {
  const all = processEvents(process),
    visible = all.filter((item) => inWindow(item.year));
  const selected = currentEvent();
  return `<section class="process-canvas" data-figma-name="Process / ${process.id}">
    <div class="process-kicker">${icon("branch")}<span>${t("recordSequence")}</span><span class="process-count">${fmt("recordCount", { visible: visible.length, total: all.length })}</span></div>
    <div class="process-summary">${esc(text(process.summary))}</div>
    <div class="sequence" aria-label="${t("recordSequence")}">${visible.length ? visible.map((item, index) => `<button type="button" class="sequence-item ${selected?.id === item.id ? "selected" : ""}" data-action="event" data-id="${item.id}" data-figma-name="Event / ${item.id}"><span class="sequence-year">${item.year}</span><span class="sequence-rail"><span class="sequence-dot"></span>${index < visible.length - 1 ? '<span class="sequence-connector"></span>' : ""}</span><strong>${esc(text(item.title))}</strong><span class="sequence-caption">${fmt("sourceCount", { count: item.sourceIds.length })}<span>↗</span></span></button>`).join("") : `<div class="empty-state">${t("noEvents")}${action("reset-time", t("widen"), 'class="text-button"')}</div>`}</div>
    ${selected && !inWindow(selected.year) ? `<div class="window-warning">${t("outsideWindow")}${action("include-date", t("includeDate"), 'class="text-button"')}</div>` : ""}
    <div class="process-context"><span class="context-divider"></span><span>${t("related")}</span>${scopes
      .filter((item) => item.id !== process.scopeId)
      .map((item) =>
        action(
          "scope",
          `${esc(text(item.name))} ${icon("arrow")}`,
          `class="context-link" data-id="${item.id}"`,
        ),
      )
      .join("")}</div>
  </section>`;
}
function inspector() {
  const scope = currentScope(),
    process = currentProcess(),
    event = currentEvent();
  if (!scope) return "";
  return `<aside class="inspector ${event ? "event-inspector" : ""}" data-figma-name="${event ? "Event details" : process ? "Process details" : "Region details"}">
    <div class="inspector-heading"><span>${event ? t("eventView") : process ? t("context") : t("regionView")}</span><span class="inspector-mark">${event ? icon("branch") : icon("layers")}</span></div>
    <div class="inspector-body">${
      event
        ? eventDetails(event, process!)
        : process
          ? `<h2>${esc(text(scope.name))}</h2><p>${esc(text(scope.summary))}</p><div class="inspector-section"><h3>${t("regionalSubjects")}</h3><ul class="subject-list">${scope.subjects.map((item) => `<li>${esc(text(item))}</li>`).join("")}</ul></div><div class="inspector-section"><h3>${t("sources")}</h3>${sourceList(process.sourceIds)}</div>`
          : `<h2>${esc(text(scope.name))}</h2><p class="scope-summary">${esc(text(scope.summary))}</p><div class="inspector-section"><h3>${t("regionalSubjects")}</h3><ul class="subject-list">${scope.subjects.map((item) => `<li>${esc(text(item))}</li>`).join("")}</ul></div><div class="inspector-section"><h3>${t("continue")}</h3>${activeProcesses(
              scope,
            )
              .map((item) =>
                action(
                  "process",
                  `<span><strong>${esc(text(item.name))}</strong><small>${item.start}–${item.end}</small></span>${icon("arrow")}`,
                  `class="process-open" data-id="${item.id}"`,
                ),
              )
              .join(
                "",
              )}</div><div class="inspector-section"><h3>${t("sources")}</h3>${sourceList(scope.sourceIds)}</div>`
    }</div>
  </aside>`;
}
function eventDetails(event: HistoricalEvent, process: HistoricalProcess) {
  const all = processEvents(process),
    index = all.findIndex((item) => item.id === event.id);
  return `<div class="event-date">${year(event.year)}</div><h2>${esc(text(event.title))}</h2><p>${esc(text(event.summary))}</p>
    ${event.changes.length ? `<div class="inspector-section"><h3>${t("change")}</h3>${event.changes.map((change) => `<div class="change-field"><strong>${esc(text(change.label))}</strong><div class="change-value before"><span>${t("before")}</span>${esc(text(change.before))}</div><div class="change-value after"><span>${t("after")}</span>${esc(text(change.after))}</div></div>`).join("")}</div>` : ""}
    ${event.note ? `<p class="content-note">${esc(text(event.note))}</p>` : ""}
    <div class="inspector-section"><h3>${t("sources")}</h3>${sourceList(event.sourceIds)}</div>
    <div class="event-pagination">${index > 0 ? action("event", `${icon("back")}${t("previousChange")}`, `class="text-button" data-id="${all[index - 1].id}"`) : ""}${index < all.length - 1 ? action("event", `${t("nextChange")}${icon("arrow")}`, `class="text-button" data-id="${all[index + 1].id}"`) : ""}</div>`;
}
function renderModal() {
  if (!modal) return "";
  const sourceIds = [
    ...new Set(
      scopes
        .flatMap((scope) => scope.sourceIds)
        .concat(processes.flatMap((process) => process.sourceIds)),
    ),
  ];
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="coverage-title" data-figma-name="Coverage details"><div class="modal-header"><h2 id="coverage-title">${t("coverageTitle")}</h2>${action("close-modal", icon("close"), `class="icon-button" aria-label="${t("close")}"`)}</div><p>${t("coverageBody")}</p><p>${t("sampleMeaning")}</p><div class="modal-source-list">${sourceList(sourceIds)}</div><p class="map-credit">${t("coverageFoot")}</p></section></div>`;
}
function render() {
  workbench.beforeRender();
  const scope = currentScope(), process = currentProcess();
  const active = workbench.active(), panel = state.view.panel;
  document.documentElement.lang = state.locale;
  document.title = `${process ? text(process.name) : scope ? text(scope.name) : t("world")} · GitWorld`;
  const heading = `<div class="view-heading"><div><div class="eyebrow">${state.view.level === "world" ? t("overviewLabel") : process ? t("processView") : t("regionView")}</div><h1 class="view-title" tabindex="-1">${process ? esc(text(process.name)) : scope ? esc(text(scope.name)) : period()}</h1></div><span class="view-period">${process ? `${process.start}–${process.end}` : scope ? period() : `${fmt("regionCount", { count: scopes.length })}`}</span></div>`;
  app.innerHTML = `<div class="workspace level-${state.view.level} panel-${panel}" data-figma-name="GitWorld / ${panel} / ${state.locale}">
    <header class="topbar" data-figma-name="Workbench header"><a class="brand" href="?view=world" data-action="world">${icon("branch")}<strong>GitWorld</strong></a><span class="topbar-divider"></span><span class="workspace-label">${t("workspace")}</span><div class="topbar-right"><span class="preview-badge">${t("sample")}</span><label class="language-control"><span class="sr-only">${t("language")}</span><select id="language" aria-label="${t("language")}"><option value="en" ${state.locale === "en" ? "selected" : ""}>English</option><option value="zh-CN" ${state.locale === "zh-CN" ? "selected" : ""}>简体中文</option></select></label></div></header>
    <div class="navigation-bar">${breadcrumb()}<div class="navigation-context"><span class="navigation-period">${period()}</span>${state.view.level !== "world" ? action("world", `${icon("globe")}${t("returnWorld")}`, 'class="world-return" data-figma-name="Return world"') : ""}</div></div>
    <div class="workspace-body">${sidebar()}<main class="main-stage" data-figma-name="Main view">${active ? `${workbench.tabs()}${panel === 'history' ? heading : ''}${workbench.content()}${panel === 'history' ? controls() : ''}` : `${heading}${process ? `<div class="process-map-context">${map()}<div class="compact-scope-label">${icon("focus")}<span>${esc(text(scope!.name))}</span>${action("parent-region", t("overview"), 'class="text-button"')}</div></div>${processCanvas(process)}` : `${map()}${timeline()}`}${controls()}`}</main>${active ? panel === 'history' ? workbench.inspector() : '' : inspector()}</div>
    ${workbench.terminal()}<footer class="statusbar">${workbench.status()}</footer>
    <div class="sr-only" aria-live="polite">${scope ? text(scope.name) : t("world")} · ${period()}${process ? ` · ${text(process.name)}` : ""}</div>
  </div>${renderModal()}`;
  requestAnimationFrame(() => { positionMarkers(); workbench.afterRender(); });
  const mapElement = document.querySelector<HTMLElement>(".map-surface");
  if (mapElement) { mapObserver.disconnect(); mapObserver.observe(mapElement); wireMapDrag(mapElement); }
  if (modal) document.querySelector<HTMLButtonElement>('[data-action="close-modal"]')?.focus();
}
const mapObserver = new ResizeObserver(positionMarkers);
function positionMarkers() {
  const surface = document.querySelector<HTMLElement>(".map-surface");
  if (!surface) return;
  const rect = surface.getBoundingClientRect(),
    v = state.view.viewport;
  const scale = Math.min(rect.width / v.width, rect.height / v.height);
  const offsetX = (rect.width - v.width * scale) / 2,
    offsetY = (rect.height - v.height * scale) / 2;
  surface.querySelectorAll<HTMLElement>("[data-map-x]").forEach((marker) => {
    marker.style.left = `${(Number(marker.dataset.mapX) - v.x) * scale + offsetX}px`;
    marker.style.top = `${(Number(marker.dataset.mapY) - v.y) * scale + offsetY}px`;
  });
}
function wireMapDrag(surface: HTMLElement) {
  let drag: {
    x: number;
    y: number;
    viewport: Viewport;
    scale: number;
    moved: boolean;
  } | null = null;
  surface.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest("button") || e.button !== 0) return;
    const rect = surface.getBoundingClientRect(),
      v = state.view.viewport;
    drag = {
      x: e.clientX,
      y: e.clientY,
      viewport: { ...v },
      scale: Math.min(rect.width / v.width, rect.height / v.height),
      moved: false,
    };
    surface.setPointerCapture(e.pointerId);
    surface.classList.add("dragging");
  });
  surface.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.scale,
      dy = (e.clientY - drag.y) / drag.scale;
    drag.moved = Math.abs(dx) + Math.abs(dy) > 2;
    state = setViewport(state, {
      ...drag.viewport,
      x: drag.viewport.x - dx,
      y: drag.viewport.y - dy,
    });
    surface
      .querySelector("svg.land-map")
      ?.setAttribute(
        "viewBox",
        `${state.view.viewport.x} ${state.view.viewport.y} ${state.view.viewport.width} ${state.view.viewport.height}`,
      );
    positionMarkers();
  });
  const release = () => {
    if (!drag) return;
    drag = null;
    surface.classList.remove("dragging");
    history.replaceState(state, "", toQuery(state));
  };
  surface.addEventListener("pointerup", release);
  surface.addEventListener("pointercancel", release);
}

app.addEventListener("click", (e) => {
  const wb = (e.target as Element).closest<HTMLElement>("[data-wb]");
  if (wb) { e.preventDefault(); workbench.click(wb); return; }
  const button = (e.target as Element).closest<HTMLElement>("[data-action]");
  if (!button) return;
  e.preventDefault();
  const id = button.dataset.id!,
    command = button.dataset.action;
  if (command === "scope") enterScope(id);
  else if (command === "process") enterProcess(id);
  else if (command === "event") enterEvent(id);
  else if (command === "back") update(returnOne(state), "push", true);
  else if (command === "world")
    update(returnToLevel(state, "world"), "push", true);
  else if (command === "parent-region") {
    const restored = returnToLevel(state, "region");
    if (restored.view.level === "region") update(restored, "push", true);
    else if (state.view.scopeId) enterScope(state.view.scopeId);
  }
  else if (command === "parent-process") {
    const restored = returnToLevel(state, "process");
    update({ ...restored, view: { ...restored.view, panel: restored.view.processId && workbench.hasProcess(restored.view.processId) ? "history" : "browse" } }, "push", true);
  }
  else if (command === "reset-time")
    update(setWindow(state, 600, 900), "replace");
  else if (command === "include-date") {
    const at = currentEvent()?.year;
    if (at)
      update(
        setWindow(
          state,
          Math.min(state.view.timeWindow[0], at),
          Math.max(state.view.timeWindow[1], at),
        ),
        "replace",
      );
  } else if (command === "retry-map") loadLand();
  else if (command === "coverage" || command === "sources") {
    modal = command;
    render();
  } else if (command === "close-modal") {
    modal = null;
    render();
    document
      .querySelector<HTMLButtonElement>('[data-action="coverage"]')
      ?.focus();
  } else if (command === "fit")
    update(
      setViewport(state, currentScope()?.viewBox ?? WORLD_VIEW),
      "replace",
    );
  else if (command === "zoom-in" || command === "zoom-out") {
    const v = state.view.viewport,
      scale = command === "zoom-in" ? 0.8 : 1.25;
    const width = Math.max(100, Math.min(1500, v.width * scale)),
      height = (width * v.height) / v.width;
    update(
      setViewport(state, {
        x: v.x + (v.width - width) / 2,
        y: v.y + (v.height - height) / 2,
        width,
        height,
      }),
      "replace",
    );
  }
});
app.addEventListener("submit", (e) => { if (workbench.submit(e.target as HTMLFormElement)) e.preventDefault(); });
app.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.id === "language") {
    update(
      { ...state, locale: target.value === "zh-CN" ? "zh-CN" : "en" },
      "replace",
    );
    return;
  }
  if (target.id === "time-from")
    update(
      setWindow(
        state,
        Math.min(Number(target.value), state.view.timeWindow[1] - 10),
        state.view.timeWindow[1],
      ),
      "replace",
    );
  if (target.id === "time-to")
    update(
      setWindow(
        state,
        state.view.timeWindow[0],
        Math.max(Number(target.value), state.view.timeWindow[0] + 10),
      ),
      "replace",
    );
});
app.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement;
  workbench.input(target);
  if (target.id === "time-from")
    document.querySelector("#from-value")!.textContent = target.value;
  if (target.id === "time-to")
    document.querySelector("#to-value")!.textContent = target.value;
});
window.addEventListener("popstate", (e) => {
  const restored = e.state?.view ? (e.state as Workspace) : fromUrl();
  state = restoreBrowseHistory(state, restored);
  history.replaceState(state, "", toQuery(state));
  modal = null;
  render();
});
document.addEventListener("keydown", (e) => {
  if (workbench.key(e)) return;
  if (e.key === "Escape" && modal) {
    modal = null;
    render();
    return;
  }
  if (modal && e.key === "Tab") {
    const nodes = [
      ...document.querySelectorAll<HTMLElement>(".modal button, .modal a"),
    ];
    if (e.shiftKey && document.activeElement === nodes[0]) {
      e.preventDefault();
      nodes.at(-1)?.focus();
    }
    if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
      e.preventDefault();
      nodes[0]?.focus();
    }
  }
});

function loadLand() {
  landStatus = "loading";
  render();
  fetch("/world-land.svg")
    .then((response) => {
      if (!response.ok) throw new Error("Basemap unavailable");
      return response.text();
    })
    .then((svg) => {
      const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
      landStatus = "ready";
      landMarkup = [...xml.documentElement.children]
        .filter((node) => !["title", "desc"].includes(node.tagName))
        .map((node) => node.outerHTML)
        .join("");
      render();
    })
    .catch(() => {
      landStatus = "error";
      landMarkup = "";
      render();
    });
}
loadLand();

// Expose serializable review state, not application internals or hidden data.
Object.defineProperty(window, "gitworldReviewState", {
  get: () => ({ ...state, datasetVersion: workbench.data.id }),
});
