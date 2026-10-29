import { meetingsFor, planKey, type Meeting, type Season } from "@/lib/api";
import { seasonYear, usePlan } from "@/lib/plan";

const DAYS = ["M", "T", "W", "R", "F"] as const;
const DAY_NAMES: Record<string, string> = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri" };
const DAY_START = 8;
const DAY_END = 18;
const HOUR = 22; // px per hour

const hourLabel = (h: number) =>
  `${((Math.floor(h) + 11) % 12) + 1}${h % 1 ? ":30" : ""}${h < 12 ? "a" : "p"}`;

interface Block {
  courseId: string;
  meeting: Meeting;
  day: string;
}

/** The predicted week for one year: each term's courses laid out from last year's offering. */
export function YearSchedule({ id, year }: { id: string; year: number }) {
  const { plan, courses } = usePlan();

  return (
    <div id={id} className="mt-3 space-y-4 border-t border-foreground/15 pt-3">
      {(["Fall", "Spring"] as Season[]).map((season) => {
        const ids = plan.slots[planKey(year, season)] ?? [];
        return (
          <TermWeek
            key={season}
            season={season}
            year={seasonYear(year, season)}
            ids={ids}
            courses={courses}
          />
        );
      })}
      {(["IAP", "Summer"] as Season[]).map((season) => {
        const ids = plan.slots[planKey(year, season)] ?? [];
        if (!ids.length) return null;
        return (
          <p key={season} className="text-xs font-semibold text-muted-foreground">
            <span className="label-mono mr-2">
              {season} {seasonYear(year, season)}
            </span>
            {ids.join(", ")}: times vary, check the course page.
          </p>
        );
      })}
    </div>
  );
}

function TermWeek({
  season,
  year,
  ids,
  courses,
}: {
  season: Season;
  year: number;
  ids: string[];
  courses: ReturnType<typeof usePlan>["courses"];
}) {
  const notes: string[] = [];
  const blocks: Block[] = [];
  for (const courseId of ids) {
    const offered = courses[courseId]?.terms;
    if (offered && offered.length && !offered.includes(season))
      notes.push(`${courseId} isn't listed for ${season} in the current catalog.`);
    const meetings = meetingsFor(courseId, season);
    if (!meetings.length) notes.push(`${courseId}: no meeting times on record yet.`);
    for (const meeting of meetings)
      for (const day of meeting.days) blocks.push({ courseId, meeting, day });
  }
  const conflicts = new Set<string>();
  blocks.forEach((a, i) =>
    blocks.slice(i + 1).forEach((b) => {
      if (
        a.courseId !== b.courseId &&
        a.day === b.day &&
        a.meeting.start < b.meeting.end &&
        b.meeting.start < a.meeting.end
      ) {
        const pair = [a.courseId, b.courseId].sort().join(" and ");
        conflicts.add(
          `${pair} overlap on ${DAY_NAMES[a.day]} at ${hourLabel(Math.max(a.meeting.start, b.meeting.start))}.`,
        );
      }
    }),
  );

  return (
    <div>
      <p className="label-mono">
        {season} {year} · predicted from {year - 1}
      </p>
      {ids.length === 0 ? (
        <p className="mt-1 text-xs font-semibold text-muted-foreground">Nothing planned.</p>
      ) : (
        <>
          {blocks.length > 0 && (
            <div className="mt-2 grid grid-cols-[2.2rem_repeat(5,1fr)] gap-x-1 text-[10px] font-bold">
              <span />
              {DAYS.map((d) => (
                <span key={d} className="pb-1 text-center uppercase text-muted-foreground">
                  {DAY_NAMES[d]}
                </span>
              ))}
              <div className="relative" style={{ height: (DAY_END - DAY_START) * HOUR }}>
                {Array.from({ length: DAY_END - DAY_START }, (_, i) => (
                  <span
                    key={i}
                    className="absolute right-1 text-muted-foreground"
                    style={{ top: i * HOUR - 5 }}
                  >
                    {hourLabel(DAY_START + i)}
                  </span>
                ))}
              </div>
              {DAYS.map((day) => (
                <div
                  key={day}
                  className="relative rounded-md bg-card/50"
                  style={{ height: (DAY_END - DAY_START) * HOUR }}
                >
                  {blocks
                    .filter((b) => b.day === day)
                    .map((b, i) => (
                      <div
                        key={`${b.courseId}-${i}`}
                        title={`${b.courseId} ${b.meeting.kind} ${hourLabel(b.meeting.start)}–${hourLabel(b.meeting.end)}`}
                        className="absolute inset-x-0.5 overflow-hidden rounded bg-primary/85 px-1 leading-tight text-primary-foreground"
                        style={{
                          top: (b.meeting.start - DAY_START) * HOUR,
                          height: (b.meeting.end - b.meeting.start) * HOUR - 2,
                        }}
                      >
                        {b.courseId}
                        {(b.meeting.end - b.meeting.start) * HOUR >= 30 && (
                          <span className="block font-semibold opacity-80">{b.meeting.kind}</span>
                        )}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
          {[...conflicts, ...notes].length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] font-semibold">
              {[...conflicts].map((c) => (
                <li key={c} className="text-destructive">
                  {c}
                </li>
              ))}
              {notes.map((n) => (
                <li key={n} className="text-muted-foreground">
                  {n}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
