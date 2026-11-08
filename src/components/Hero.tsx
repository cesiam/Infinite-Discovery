import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Infinity as InfinityIcon, Search } from "lucide-react";
import { startTower } from "@/lib/tower";
import { SignIn } from "./SignIn";

// Letters drawn in the pixel face at rest; others flicker into it now and then.
const WORDS = [
  { word: "INFINITE", pixel: [4] },
  { word: "DISCOVERY", pixel: [3, 7] },
];
// The feed from the old opening screen: things students wondered after a class.
const FEED = [
  "I loved the hands-on circuits in 6.1910 — what should I take next?",
  "18.06 finally made linear algebra click. Where do I go deeper?",
  "21M.301 changed how I hear music — any good follow-ups?",
  "14.01 made the news make sense. Which econ class comes next?",
];

const STARTERS = [
  { label: "Machine learning", color: "var(--primary)" },
  { label: "Climate & energy", color: "var(--sky)" },
  { label: "Music & theater", color: "var(--ink)" },
  { label: "Biology", color: "var(--sky)" },
];

function Headline() {
  const ref = useRef<HTMLHeadingElement>(null);
  const [flicker, setFlicker] = useState<string | null>(null);

  // Each letter keeps the wider of its two faces, so swapping never shifts the line.
  useLayoutEffect(() => {
    const letters = [...(ref.current?.querySelectorAll<HTMLSpanElement>(".hero-l") ?? [])];
    const lock = () =>
      letters.forEach((l) => {
        l.style.width = "";
        const was = l.classList.contains("px");
        l.classList.remove("px");
        const a = l.getBoundingClientRect().width;
        l.classList.add("px");
        const b = l.getBoundingClientRect().width;
        l.classList.toggle("px", was);
        l.style.width = `${Math.max(a, b)}px`;
      });
    void document.fonts?.ready.then(lock);
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(lock, 150);
    };
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let off: ReturnType<typeof setTimeout>;
    const id = setInterval(() => {
      const free = WORDS.flatMap(({ word, pixel }) =>
        [...word].map((_, i) => `${word}-${i}`).filter((_, i) => !pixel.includes(i)),
      );
      setFlicker(free[Math.floor(Math.random() * free.length)] ?? null);
      off = setTimeout(() => setFlicker(null), 1100);
    }, 1400);
    return () => {
      clearInterval(id);
      clearTimeout(off);
    };
  }, []);

  return (
    <h1 ref={ref} id="hero-title" className="hero-title" aria-label="Infinite Discovery">
      {WORDS.map(({ word, pixel }) => (
        <span key={word} className="hero-w" aria-hidden="true">
          {[...word].map((ch, i) => (
            <span
              key={i}
              className={`hero-l${pixel.includes(i) || flicker === `${word}-${i}` ? " px" : ""}`}
            >
              {ch}
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}

function Tower() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [placing, setPlacing] = useState({ course: "6.1210", term: "Fall 27" });
  useEffect(() => {
    if (!canvas.current) return;
    return startTower(canvas.current, (course, term) => setPlacing({ course, term }));
  }, []);
  return (
    <>
      <div className="hero-tower-wrap">
        <canvas
          ref={canvas}
          className="hero-tower"
          role="img"
          aria-label="MIT's Green Building at night. Its windows light up in color as falling blocks stack into place, like the Tetris hack."
        />
      </div>
      <div className="hero-ticker" aria-hidden="true">
        Now placing
        <b>
          {placing.course} <span>→</span> {placing.term}
        </b>
      </div>
    </>
  );
}

/** The opening screen: the Green Building stacking classes like the Tetris hack. */
export function Hero() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const discover = (query: string) =>
    navigate({ to: "/", search: { plan: 1, ...(query.trim() ? { q: query.trim() } : {}) } });

  return (
    <section className="hero" aria-labelledby="hero-title">
      <svg className="hero-steps" viewBox="0 0 24 14" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="hero-night" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0A2F6E" />
            <stop offset=".65" stopColor="#05204A" />
            <stop offset="1" stopColor="#0B1838" />
          </linearGradient>
          <radialGradient id="hero-glow" cx=".72" cy="1" r=".55">
            <stop offset="0" stopColor="#E0262B" stopOpacity=".3" />
            <stop offset="1" stopColor="#E0262B" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d="M14 0H21V1H23V0H24V14H11V12H10V5H12V3H14Z" fill="url(#hero-night)" />
        <path d="M14 0H21V1H23V0H24V14H11V12H10V5H12V3H14Z" fill="url(#hero-glow)" />
        <g fill="#F6E8EA" opacity=".55">
          <rect x="14.2" y="1.3" width=".09" height=".16" />
          <rect x="16.6" y=".7" width=".07" height=".12" />
          <rect x="22.6" y="2.4" width=".09" height=".16" />
          <rect x="13.4" y="5.2" width=".07" height=".12" />
          <rect x="23.2" y="5.6" width=".07" height=".12" />
          <rect x="18.9" y="1.6" width=".06" height=".1" />
          <rect x="11.2" y="8.3" width=".07" height=".12" />
          <rect x="21.7" y="7.9" width=".06" height=".1" />
        </g>
        <rect x="11" y="1" width="1" height="1" fill="#F45B69" />
        <rect x="11" y="2" width="1" height="1" fill="#E0262B" />
        <rect x="12" y="2" width="1" height="1" fill="#E0262B" opacity=".75" />
      </svg>

      <Tower />

      <div className="hero-content">
        <div className="hero-top">
          <Link to="/" className="hero-mark" aria-label="Infinite Discovery home">
            <i>
              <InfinityIcon aria-hidden />
            </i>
            <span>
              Map your path
              <br />
              through MIT
            </span>
          </Link>
          <nav className="hero-pills" aria-label="Main">
            <div className="hero-navbar">
              <Link to="/fingerprints">Fingerprints</Link>
              <Link to="/community">Student output</Link>
              <Link to="/graph">Graph</Link>
            </div>
            <SignIn className="hero-signin" />
          </nav>
        </div>

        <ul className="hero-feed" aria-label="What students are asking">
          {FEED.map((q) => (
            <li key={q}>
              <Link to="/community" className="hero-feed-item">
                {q}
              </Link>
            </li>
          ))}
        </ul>

        <Headline />

        <div className="hero-lower">
          <p className="hero-eyebrow">Every subject is a block</p>
          <p className="hero-lead">
            Pick the classes you&apos;re curious about and{" "}
            <strong>watch four years fit together</strong>, from GIRs to the electives you
            didn&apos;t know you needed.
          </p>
          <form
            className="hero-ask"
            onSubmit={(e) => {
              e.preventDefault();
              void discover(q);
            }}
          >
            <Search aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="I want to make sense of the news"
              autoComplete="off"
              aria-label="What do you want to learn?"
            />
            <button type="submit">
              Start discovering
              <ArrowRight aria-hidden />
            </button>
          </form>
          <div className="hero-chips" aria-label="Popular starting points">
            {STARTERS.map((s) => (
              <button
                key={s.label}
                type="button"
                className="hero-chip"
                style={{ "--c": s.color } as React.CSSProperties}
                onClick={() => void discover(s.label)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
