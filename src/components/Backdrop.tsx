import { useAppearance } from "@/lib/appearance";
import { DORMS, DORMS_IMAGE } from "@/lib/dorms";

// Campus images live in public/campus/ (downloaded from the Lovable project's assets).
const IMG = {
  green: "/campus/green-building.png",
  kresge: "/campus/kresge.png",
  dome: "/campus/great-dome.png",
  dorms: "/campus/dorms.png",
  domeLine: "/campus/dome-line.png",
};

/** The campus visual behind the app. `interactive` (the opening screen) adds hover labels
 * to the dorms; elsewhere the workspace frame covers it. */
export function Backdrop({ interactive = false }: { interactive?: boolean }) {
  const { background } = useAppearance();
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-app-gradient"
      >
        {background === "floating" && (
          <>
            <img
              src={IMG.green}
              alt=""
              className="float-a absolute right-[4%] bottom-[6%] w-[11vw] min-w-28 opacity-90"
            />
            <img
              src={IMG.kresge}
              alt=""
              className="float-b absolute bottom-[8%] left-[4%] w-[26vw] min-w-56 opacity-85"
            />
            <img
              src={IMG.dome}
              alt=""
              className="float-c absolute right-[30%] bottom-[4%] w-[18vw] min-w-40 opacity-60"
            />
          </>
        )}

        {background === "dome" && (
          <>
            {/* on the opening screen the dorm row is drawn as hoverable slices instead */}
            {!interactive && (
              <img
                src={IMG.dorms}
                alt=""
                className="absolute bottom-0 left-0 w-[58vw] min-w-[520px] opacity-90"
              />
            )}
            <img
              src={IMG.dome}
              alt=""
              className="absolute bottom-0 right-[-2vw] w-[40vw] min-w-[340px]"
            />
          </>
        )}

        {background === "blueprint" && (
          <>
            <div className="absolute inset-0 bg-blueprint-grid" />
            <img
              src={IMG.domeLine}
              alt=""
              className="absolute bottom-[-4vh] left-1/2 w-[80vw] max-w-[1200px] -translate-x-1/2 opacity-[0.14]"
            />
          </>
        )}
      </div>
      {interactive && background === "dome" && <DormLabels />}
    </>
  );
}

/** The dorm row as one slice per building, in the same place and size as the image
 * (bottom-left, 58vw wide, at least 520px). Hovering a building lifts it and shows its
 * name. Above the page content so it can be hovered; only the slices take the pointer. */
function DormLabels() {
  const { width, height } = DORMS_IMAGE;
  // slices meet edge to edge, so the row looks exactly like the image at rest
  const slices = DORMS.map((d, i) => ({ ...d, to: DORMS[i + 1]?.from ?? width }));
  return (
    <div
      aria-label="Campus dorms"
      className="pointer-events-none fixed inset-0 z-[5] overflow-hidden"
    >
      <div
        className="absolute bottom-0 left-0 w-[58vw] min-w-[520px]"
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {slices.map((d, i) => {
          const span = d.to - d.from;
          return (
            <div
              key={d.name}
              tabIndex={0}
              aria-label={d.name}
              data-dorm={d.name}
              className="group pointer-events-auto absolute bottom-0 top-0 opacity-90 outline-none transition-[transform,filter] duration-200 ease-out hover:-translate-y-1.5 hover:drop-shadow-[0_6px_6px_rgba(31,26,23,0.25)] focus-visible:-translate-y-1.5"
              style={{
                left: `${(d.from / width) * 100}%`,
                width: `${(span / width) * 100}%`,
                backgroundImage: `url(${IMG.dorms})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${(width / span) * 100}% 100%`,
                backgroundPosition: `${(d.from / (width - span)) * 100}% 0`,
              }}
            >
              <span
                className={`pointer-events-none absolute mb-1 whitespace-nowrap text-xs font-extrabold text-foreground opacity-0 transition-opacity [text-shadow:0_0_4px_rgba(255,255,255,0.95),0_0_2px_rgba(255,255,255,0.95)] group-hover:opacity-100 group-focus-visible:opacity-100 ${
                  // the first building sits on the screen edge, so its label starts at the left
                  i === 0 ? "left-0" : "left-1/2 -translate-x-1/2"
                }`}
                // just above this building's own roof, not the top of the whole row
                style={{ bottom: `${(1 - d.top / height) * 100}%` }}
              >
                {d.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
