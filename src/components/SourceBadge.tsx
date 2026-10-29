import type { Source } from "@/lib/api";

const STYLES: Record<Source, string> = {
  Catalog: "bg-dust text-foreground",
  Fingerprint: "bg-cyan text-accent-foreground border border-accent-foreground/20",
  "Student Reflection": "bg-primary text-primary-foreground",
};

export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${STYLES[source]}`}>{source}</span>
  );
}
