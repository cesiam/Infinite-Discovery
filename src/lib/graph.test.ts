import { describe, expect, it } from "vitest";
import { prerequisiteDepth } from "./graph";

const hard = (source: string, target: string) => ({ source, target, type: "hard" as const });

describe("topological sort by prerequisite level", () => {
  it("puts every course one level right of its deepest prerequisite", () => {
    const depth = prerequisiteDepth([
      hard("6.100A", "6.1010"),
      hard("6.1010", "6.1210"),
      hard("6.1200", "6.1210"),
      hard("6.1210", "6.3900"),
      hard("18.06", "6.3900"),
    ]);
    expect(["6.100A", "6.1200", "18.06", "6.1010", "6.1210", "6.3900"].map(depth)).toEqual([
      0, 0, 0, 1, 2, 3,
    ]);
  });
  it("ignores similarity links and survives prerequisite loops", () => {
    const depth = prerequisiteDepth([
      hard("A", "B"),
      hard("B", "A"),
      hard("B", "C"),
      { source: "C", target: "D", type: "similar" },
    ]);
    expect(Number.isFinite(depth("C"))).toBe(true);
    expect(depth("C")).toBeGreaterThan(depth("B"));
    expect(depth("D")).toBe(0);
  });
});
