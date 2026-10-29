import type { GraphEdge } from "./api";

/** Longest prerequisite chain below each course (0 = no prerequisites), cycle-safe. */
export function prerequisiteDepth(edges: GraphEdge[]) {
  const into = new Map<string, string[]>();
  for (const e of edges)
    if (e.type !== "similar") into.set(e.target, [...(into.get(e.target) ?? []), e.source]);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const of = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // a prerequisite loop in the catalog: stop here
    visiting.add(id);
    let d = 0;
    for (const p of into.get(id) ?? []) d = Math.max(d, of(p) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  return of;
}
