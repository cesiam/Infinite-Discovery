import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { Loader2, Maximize2, Minimize2, Plus, Search, ShoppingCart, X } from "lucide-react";
import {
  apiUnreachable,
  getCommunity,
  getFullGraph,
  getGraphGroup,
  getProgramCourses,
  getSimilarityGraph,
  listPrograms,
  type CourseGraph,
  type GraphEdge,
  type ProgramSummary,
} from "@/lib/api";
import { prerequisiteDepth } from "@/lib/graph";
import { usePlan } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import { AddToCartButton, CartList } from "@/components/Cart";
import { AddToPlanButton } from "@/components/AddToPlanButton";

export const Route = createFileRoute("/graph")({
  head: () => ({
    meta: [
      { title: "Course graph — Infinite Discovery" },
      {
        name: "description",
        content:
          "Every MIT course and how they connect: prerequisites, similar content, departments and programs.",
      },
      { property: "og:title", content: "Course graph — Infinite Discovery" },
      {
        property: "og:description",
        content: "Prerequisite paths and content similarity across the whole MIT catalog.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GraphPage,
});

type Mode = "prereq" | "similar";
type Sort = "clusters" | "topological";
type Node = CourseGraph["nodes"][number] &
  d3.SimulationNodeDatum & { color: string; ax: number; ay: number; tag: number };
type Link = { source: Node; target: Node; type: GraphEdge["type"] };
interface Tag {
  key: string;
  kind: "class" | "topic" | "program";
  label: string;
  detail: string;
  courses: string[];
  matches?: string[]; // class tags: the other hybrid-search hits
}

const HEIGHT = 640;
const R = 3.2; // node radius in layout units
const LABEL_ZOOM = 2.2; // course numbers appear past this zoom
const TAG_COLORS = ["#90291e", "#1f6f8b", "#6a4c93", "#2a9d8f", "#d1495b", "#3d5a80", "#8a6d1f"];
// topological layout: one block of columns per prerequisite level
const CELL = 8;
const MAX_ROWS = 90;
const LEVEL_GAP = 60;

/**
 * Two graphs of the whole catalog (~6,000 courses) on a canvas:
 *   prereq   arrows from each prerequisite to the course that needs it
 *   similar  each course linked to its nearest neighbors by catalog-text embedding
 * and two ways to sort either one:
 *   clusters     one patch per department
 *   topological  left to right by prerequisite level (a topological order)
 * Search terms become tags; each tag's courses are circled in the tag's color, and
 * hovering a tag isolates its courses from the other tags.
 */
function GraphPage() {
  const { plan } = usePlan();
  const planIds = useMemo(() => new Set(Object.values(plan.slots).flat()), [plan.slots]);
  const [mode, setMode] = useState<Mode>("prereq");
  const [sort, setSort] = useState<Sort>("clusters");
  const [graphs, setGraphs] = useState<Partial<Record<Mode, CourseGraph>>>({});
  const [mine, setMine] = useState(false);
  const [discussed, setDiscussed] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ProgramSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [hoverTag, setHoverTag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; node: Node } | null>(null);
  const [card, setCard] = useState<{ x: number; y: number; node: Node } | null>(null);
  const [error, setError] = useState("");
  const [settling, setSettling] = useState(true);
  const [full, setFull] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<number | null>(null);
  // Click an edge type in the legend to see only those edges; click again for all.
  const [onlyEdge, setOnlyEdge] = useState<"hard" | "soft" | null>(null);
  const onlyEdgeRef = useRef<"hard" | "soft" | null>(null);
  const redrawRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    getCommunity()
      .then((c) => setDiscussed(c.courses.map((x) => x.id)))
      .catch(() => undefined);
  }, []);
  // The topological sort needs prerequisite edges even when drawing the similarity graph.
  useEffect(() => {
    const need: Mode[] = sort === "topological" ? [mode, "prereq"] : [mode];
    for (const m of need) {
      if (graphs[m]) continue;
      (m === "prereq" ? getFullGraph() : getSimilarityGraph(3))
        .then((g) => setGraphs((all) => ({ ...all, [m]: g })))
        .catch(() => setError(apiUnreachable()));
    }
  }, [mode, sort, graphs]);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  // Program suggestions appear as chips under the search box while typing (no dropdown).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setSuggestions([]);
    let live = true;
    const t = setTimeout(
      () =>
        listPrograms(undefined, q)
          .then((p) => live && setSuggestions(p.filter((x) => x.kind !== "gir").slice(0, 4)))
          .catch(() => undefined),
      200,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  useEffect(() => {
    hoverRef.current = hoverTag;
    redrawRef.current();
  }, [hoverTag]);
  useEffect(() => {
    onlyEdgeRef.current = onlyEdge;
    redrawRef.current();
  }, [onlyEdge]);

  const base = graphs[mode] ?? null;
  const prereqEdges = graphs.prereq?.edges ?? null;
  const tagged = useMemo(() => new Set(tags.flatMap((t) => t.courses)), [tags]);

  // The slice of the catalog on show.
  const shown = useMemo<CourseGraph | null>(() => {
    if (!base || (sort === "topological" && !prereqEdges)) return null;
    let keep: Set<string> | null = null;
    if (mine) {
      keep = new Set([...planIds, ...discussed]);
      if (mode === "prereq") for (const e of base.edges) if (keep.has(e.target)) keep.add(e.source);
      for (const id of tagged) keep.add(id);
    }
    const nodes = base.nodes.filter(
      (n) => (!keep || keep.has(n.id)) && (!hidden.has(n.department) || tagged.has(n.id)),
    );
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: base.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [base, sort, prereqEdges, mine, planIds, discussed, hidden, tagged, mode]);

  const departments = useMemo(() => {
    const count = d3.rollup(
      base?.nodes ?? [],
      (v) => v.length,
      (n) => n.department,
    );
    return [...count].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  }, [base]);
  const color = useMemo(() => {
    const order = [...departments].sort();
    return (d: string) =>
      d3.interpolateSinebow((order.indexOf(d) / Math.max(1, order.length)) * 0.92);
  }, [departments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || !shown || shown.nodes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    let width = box.clientWidth;
    let height = box.clientHeight;
    const sizeCanvas = () => {
      width = box.clientWidth;
      height = box.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    sizeCanvas();

    const similar = mode === "similar";
    const topo = sort === "topological";
    // Each course belongs to the first tag that names it.
    const tagOf = new Map<string, number>();
    tags.forEach((t, i) => t.courses.forEach((id) => tagOf.has(id) || tagOf.set(id, i)));
    const grouped = tags.length > 0;

    // Clusters: one patch per department, sized to its course count, packed without overlap.
    const sizes = d3.rollup(
      shown.nodes,
      (v) => v.length,
      (n) => n.department,
    );
    const patches = [...sizes.keys()]
      .sort((a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0))
      .map((d) => ({ d, r: Math.sqrt(sizes.get(d) ?? 1) * 5.2 + 6, x: 0, y: 0 }));
    d3.packSiblings(patches);
    const anchors = new Map(patches.map((p) => [p.d, [p.x, p.y] as [number, number]]));
    const cloud = d3.packEnclose(patches) ?? { x: 0, y: 0, r: 100 };

    // Topological: blocks of columns per prerequisite level, sorted by department inside.
    const levels: { depth: number; x: number; width: number; count: number }[] = [];
    const topoPos = new Map<string, [number, number]>();
    if (topo && prereqEdges) {
      const depthOf = prerequisiteDepth(prereqEdges);
      const byLevel = d3.group(shown.nodes, (n) => depthOf(n.id));
      let x = 0;
      for (const depth of [...byLevel.keys()].sort((a, b) => a - b)) {
        const list = (byLevel.get(depth) ?? []).sort(
          (a, b) =>
            a.department.localeCompare(b.department, undefined, { numeric: true }) ||
            a.id.localeCompare(b.id),
        );
        const rows = Math.min(MAX_ROWS, list.length);
        const cols = Math.ceil(list.length / rows);
        list.forEach((n, i) =>
          topoPos.set(n.id, [x + Math.floor(i / rows) * CELL, ((i % rows) - rows / 2) * CELL]),
        );
        levels.push({ depth, x, width: (cols - 1) * CELL, count: list.length });
        x += (cols - 1) * CELL + LEVEL_GAP;
      }
    }

    // In clusters, each tag's courses gather in open space around the catalog.
    const spots = tags.map((t, i) => {
      const r = Math.sqrt(t.courses.length) * 9 + 18;
      const angle =
        [0, Math.PI, -Math.PI / 2, Math.PI / 2, Math.PI / 4, (5 * Math.PI) / 4][i % 6] ?? 0;
      const dist = cloud.r + r + 40 + Math.floor(i / 6) * (r * 2 + 30);
      return { x: cloud.x + Math.cos(angle) * dist, y: cloud.y + Math.sin(angle) * dist };
    });

    const nodes: Node[] = shown.nodes.map((n) => {
      const [ax, ay] = anchors.get(n.department) ?? [0, 0];
      const tag = tagOf.get(n.id) ?? -1;
      const node: Node = {
        ...n,
        color: color(n.department),
        ax,
        ay,
        tag,
        x: ax + (Math.random() - 0.5) * 20,
        y: ay + (Math.random() - 0.5) * 20,
      };
      const fixed = topoPos.get(n.id);
      if (fixed) {
        node.x = node.fx = fixed[0];
        node.y = node.fy = fixed[1];
      }
      return node;
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: Link[] = shown.edges.flatMap((e) => {
      const s = byId.get(e.source),
        t = byId.get(e.target);
      return s && t ? [{ source: s, target: t, type: e.type }] : [];
    });
    const members = tags.map((_, i) => nodes.filter((n) => n.tag === i));

    const sim = d3.forceSimulation<Node>(nodes).alphaDecay(topo ? 0.2 : 0.035);
    if (!topo) {
      sim
        .force(
          "link",
          // tagged courses aren't tied to their neighbors in the layout (their lines still draw),
          // or a well-connected one would drag its circle back across the catalog
          d3
            .forceLink<Node, Link>(links.filter((l) => l.source.tag < 0 && l.target.tag < 0))
            .distance(similar ? 10 : 14)
            .strength(similar ? 0.25 : 0.08),
        )
        .force("charge", d3.forceManyBody<Node>().strength(-4).distanceMax(60).theta(1.2))
        .force(
          "x",
          d3
            .forceX<Node>((d) => (d.tag >= 0 ? (spots[d.tag]?.x ?? 0) : d.ax))
            .strength((d) => (d.tag >= 0 ? 0.6 : similar ? 0.025 : 0.07)),
        )
        .force(
          "y",
          d3
            .forceY<Node>((d) => (d.tag >= 0 ? (spots[d.tag]?.y ?? 0) : d.ay))
            .strength((d) => (d.tag >= 0 ? 0.6 : similar ? 0.025 : 0.07)),
        )
        .force("collide", d3.forceCollide<Node>(R + 0.8).iterations(1));
    }

    let transform = d3.zoomIdentity;
    let frame = 0;
    const circles = tags.map(() => ({ cx: 0, cy: 0, r: 0 }));
    let selectedId = "";
    // Hovering a course (or a tag) keeps only the edges touching it, so its connections stand out.
    let hoveredNode: Node | null = null;
    // A clicked course stays pinned: its related courses stay lit and labelled (even outside
    // a tag's circle) so you can move around and look into them. Click it or empty space to release.
    let pinned: Node | null = null;
    const neighbors = new Map<Node, Set<Node>>();
    for (const l of links) {
      if (!neighbors.has(l.source)) neighbors.set(l.source, new Set());
      if (!neighbors.has(l.target)) neighbors.set(l.target, new Set());
      neighbors.get(l.source)!.add(l.target);
      neighbors.get(l.target)!.add(l.source);
    }

    const draw = () => {
      frame = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);
      const k = transform.k;
      const focus = hoverRef.current; // a hovered tag isolates its own courses
      const related = pinned ? new Set([pinned, ...(neighbors.get(pinned) ?? [])]) : null;
      const isLit = (n: Node) => related?.has(n) || (focus !== null ? n.tag === focus : n.tag >= 0);
      const touches = (l: Link, n: Node | null) => !!n && (l.source === n || l.target === n);
      const keepEdge =
        hoveredNode || pinned
          ? (l: Link) => touches(l, pinned) || touches(l, hoveredNode)
          : focus !== null
            ? (l: Link) => l.source.tag === focus || l.target.tag === focus
            : () => true;
      const focusing = hoveredNode !== null || pinned !== null || focus !== null;

      if (topo) {
        ctx.font = `700 ${11 / Math.max(k, 0.6)}px ui-sans-serif, system-ui`;
        ctx.fillStyle = "rgba(31, 26, 23, 0.55)";
        // narrow levels sit close together, so labels alternate above and below their blocks
        levels.forEach((l, i) => {
          const label =
            l.depth === 0 ? `Level 0 · no prereqs (${l.count})` : `L${l.depth} (${l.count})`;
          const half = (Math.min(MAX_ROWS, l.count) / 2) * CELL;
          ctx.fillText(label, l.x - 2, i % 2 === 0 ? -half - 10 : half + 16);
        });
      }

      if (similar) {
        ctx.beginPath();
        ctx.strokeStyle = focusing ? "rgba(40, 120, 130, 0.85)" : "rgba(40, 120, 130, 0.16)";
        ctx.lineWidth = (focusing ? 1.4 : 0.6) / Math.sqrt(k);
        for (const l of links) {
          if (!keepEdge(l)) continue;
          ctx.moveTo(l.source.x ?? 0, l.source.y ?? 0);
          ctx.lineTo(l.target.x ?? 0, l.target.y ?? 0);
        }
        ctx.stroke();
      } else {
        // hard solid, soft dashed, each with an arrowhead at the course that needs it
        for (const type of ["hard", "soft"] as const) {
          if (onlyEdgeRef.current && onlyEdgeRef.current !== type) continue;
          ctx.beginPath();
          ctx.setLineDash(type === "soft" ? [3 / k, 2.5 / k] : []);
          ctx.strokeStyle =
            type === "soft"
              ? "rgba(120, 90, 70, 0.55)"
              : `rgba(90, 80, 75, ${focusing ? 0.85 : topo ? 0.14 : 0.28})`;
          ctx.lineWidth = (type === "soft" || focusing ? 1.2 : 0.7) / Math.sqrt(k);
          const heads: [number, number, number][] = [];
          for (const l of links) {
            if (l.type !== type || !keepEdge(l)) continue;
            const sx = l.source.x ?? 0,
              sy = l.source.y ?? 0,
              tx = l.target.x ?? 0,
              ty = l.target.y ?? 0;
            const a = Math.atan2(ty - sy, tx - sx);
            const ex = tx - Math.cos(a) * (R + 0.6),
              ey = ty - Math.sin(a) * (R + 0.6);
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            heads.push([ex, ey, a]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.fillStyle = ctx.strokeStyle;
          for (const [x, y, a] of heads) {
            ctx.moveTo(x, y);
            ctx.lineTo(x - Math.cos(a - 0.45) * 2.6, y - Math.sin(a - 0.45) * 2.6);
            ctx.lineTo(x - Math.cos(a + 0.45) * 2.6, y - Math.sin(a + 0.45) * 2.6);
            ctx.closePath();
          }
          ctx.fill();
        }
      }

      const drawNodes = (list: Node[], alpha: number) => {
        ctx.globalAlpha = alpha;
        for (const n of list) {
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, R, 0, Math.PI * 2);
          ctx.fillStyle = n.color;
          ctx.fill();
          if (planIds.has(n.id) || n.id === selectedId) {
            ctx.lineWidth = n.id === selectedId ? 2 : 1.4;
            ctx.strokeStyle = n.id === selectedId ? "#90291e" : "#1f1a17";
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      };
      const label = (list: Node[]) => {
        // centered on the node, with a light halo so the number reads over the dot and edges
        ctx.font = `700 ${10 / k}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3 / k;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillStyle = "#1f1a17";
        for (const n of list) {
          ctx.strokeText(n.number, n.x ?? 0, n.y ?? 0);
          ctx.fillText(n.number, n.x ?? 0, n.y ?? 0);
        }
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      };

      if (!grouped) {
        if (related) {
          // pinned: the course and its related courses stand out, the rest steps back
          drawNodes(
            nodes.filter((n) => !related.has(n)),
            0.25,
          );
          drawNodes([...related], 1);
          label([
            ...related,
            ...(hoveredNode ? [hoveredNode, ...(neighbors.get(hoveredNode) ?? [])] : []),
          ]);
          return;
        }
        const only = similar ? null : onlyEdgeRef.current;
        if (only) {
          const ends = new Set(
            links.filter((l) => l.type === only).flatMap((l) => [l.source, l.target]),
          );
          box.dataset["onlyEdge"] =
            `${only}:${links.filter((l) => l.type === only).length}:${ends.size}`;
          drawNodes(
            nodes.filter((n) => !ends.has(n)),
            0.12,
          );
          drawNodes([...ends], 1);
          if (ends.size <= 400 || k >= LABEL_ZOOM)
            label([...ends].filter((n) => onScreen(n, transform, width, height)));
          return;
        }
        box.dataset["onlyEdge"] = "";
        drawNodes(nodes, 1);
        if (k >= LABEL_ZOOM) label(nodes.filter((n) => onScreen(n, transform, width, height)));
        else if (hoveredNode) label([hoveredNode, ...(neighbors.get(hoveredNode) ?? [])]);
        return;
      }
      // tags: everything else faded under a gray overlay with holes over the lit courses
      const lit = nodes.filter(isLit);
      drawNodes(
        nodes.filter((n) => !isLit(n)),
        0.18,
      );
      const visibleTags = tags.map((_, i) => i).filter((i) => focus === null || focus === i);
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 2e5);
      for (const i of visibleTags) {
        const group = members[i] ?? [];
        if (!group.length) continue;
        if (topo) {
          // topological positions are fixed, so each tagged course gets its own hole
          for (const n of group) {
            ctx.moveTo((n.x ?? 0) + 9, n.y ?? 0);
            ctx.arc(n.x ?? 0, n.y ?? 0, 9, 0, Math.PI * 2, true);
          }
        } else {
          const c = circles[i]!;
          c.cx = d3.mean(group, (n) => n.x) ?? 0;
          c.cy = d3.mean(group, (n) => n.y) ?? 0;
          c.r = (d3.max(group, (n) => Math.hypot((n.x ?? 0) - c.cx, (n.y ?? 0) - c.cy)) ?? 0) + 14;
          ctx.moveTo(c.cx + c.r, c.cy);
          ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2, true);
        }
      }
      ctx.fillStyle = "rgba(31, 26, 23, 0.16)";
      ctx.fill("evenodd");
      for (const i of visibleTags) {
        const group = members[i] ?? [];
        ctx.strokeStyle = TAG_COLORS[i % TAG_COLORS.length]!;
        ctx.setLineDash(topo ? [] : [6 / k, 5 / k]);
        ctx.lineWidth = 2 / k;
        if (topo) {
          for (const n of group) {
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, 7, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (group.length) {
          const c = circles[i]!;
          ctx.beginPath();
          ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      drawNodes(lit, 1);
      label(
        hoveredNode
          ? [...new Set([...lit, hoveredNode, ...(neighbors.get(hoveredNode) ?? [])])]
          : lit,
      );
      if (pinned) {
        // ring the pinned course so it's easy to find again
        ctx.beginPath();
        ctx.arc(pinned.x ?? 0, pinned.y ?? 0, R + 3, 0, Math.PI * 2);
        ctx.lineWidth = 2 / k;
        ctx.strokeStyle = "#90291e";
        ctx.stroke();
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redrawRef.current = schedule;

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.08, 12])
      .on("zoom", (event) => {
        transform = event.transform;
        setCard(null);
        schedule();
      });
    const sel = d3.select(canvas).call(zoom);
    const bounds = () => {
      const pts = topo
        ? [...topoPos.values()]
        : [
            [cloud.x - cloud.r, cloud.y - cloud.r],
            [cloud.x + cloud.r, cloud.y + cloud.r],
            ...spots.map((s) => [s.x, s.y]),
          ];
      const [x0, x1] = d3.extent(pts, (p) => p[0]) as [number, number];
      const [y0, y1] = d3.extent(pts, (p) => p[1]) as [number, number];
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 80, h: y1 - y0 + 80 };
    };
    // Centered from the first frame: the layout's extent is known before the simulation runs.
    const fitAll = () => {
      const b = bounds();
      const k = Math.min(4, 0.92 * Math.min(width / b.w, height / b.h));
      sel.call(
        zoom.transform,
        d3.zoomIdentity.translate(width / 2 - b.cx * k, height / 2 - b.cy * k).scale(k),
      );
    };
    fitAll();

    const resize = new ResizeObserver(() => {
      sizeCanvas();
      fitAll();
    });
    resize.observe(box);

    setSettling(true);
    sim.on("tick", schedule);
    sim.on("end", () => {
      setSettling(false);
      schedule();
      // summary for tests and assistive tech
      const inside = (n: Node, c: { cx: number; cy: number; r: number }) =>
        Math.hypot((n.x ?? 0) - c.cx, (n.y ?? 0) - c.cy) <= c.r;
      const b = bounds();
      Object.assign(box.dataset, {
        mode,
        sort,
        nodes: String(nodes.length),
        edges: String(links.length),
        hard: String(links.filter((l) => l.type === "hard").length),
        soft: String(links.filter((l) => l.type === "soft").length),
        similar: String(links.filter((l) => l.type === "similar").length),
        levels: String(levels.length),
        tags: String(tags.length),
        tagged: members.map((m) => m.length).join(","),
        // clusters only: courses inside a tag's circle that aren't in that tag
        strays: topo
          ? ""
          : members
              .map(
                (m, i) =>
                  nodes.filter((n) => n.tag !== i && m.length && inside(n, circles[i]!)).length,
              )
              .join(","),
        // topological only: does every arrow point right (prerequisite before course)?
        backwardArrows:
          topo && !similar
            ? String(links.filter((l) => (l.source.x ?? 0) >= (l.target.x ?? 0)).length)
            : "",
        centerOffset: String(
          Math.round(
            Math.hypot(transform.applyX(b.cx) - width / 2, transform.applyY(b.cy) - height / 2),
          ),
        ),
      });
    });

    const pick = (event: MouseEvent) => {
      const [px, py] = d3.pointer(event, canvas);
      const [x, y] = transform.invert([px, py]);
      return sim.find(x, y, Math.max(R * 2, 8 / transform.k));
    };
    sel.on("mousemove.hover", (event: MouseEvent) => {
      const n = pick(event);
      canvas.style.cursor = n ? "pointer" : "grab";
      const rect = box.getBoundingClientRect();
      setHover(n ? { x: event.clientX - rect.left, y: event.clientY - rect.top, node: n } : null);
      if ((n ?? null) !== hoveredNode) {
        hoveredNode = n ?? null;
        box.dataset["hoverEdges"] = hoveredNode
          ? String(neighbors.get(hoveredNode)?.size ?? 0)
          : "";
        schedule();
      }
    });
    sel.on("mouseleave.hover", () => {
      setHover(null);
      hoveredNode = null;
      schedule();
    });
    sel.on("click.card", (event: MouseEvent) => {
      const n = pick(event);
      const rect = box.getBoundingClientRect();
      pinned = n && n !== pinned ? n : null; // clicking the pinned course again releases it
      selectedId = pinned?.id ?? "";
      box.dataset["pinned"] = pinned?.id ?? "";
      box.dataset["pinnedRelated"] = pinned ? String(neighbors.get(pinned)?.size ?? 0) : "";
      schedule();
      setHover(null);
      setCard(
        pinned ? { x: event.clientX - rect.left, y: event.clientY - rect.top, node: pinned } : null,
      );
    });
    // lets tests and keyboard users focus a course's edges by id, like hovering it
    (box as HTMLDivElement & { hoverCourse?: (id: string | null) => void }).hoverCourse = (id) => {
      hoveredNode = id ? (byId.get(id) ?? null) : null;
      box.dataset["hoverEdges"] = hoveredNode ? String(neighbors.get(hoveredNode)?.size ?? 0) : "";
      schedule();
    };
    // lets tests and keyboard users select a course by id
    (box as HTMLDivElement & { selectCourse?: (id: string) => void }).selectCourse = (id) => {
      const n = byId.get(id);
      if (!n) return;
      pinned = n; // same as clicking it
      selectedId = id;
      box.dataset["pinned"] = id;
      box.dataset["pinnedRelated"] = String(neighbors.get(n)?.size ?? 0);
      schedule();
      setCard({ x: transform.applyX(n.x ?? 0), y: transform.applyY(n.y ?? 0), node: n });
    };

    return () => {
      sim.stop();
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
      redrawRef.current = () => undefined;
      sel.on(".zoom", null).on(".hover", null).on(".card", null);
    };
  }, [shown, tags, color, planIds, mode, sort, prereqEdges, resetKey]);

  /** A search term (or a program) becomes a tag; classes and topics go through hybrid search. */
  const addTag = async (program?: ProgramSummary) => {
    const q = query.trim();
    if (!program && !q) return;
    setBusy(true);
    setCard(null);
    try {
      let tag: Tag;
      if (program) {
        tag = {
          key: `p:${program.id}`,
          kind: "program",
          label:
            program.kind === "major" && program.code
              ? program.code
              : program.name.replace(/^Minor in /, "").replace(/^HASS Concentration: /, ""),
          detail: program.name,
          courses: await getProgramCourses(program.id),
        };
      } else if (mode === "prereq") {
        // a class: the best match plus its prerequisites and what it unlocks
        const hits = await getGraphGroup(q, 5);
        const top = hits[0] ?? "";
        const near = (base?.edges ?? [])
          .filter((e) => e.source === top || e.target === top)
          .map((e) => (e.source === top ? e.target : e.source));
        tag = {
          key: `c:${top}`,
          kind: "class",
          label: top,
          detail: `${q} → ${top} with its prerequisites and what it unlocks`,
          courses: top ? [top, ...new Set(near)] : [],
          matches: hits,
        };
      } else {
        tag = {
          key: `t:${q.toLowerCase()}`,
          kind: "topic",
          label: q,
          detail: `Courses about “${q}”`,
          courses: await getGraphGroup(q, 8),
        };
      }
      setTags((all) => (all.some((t) => t.key === tag.key) ? all : [...all, tag]));
      setQuery("");
      setSuggestions([]);
    } catch {
      setError("Couldn't search that.");
    } finally {
      setBusy(false);
    }
  };
  const swapClass = (index: number, id: string) =>
    setTags((all) =>
      all.map((t, i) => {
        if (i !== index) return t;
        const near = (base?.edges ?? [])
          .filter((e) => e.source === id || e.target === id)
          .map((e) => (e.source === id ? e.target : e.source));
        return { ...t, key: `c:${id}`, label: id, courses: [id, ...new Set(near)] };
      }),
    );
  const clear = () => {
    setOnlyEdge(null);
    setTags([]);
    setHoverTag(null);
    setQuery("");
    setMine(false);
    setHidden(new Set());
    setHover(null);
    setCard(null);
    setResetKey((k) => k + 1);
  };
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setTags([]);
    setHoverTag(null);
    setCard(null);
  };
  const toggleDept = (d: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  const toggleFull = () =>
    document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen();
  const titleOf = (id: string) => base?.nodes.find((n) => n.id === id)?.title ?? "";

  return (
    <main className="mx-auto max-w-7xl">
      <p className="label-mono">How courses connect</p>
      <h1 className="mt-3 font-display font-black text-foreground">
        Course <span className="text-primary">graph.</span>
      </h1>
      {/* Full screen takes this whole stage, so the graph keeps its filters, sorting and tags. */}
      <div
        ref={stageRef}
        className={full ? "flex h-screen flex-col overflow-hidden bg-background p-4 sm:p-6" : ""}
      >
        <div className={full ? "max-h-[45vh] shrink-0 overflow-y-auto pr-1" : ""}>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Segmented
              label="Graph"
              value={mode}
              onChange={switchMode}
              options={[
                ["prereq", "Prerequisites"],
                ["similar", "Similar content"],
              ]}
            />
            <Segmented
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                ["clusters", "Clusters"],
                ["topological", "Topological"],
              ]}
            />
            <Segmented
              label="Show"
              value={mine ? "mine" : "all"}
              onChange={(v) => setMine(v === "mine")}
              options={[
                ["all", "Whole catalog"],
                ["mine", "My plan + discussed"],
              ]}
            />
          </div>
          <p className="mt-3 text-sm font-semibold text-muted-foreground">
            {mode === "prereq"
              ? "Arrows run from each prerequisite to the course that needs it."
              : "Each course links to the three courses whose catalog descriptions are most similar."}{" "}
            {sort === "topological"
              ? "Sorted topologically: left to right by prerequisite level, so every course sits right of what it needs."
              : "Clustered by department."}{" "}
            Click a course to open it or add it to your cart.
          </p>

          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void addTag();
            }}
          >
            <label className="block space-y-1.5">
              <span className="label-mono">
                {mode === "prereq" ? "Search for a class" : "Search for a topic"}
              </span>
              <span className="flex gap-2">
                <span className="relative block min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
                  <input
                    className="field !pl-9"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={
                      mode === "prereq"
                        ? "e.g. 6.3900, machine learning, or a program like 6-3"
                        : "e.g. climate policy, or a program like 6-3"
                    }
                    aria-label={mode === "prereq" ? "Search for a class" : "Search for a topic"}
                  />
                </span>
                <Button type="submit" size="sm" className="h-10" disabled={busy || !query.trim()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                  Add tag
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-10" onClick={clear}>
                  <X />
                  Clear
                </Button>
              </span>
            </label>
            {suggestions.length > 0 && (
              <div
                className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-bold text-muted-foreground"
                aria-label="Program suggestions"
              >
                <span>Or tag a program:</span>
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void addTag(p)}
                    className="rounded-md border border-dashed border-border bg-card px-2 py-1 hover:border-primary hover:text-primary"
                  >
                    {p.kind === "major" ? "Major" : p.kind === "minor" ? "Minor" : "Concentration"}{" "}
                    ·{" "}
                    {p.kind === "major" && p.code
                      ? p.code
                      : p.name.replace(/^Minor in /, "").replace(/^HASS Concentration: /, "")}
                  </button>
                ))}
              </div>
            )}
          </form>

          {tags.length > 0 && (
            <div
              className="mt-3 flex flex-wrap gap-2"
              aria-label="Tags"
              onMouseLeave={() => setHoverTag(null)}
            >
              {tags.map((t, i) => (
                <span
                  key={t.key}
                  data-tag={t.key}
                  onMouseEnter={() => setHoverTag(i)}
                  onFocus={() => setHoverTag(i)}
                  tabIndex={0}
                  className={`group inline-flex items-center gap-1.5 rounded-full border-2 bg-card py-1 pl-2.5 pr-1 text-xs font-bold transition-opacity ${hoverTag !== null && hoverTag !== i ? "opacity-40" : ""}`}
                  style={{ borderColor: TAG_COLORS[i % TAG_COLORS.length] }}
                  title={t.detail}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: TAG_COLORS[i % TAG_COLORS.length] }}
                  />
                  <span className="text-[10px] uppercase text-muted-foreground">{t.kind}</span>
                  <span className="text-foreground">{t.label}</span>
                  <span className="text-muted-foreground">· {t.courses.length}</span>
                  {t.kind === "class" && t.matches && t.matches.length > 1 && (
                    <span className="hidden gap-1 group-hover:inline-flex">
                      {t.matches
                        .filter((m) => m !== t.label)
                        .map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => swapClass(i, m)}
                            className="rounded border border-border px-1 font-mono text-[10px] hover:border-primary"
                            title={`Use ${m} ${titleOf(m)} instead`}
                          >
                            {m}
                          </button>
                        ))}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setTags((all) => all.filter((_, j) => j !== i))}
                    aria-label={`Remove tag ${t.label}`}
                    className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <span className="self-center text-[11px] font-semibold text-muted-foreground">
                Hover a tag to isolate it.
              </span>
            </div>
          )}

          <div
            className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-bold text-muted-foreground"
            aria-label="Legend"
          >
            {mode === "prereq" ? (
              <>
                {(["hard", "soft"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setOnlyEdge(onlyEdge === type ? null : type)}
                    aria-pressed={onlyEdge === type}
                    data-edge-filter={type}
                    title={onlyEdge === type ? "Show all edges" : `Show only ${type} prerequisites`}
                    className={`inline-flex items-center gap-2 rounded-md border px-1.5 py-0.5 ${
                      onlyEdge === type
                        ? "border-primary bg-primary text-primary-foreground"
                        : onlyEdge
                          ? "border-border opacity-50 hover:opacity-100"
                          : "border-border hover:border-primary"
                    }`}
                  >
                    <svg width="28" height="6">
                      <line
                        x1="0"
                        y1="3"
                        x2="28"
                        y2="3"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray={type === "soft" ? "5 4" : undefined}
                      />
                    </svg>
                    {type === "hard" ? "Hard prerequisite" : "Soft prerequisite"}
                  </button>
                ))}
                <span className="text-[11px] font-semibold">
                  {onlyEdge
                    ? `Showing only ${onlyEdge} prerequisites · click again for all`
                    : "Click a type to see only those edges"}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-2">
                <svg width="28" height="6">
                  <line x1="0" y1="3" x2="28" y2="3" stroke="rgb(40,120,130)" strokeWidth="2" />
                </svg>
                Similar content
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border-2 border-foreground" />
              In your plan
            </span>
          </div>
          <div className="mt-2 text-xs font-bold text-muted-foreground">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[var(--primary)]"
                  checked={hidden.size === 0}
                  ref={(el) => {
                    if (el) el.indeterminate = hidden.size > 0 && hidden.size < departments.length;
                  }}
                  // all shown -> hide all; otherwise show all. Tagged courses stay visible either way.
                  onChange={() => setHidden(hidden.size === 0 ? new Set(departments) : new Set())}
                  aria-label="Select all departments"
                />
                Select all
              </label>
              <span>
                Click a color to hide or show that Course.
                {hidden.size > 0 && ` ${hidden.size} of ${departments.length} hidden.`}
              </span>
            </p>
            <div className="mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
              {[...departments]
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDept(d)}
                    aria-pressed={!hidden.has(d)}
                    data-legend-dept={d}
                    className={`inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 ${hidden.has(d) ? "opacity-40 line-through" : "bg-card/70 hover:border-primary"}`}
                    title={hidden.has(d) ? `Show Course ${d}` : `Hide Course ${d}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(d) }} />
                    {d}
                  </button>
                ))}
            </div>
          </div>
        </div>

        <div
          ref={boxRef}
          className={`relative mt-4 overflow-hidden rounded-lg border border-border bg-card ${full ? "min-h-0 flex-1" : ""}`}
          style={full ? undefined : { height: HEIGHT }}
          data-graph
        >
          {error ? (
            <p className="p-10 text-center font-bold text-destructive">{error}</p>
          ) : !shown ? (
            <p className="flex h-full items-center justify-center gap-2 font-semibold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the catalog…
            </p>
          ) : shown.nodes.length === 0 ? (
            <p className="flex h-full items-center justify-center p-10 text-center font-semibold text-muted-foreground">
              Nothing to show here. Bring hidden departments back.
            </p>
          ) : (
            <canvas
              key={`${mode}-${sort}-${resetKey}`}
              ref={canvasRef}
              className="block"
              style={{ cursor: "grab" }}
              role="img"
              aria-label={`${mode === "prereq" ? "Prerequisite" : "Similarity"} graph, ${sort === "topological" ? "sorted topologically" : "clustered"}, with ${shown.nodes.length} courses${tags.length ? `, ${tags.length} tags` : ""}`}
            />
          )}
          <div className="absolute right-3 top-3 flex items-center gap-2">
            {shown && settling && sort === "clusters" && (
              <span className="pointer-events-none inline-flex items-center gap-1.5 rounded-md bg-card/90 px-2 py-1 text-[11px] font-bold text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Arranging{" "}
                {shown.nodes.length.toLocaleString()} courses…
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void toggleFull()}
              aria-label={full ? "Exit full screen" : "Full screen"}
            >
              {full ? <Minimize2 /> : <Maximize2 />}
              {full ? "Exit" : "Full screen"}
            </Button>
          </div>
          {full && (
            <div className="absolute bottom-3 left-3 w-72 rounded-lg border border-border bg-card/95 p-3 shadow-md">
              <p className="label-mono mb-2 flex items-center gap-1.5">
                <ShoppingCart className="h-3 w-3" /> Class cart · {plan.cart.length}
              </p>
              <div className="max-h-48 overflow-y-auto">
                <CartList compact />
              </div>
            </div>
          )}
          {hover && !card && (
            <div
              className="pointer-events-none absolute z-10 max-w-60 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
              role="tooltip"
            >
              <span className="font-mono font-bold text-primary">{hover.node.number}</span>
              <span className="block font-semibold text-foreground">{hover.node.title}</span>
            </div>
          )}
          {card && (
            <div
              className="absolute z-20 w-64 rounded-lg border border-border bg-card p-3 shadow-lg"
              style={{
                left: Math.min(card.x + 12, (boxRef.current?.clientWidth ?? 600) - 272),
                top: Math.min(card.y + 12, (boxRef.current?.clientHeight ?? HEIGHT) - 140),
              }}
              role="dialog"
              aria-label={`${card.node.number} ${card.node.title}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span>
                  <span className="font-mono text-xs font-bold text-primary">
                    {card.node.number}
                  </span>
                  <span className="block text-sm font-extrabold text-foreground">
                    {card.node.title}
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Course {card.node.department}
                  </span>
                  <span className="mt-1 block text-[11px] font-semibold text-primary">
                    Pinned: its related courses stay lit. Hover them to look closer; click empty
                    space to release.
                  </span>
                </span>
                <button type="button" onClick={() => setCard(null)} aria-label="Close">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link to="/courses/$courseId" params={{ courseId: card.node.id }}>
                    Open description
                  </Link>
                </Button>
                <AddToPlanButton courseId={card.node.id} />
                <AddToCartButton courseId={card.node.id} />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label={label}>
      <span className="label-mono">{label}</span>
      <span className="inline-flex rounded-md border border-border bg-card p-0.5">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`rounded px-2.5 py-1 text-xs font-bold ${value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {text}
          </button>
        ))}
      </span>
    </div>
  );
}

function onScreen(n: Node, t: d3.ZoomTransform, width: number, height: number) {
  const [x, y] = t.apply([n.x ?? 0, n.y ?? 0]);
  return x > -20 && x < width + 20 && y > -20 && y < height + 20;
}
