import test from "node:test";
import assert from "node:assert/strict";
import {
  initialWorkspace,
  navigate,
  returnOne,
  returnToLevel,
  setWindow,
  setViewport,
  toQuery,
  readQuery,
  restoreBrowseHistory,
} from "./state.ts";

test("world → region → process → event → world restores the chosen world window and viewport", () => {
  let state = setWindow(initialWorkspace(), 710, 880);
  state = setViewport(state, { x: 40, y: 12, width: 900, height: 468 });
  const world = structuredClone(state.view);
  state = navigate(state, {
    level: "region",
    scopeId: "europe",
    viewport: { x: 420, y: 90, width: 240, height: 170 },
  });
  state = setWindow(state, 750, 870);
  const region = structuredClone(state.view);
  state = navigate(state, {
    level: "process",
    processId: "carolingian-succession",
  });
  state = navigate(state, { level: "event", eventId: "verdun-843" });
  state = returnOne(state);
  assert.equal(state.view.level, "process");
  state = returnOne(state);
  assert.deepEqual(state.view, region);
  state = returnToLevel(state, "world");
  assert.deepEqual(state.view, world);
});

test("changing scope, time or returning cannot alter HEAD, fixed comparisons or UI locale", () => {
  let state = {
    ...initialWorkspace(),
    head: "record:800",
    comparison: ["record:814", "record:843"] as [string, string],
    locale: "zh-CN" as const,
  };
  state = navigate(state, { level: "region", scopeId: "east-asia" });
  state = setWindow(state, 700, 810);
  state = returnOne(state);
  assert.equal(state.head, "record:800");
  assert.deepEqual(state.comparison, ["record:814", "record:843"]);
  assert.equal(state.locale, "zh-CN");
  assert.equal(state.view.cursor, null);
});

test("deep-link round trip retains interval independently from an explicit timepoint", () => {
  let state = navigate(initialWorkspace(), {
    level: "event",
    scopeId: "europe",
    processId: "carolingian-succession",
    eventId: "verdun-843",
    timeWindow: [700, 890],
    cursor: 843,
    viewport: { x: 400, y: 100, width: 300, height: 156 },
  });
  state.locale = "zh-CN";
  const restored = readQuery(toQuery(state));
  assert.deepEqual(restored.timeWindow, [700, 890]);
  assert.equal(restored.cursor, 843);
  assert.equal(restored.eventId, "verdun-843");
  assert.deepEqual(restored.viewport, state.view.viewport);
  assert.equal(restored.locale, "zh-CN");
});

test("malformed links cannot produce invalid temporal or geographic bounds", () => {
  const restored = readQuery("?view=invalid&from=NaN&to=-5&map=0,0,-2,0");
  assert.equal(restored.level, "world");
  assert.deepEqual(restored.timeWindow, [600, 900]);
  assert.equal(restored.viewport, undefined);
});


test("version deep links preserve exact HEAD, comparison and sparse requested dates", () => {
  const state = initialWorkspace();
  state.head = "francia-west-843";
  state.headRequestedYear = 850;
  state.comparison = ["francia-west-870", "francia-east-870"];
  state.comparisonRequestedYears = [870, 870];
  state.view.panel = "history";
  state.view.graphBranch = "francia/west";
  state.view.graphRef = "francia/west@843";
  state.view.selectedCommit = "francia-west-843";
  state.view.requestedYear = 850;
  const restored = readQuery(toQuery(state));
  assert.equal(restored.head, state.head);
  assert.equal(restored.headRequestedYear, 850);
  assert.deepEqual(restored.comparison, state.comparison);
  assert.deepEqual(restored.comparisonRequestedYears, [870, 870]);
  assert.equal(restored.graphRef, "francia/west@843");
  assert.equal(restored.selectedCommit, state.view.selectedCommit);
});

test("returning to world exits a comparison opened directly from world", () => {
  let state = initialWorkspace();
  state = navigate(state, { panel: "compare" });
  state.comparison = ["west-843", "east-843"];
  const world = returnToLevel(state, "world");
  assert.equal(world.view.panel, "browse");
  assert.deepEqual(world.comparison, state.comparison);
});

test("browser Back restores browsing context without undoing current HEAD or fixed comparison", () => {
  const old = initialWorkspace();
  let current = navigate(old, { level: "region", scopeId: "east-asia" });
  current = { ...current, locale: "zh-CN", head: "west-843", headRequestedYear: 850, comparison: ["west-870", "east-870"], comparisonRequestedYears: [870, 870] };
  const restored = restoreBrowseHistory(current, old);
  assert.equal(restored.view.level, "world");
  assert.equal(restored.locale, "zh-CN");
  assert.equal(restored.head, "west-843");
  assert.equal(restored.headRequestedYear, 850);
  assert.deepEqual(restored.comparison, current.comparison);
  assert.deepEqual(restored.comparisonRequestedYears, [870, 870]);
});
