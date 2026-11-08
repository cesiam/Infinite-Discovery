// The Green Building at night: its windows light up as falling blocks stack into place,
// like the Tetris hack. A small bot plays; full rows flash and clear, and when the stack
// gets high the board dissolves and starts over. Draws into a canvas until stopped.

const COLS = 9;
const ROWS = 16;
type Piece = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Cell = [number, number];

// Lit windows in the app's colors: reds and blues, plus white.
const COLORS: Record<Piece, string> = {
  I: "#8FDCFF",
  O: "#FFFFFF",
  T: "#2B8FD6",
  S: "#48BEFF",
  Z: "#E0262B",
  J: "#7FCBF5",
  L: "#F45B69",
};
const BASE: Record<Piece, Cell[]> = {
  I: [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
  O: [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ],
  T: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 1],
  ],
  S: [
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
  ],
  Z: [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 2],
  ],
  J: [
    [0, 0],
    [1, 0],
    [1, 1],
    [1, 2],
  ],
  L: [
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
  ],
};
const PIECES = Object.keys(BASE) as Piece[];

const norm = (cells: Cell[]): Cell[] => {
  const mr = Math.min(...cells.map((c) => c[0]));
  const mc = Math.min(...cells.map((c) => c[1]));
  return cells.map(([r, c]) => [r - mr, c - mc] as Cell).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
};
const ROT = Object.fromEntries(
  PIECES.map((k) => {
    const seen = new Set<string>();
    const out: Cell[][] = [];
    let cur = norm(BASE[k]);
    for (let i = 0; i < 4; i++) {
      const key = JSON.stringify(cur);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(cur);
      }
      cur = norm(cur.map(([r, c]) => [c, -r] as Cell));
    }
    return [k, out];
  }),
) as Record<Piece, Cell[][]>;

export const TICKER_COURSES = [
  "6.1210",
  "18.06",
  "21M.030",
  "8.02",
  "6.3900",
  "14.01",
  "7.012",
  "6.4100",
  "24.09",
  "5.111",
  "6.1020",
  "18.03",
  "6.1800",
  "21G.501",
  "6.1910",
  "6.4200",
];
const TERMS = [
  "Fall 26",
  "IAP 27",
  "Spring 27",
  "Fall 27",
  "Spring 28",
  "Fall 28",
  "Spring 29",
  "Fall 29",
  "Spring 30",
];

type Board = (Piece | null)[][];
const emptyBoard = (): Board => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

const fits = (b: Board, cells: Cell[], r0: number, c0: number) =>
  cells.every(([r, c]) => {
    const rr = r + r0;
    const cc = c + c0;
    return cc >= 0 && cc < COLS && rr < ROWS && (rr < 0 || !b[rr]![cc]);
  });
function dropRow(b: Board, cells: Cell[], c0: number) {
  let r = -4;
  if (!fits(b, cells, r, c0)) return null;
  while (fits(b, cells, r + 1, c0)) r++;
  return r;
}
function evaluate(b: Board) {
  let agg = 0;
  let holes = 0;
  let bump = 0;
  let lines = 0;
  const hs: number[] = [];
  for (let c = 0; c < COLS; c++) {
    let h = 0;
    for (let r = 0; r < ROWS; r++)
      if (b[r]![c]) {
        h = ROWS - r;
        break;
      }
    hs.push(h);
    agg += h;
    let seen = false;
    for (let r = 0; r < ROWS; r++) {
      if (b[r]![c]) seen = true;
      else if (seen) holes++;
    }
  }
  for (let c = 0; c < COLS - 1; c++) bump += Math.abs(hs[c]! - hs[c + 1]!);
  b.forEach((row) => {
    if (row.every(Boolean)) lines++;
  });
  return -0.51 * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump;
}

/** Starts the animation; `onPlace` names the course "placed" with each new piece. Returns a stop function. */
export function startTower(
  canvas: HTMLCanvasElement,
  onPlace: (course: string, term: string) => void,
): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => undefined;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let board = emptyBoard();
  const warm = Array.from({ length: ROWS }, (_, r) =>
    Array.from(
      { length: COLS },
      (_, c) => (r * 7 + c * 13) % 11 === 0 || (r * 3 + c * 5) % 17 === 0,
    ),
  );
  let piece: { type: Piece; cells: Cell[]; c0: number; target: number; r: number } | null = null;
  let state: "fall" | "flash" | "dissolve" = "fall";
  let flashRows: number[] = [];
  let flashUntil = 0;
  let lastStep = 0;
  let tickN = 0;

  function choose(type: Piece) {
    let best: { cells: Cell[]; c0: number; r0: number; score: number } | null = null;
    for (const cells of ROT[type]) {
      const w = Math.max(...cells.map((c) => c[1])) + 1;
      for (let c0 = 0; c0 <= COLS - w; c0++) {
        const r0 = dropRow(board, cells, c0);
        if (r0 === null || cells.some(([r]) => r + r0 < 0)) continue;
        const b = board.map((row) => row.slice());
        cells.forEach(([r, c]) => (b[r + r0]![c + c0] = type));
        const score = evaluate(b) + Math.random() * 0.35;
        if (!best || score > best.score) best = { cells, c0, r0, score };
      }
    }
    return best;
  }
  const bag: Piece[] = [];
  function nextType(): Piece {
    if (!bag.length) {
      bag.push(...PIECES);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
    }
    return bag.pop()!;
  }
  const lock = (type: Piece, cells: Cell[], r0: number, c0: number) =>
    cells.forEach(([r, c]) => (board[r + r0]![c + c0] = type));
  const fullRows = () => board.map((row, i) => (row.every(Boolean) ? i : -1)).filter((i) => i >= 0);
  const clearRows = (rows: number[]) =>
    [...rows]
      .sort((a, b) => a - b)
      .forEach((r) => {
        board.splice(r, 1);
        board.unshift(Array(COLS).fill(null));
      });
  const stackHeight = () => {
    for (let r = 0; r < ROWS; r++) if (board[r]!.some(Boolean)) return ROWS - r;
    return 0;
  };
  function spawn() {
    const type = nextType();
    const ch = choose(type);
    if (!ch || stackHeight() >= 12) {
      state = "dissolve";
      piece = null;
      return;
    }
    piece = {
      type,
      cells: ch.cells,
      c0: ch.c0,
      target: ch.r0,
      r: -(Math.max(...ch.cells.map((c) => c[0])) + 1),
    };
    onPlace(TICKER_COURSES[tickN % TICKER_COURSES.length]!, TERMS[tickN % TERMS.length]!);
    tickN++;
  }
  // open in a realistic state: a few pieces already stacked
  for (let i = 0; i < (reduce ? 18 : 15); i++) {
    const type = nextType();
    const ch = choose(type);
    if (!ch) break;
    lock(type, ch.cells, ch.r0, ch.c0);
    const f = fullRows();
    if (f.length) clearRows(f);
  }

  // ---- drawing ----
  let W = 0;
  let H = 0;
  const G = {
    fx: 0,
    fy: 0,
    fw: 0,
    fh: 0,
    side: 0,
    pier: 0,
    base: 0,
    gx: 0,
    gw: 0,
    gy: 0,
    gh: 0,
    cw: 0,
    ch: 0,
  };
  function layout() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    let fh = H * 0.84;
    let fw = fh * 0.47;
    if (fw > W * 0.74) {
      fw = W * 0.74;
      fh = fw / 0.47;
    }
    const side = fw * 0.16;
    const fx = (W - fw) / 2 + side * 0.45;
    const fy = H - fh;
    const pier = fw * 0.09;
    const top = fh * 0.04;
    const base = fh * 0.15;
    Object.assign(G, {
      fx,
      fy,
      fw,
      fh,
      side,
      pier,
      base,
      gx: fx + pier,
      gw: fw - 2 * pier,
      gy: fy + top,
      gh: fh - top - base,
    });
    G.cw = G.gw / COLS;
    G.ch = G.gh / ROWS;
  }
  function rr(x: number, y: number, w: number, h: number, r: number) {
    ctx!.beginPath();
    ctx!.roundRect(x, y, w, h, r);
  }
  const cellRect = (r: number, c: number) =>
    [
      G.gx + c * G.cw + G.cw * 0.17,
      G.gy + r * G.ch + G.ch * 0.13,
      G.cw * 0.66,
      G.ch * 0.74,
    ] as const;
  function drawLit(r: number, c: number, color: string) {
    if (r < 0) return;
    const [x, y, w, h] = cellRect(r, c);
    const g = ctx!;
    g.save();
    g.shadowColor = color;
    g.shadowBlur = G.cw * 0.9;
    g.fillStyle = color;
    rr(x, y, w, h, 2);
    g.fill();
    g.shadowBlur = 0;
    const sheen = g.createLinearGradient(0, y, 0, y + h);
    sheen.addColorStop(0, "rgba(255,255,255,.55)");
    sheen.addColorStop(0.45, "rgba(255,255,255,.08)");
    sheen.addColorStop(1, "rgba(0,0,0,.12)");
    g.fillStyle = sheen;
    rr(x, y, w, h, 2);
    g.fill();
    g.fillStyle = "rgba(0,0,0,.18)";
    g.fillRect(x + w / 2 - 0.6, y, 1.2, h);
    g.restore();
  }
  function draw(now: number) {
    const g = ctx!;
    g.clearRect(0, 0, W, H);
    const { fx, fy, fw, fh, side } = G;
    // ground glow
    const gg = g.createRadialGradient(fx + fw / 2, H, 0, fx + fw / 2, H, fw * 1.1);
    gg.addColorStop(0, "rgba(224,38,43,.26)");
    gg.addColorStop(1, "rgba(224,38,43,0)");
    g.fillStyle = gg;
    g.fillRect(0, 0, W, H);
    // radome + mast
    const rd = fw * 0.11;
    const rx = fx + fw * 0.27;
    const ry = fy - rd * 0.95;
    g.fillStyle = "#3B3836";
    g.fillRect(rx - rd * 0.55, fy - rd * 0.32, rd * 1.1, rd * 0.34);
    const sg = g.createRadialGradient(rx - rd * 0.35, ry - rd * 0.4, rd * 0.1, rx, ry, rd);
    sg.addColorStop(0, "#F4F5F8");
    sg.addColorStop(1, "#8E96A8");
    g.fillStyle = sg;
    g.beginPath();
    g.arc(rx, ry, rd, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(5,32,74,.18)";
    g.lineWidth = 1;
    for (let k = -2; k <= 2; k++) {
      g.beginPath();
      g.ellipse(rx, ry, Math.abs(k) * rd * 0.32 + 0.01, rd, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(rx, ry, rd, rd * 0.35, 0, 0, Math.PI * 2);
    g.stroke();
    const mx = fx + fw * 0.6;
    g.strokeStyle = "#8E96A8";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(mx, fy);
    g.lineTo(mx, fy - fh * 0.085);
    g.stroke();
    const blink = reduce || Math.floor(now / 700) % 2 === 0;
    g.fillStyle = blink ? "#FF4A4F" : "#5A0001";
    g.shadowColor = "#FF4A4F";
    g.shadowBlur = blink ? 10 : 0;
    g.beginPath();
    g.arc(mx, fy - fh * 0.085, 2.6, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    // side face
    const sgr = g.createLinearGradient(fx - side, 0, fx, 0);
    sgr.addColorStop(0, "#1E1C1F");
    sgr.addColorStop(1, "#2C2929");
    g.fillStyle = sgr;
    g.beginPath();
    g.moveTo(fx - side, fy + side * 0.35);
    g.lineTo(fx, fy);
    g.lineTo(fx, H);
    g.lineTo(fx - side, H);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(5,10,24,.75)";
    for (let r = 0; r < ROWS; r++) {
      const y = G.gy + r * G.ch + G.ch * 0.18;
      g.fillRect(fx - side * 0.72, y, side * 0.22, G.ch * 0.62);
      g.fillRect(fx - side * 0.38, y, side * 0.22, G.ch * 0.62);
    }
    // facade
    const fg = g.createLinearGradient(0, fy, 0, H);
    fg.addColorStop(0, "#4D4842");
    fg.addColorStop(0.7, "#3E3935");
    fg.addColorStop(1, "#4A3B33");
    g.fillStyle = fg;
    g.fillRect(fx, fy, fw, fh);
    g.fillStyle = "rgba(255,255,255,.05)";
    g.fillRect(fx, fy, G.pier * 0.5, fh);
    g.fillRect(fx + fw - G.pier * 0.5, fy, G.pier * 0.5, fh);
    g.fillStyle = "rgba(255,255,255,.07)";
    g.fillRect(fx, fy, fw, 2);
    for (let c = 0; c <= COLS; c++) {
      g.fillStyle = "rgba(255,255,255,.045)";
      g.fillRect(G.gx + c * G.cw - G.cw * 0.06, G.gy, G.cw * 0.12, G.gh);
    }
    // dark + warm windows
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const [x, y, w, h] = cellRect(r, c);
        const wg = g.createLinearGradient(x, y, x + w, y + h);
        wg.addColorStop(0, "#16223D");
        wg.addColorStop(1, "#070C18");
        g.fillStyle = wg;
        rr(x, y, w, h, 2);
        g.fill();
        if (warm[r]![c] && !board[r]![c]) {
          g.fillStyle = "rgba(255,255,255,.16)";
          rr(x, y, w, h, 2);
          g.fill();
        }
      }
    // locked blocks
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const t = board[r]![c];
        if (!t) continue;
        const on = flashRows.includes(r) && Math.floor(now / 80) % 2 === 0;
        drawLit(r, c, on ? "#FFFFFF" : COLORS[t]);
      }
    // falling piece
    if (piece) {
      const p = piece;
      p.cells.forEach(([r, c]) => drawLit(r + p.r, c + p.c0, COLORS[p.type]));
    }
    // base with lit entrances
    const by = G.gy + G.gh;
    g.fillStyle = "rgba(0,0,0,.18)";
    g.fillRect(fx, by, fw, 3);
    for (const [a, b] of [
      [0.17, 0.33],
      [0.4, 0.62],
      [0.69, 0.83],
    ] as const) {
      const x = fx + fw * a;
      const w = fw * (b - a);
      const y = by + G.base * 0.32;
      const lg = g.createLinearGradient(0, y, 0, H);
      lg.addColorStop(0, "#FFFFFF");
      lg.addColorStop(1, "#F45B69");
      g.save();
      g.shadowColor = "#FFFFFF";
      g.shadowBlur = 24;
      g.fillStyle = lg;
      g.fillRect(x, y, w, H - y);
      g.restore();
      g.fillStyle = "rgba(34,24,28,.55)";
      for (let k = 1; k < 3; k++) g.fillRect(x + (w * k) / 3 - 1, y, 2, H - y);
    }
  }

  // ---- loop ----
  const STEP = 95;
  let frame = 0;
  function tick(now: number) {
    if (state === "fall") {
      if (!piece) spawn();
      if (piece && now - lastStep > STEP) {
        lastStep = now;
        if (piece.r < piece.target) piece.r++;
        else {
          lock(piece.type, piece.cells, piece.r, piece.c0);
          piece = null;
          const f = fullRows();
          if (f.length) {
            flashRows = f;
            flashUntil = now + 520;
            state = "flash";
          }
        }
      }
    } else if (state === "flash") {
      if (now > flashUntil) {
        clearRows(flashRows);
        flashRows = [];
        state = "fall";
      }
    } else if (now - lastStep > 45) {
      lastStep = now;
      const filled: Cell[] = [];
      board.forEach((row, r) => row.forEach((v, c) => v && filled.push([r, c])));
      if (!filled.length) {
        board = emptyBoard();
        state = "fall";
      } else
        for (let k = 0; k < 3 && filled.length; k++) {
          const [r, c] = filled.splice(Math.floor(Math.random() * filled.length), 1)[0]!;
          board[r]![c] = null;
        }
    }
    draw(now);
    frame = requestAnimationFrame(tick);
  }

  const onResize = () => {
    layout();
    if (reduce) draw(0);
  };
  layout();
  addEventListener("resize", onResize);
  if (reduce) draw(0);
  else frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener("resize", onResize);
  };
}
