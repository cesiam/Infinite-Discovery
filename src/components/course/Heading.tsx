import type { ReactNode } from "react";

export function Heading({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="label-mono">{n}</p>
        <h2 className="mt-1 font-display text-2xl font-black tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
