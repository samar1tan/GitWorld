import type { HistoryBranch, HistoryCommit } from '@gitworld/domain';

type LayoutCommit = Pick<HistoryCommit, 'id' | 'branchId' | 'year' | 'parents'>;
type LayoutBranch = Pick<HistoryBranch, 'id'>;
export type GraphPoint = { x: number; y: number };
export type GraphLayout = {
  positions: ReadonlyMap<string, GraphPoint>;
  lanes: ReadonlyMap<string, number>;
  yearLabels: { year: number; x: number }[];
  width: number;
  height: number;
};

const COLUMN_GAP = 136;
const LANE_GAP = 120;
const LEFT = 232;
const TOP = 76;
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Preserve the caller's lane order; node placement is independent of commit order. */
export function layoutHistoryGraph(commits: readonly LayoutCommit[], branches: readonly LayoutBranch[]): GraphLayout {
  const lanes = new Map(branches.map((branch, index) => [branch.id, TOP + index * LANE_GAP]));
  const byId = new Map(commits.map(commit => [commit.id, commit]));
  if (lanes.size !== branches.length || byId.size !== commits.length || commits.some(commit => !lanes.has(commit.branchId))) throw new Error('INVALID_GRAPH_LAYOUT');
  const years = [...new Set(commits.map(commit => commit.year))].sort((a, b) => a - b);
  const positions = new Map<string, GraphPoint>();
  const yearLabels: GraphLayout['yearLabels'] = [];
  let column = 0;

  for (const year of years) {
    const group = commits.filter(commit => commit.year === year);
    const pending = new Map(group.map(commit => [commit.id, new Set(commit.parents.filter(id => byId.get(id)?.year === year))]));
    const children = new Map<string, string[]>();
    for (const [id, parents] of pending) for (const parent of parents) children.set(parent, [...(children.get(parent) ?? []), id]);
    const ready = group.filter(commit => pending.get(commit.id)!.size === 0).map(commit => commit.id).sort(compareIds);
    const slots = new Map<string, number>();
    const occupied = new Map<string, Set<number>>();
    let count = 0;
    let columns = 0;

    while (ready.length) {
      const id = ready.shift()!;
      const commit = byId.get(id)!;
      const laneSlots = occupied.get(commit.branchId) ?? new Set<number>();
      let slot = Math.max(0, ...commit.parents.filter(parent => slots.has(parent)).map(parent => slots.get(parent)! + 1));
      while (laneSlots.has(slot)) slot++;
      slots.set(id, slot); laneSlots.add(slot); occupied.set(commit.branchId, laneSlots);
      positions.set(id, { x: LEFT + (column + slot) * COLUMN_GAP, y: lanes.get(commit.branchId)! });
      columns = Math.max(columns, slot + 1); count++;
      for (const child of children.get(id) ?? []) {
        const parents = pending.get(child)!; parents.delete(id);
        if (!parents.size) ready.push(child);
      }
      ready.sort(compareIds);
    }
    if (count !== group.length) throw new Error('INVALID_GRAPH_LAYOUT');
    yearLabels.push({ year, x: LEFT + (column + (columns - 1) / 2) * COLUMN_GAP });
    column += columns;
  }
  return {
    positions, lanes, yearLabels,
    width: Math.max(760, LEFT + Math.max(0, column - 1) * COLUMN_GAP + 124),
    height: Math.max(300, branches.length * LANE_GAP + 100),
  };
}
