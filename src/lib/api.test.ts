import { describe, expect, it } from "vitest";
import { planKey, toSearchResult } from "./api";

const result = (sources: string[]) => ({
  course_id: "6.3900",
  title: "Introduction to Machine Learning",
  department: "6",
  units: "4-0-8",
  units_total: 12,
  terms: ["Fall" as const],
  matched: sources.map((source_type, i) => ({ source_type, snippet: `${source_type} text ${i}` })),
});

describe("search results", () => {
  it("labels each kind of source once, in the order they matched", () => {
    expect(toSearchResult(result(["post", "catalog", "post", "fingerprint"])).matched).toEqual([
      "Student Reflection",
      "Catalog",
      "Fingerprint",
    ]);
  });
  it("prefers the catalog text as the snippet", () => {
    expect(toSearchResult(result(["post", "catalog"])).snippet).toBe("catalog text 1");
    expect(toSearchResult(result(["fingerprint"])).snippet).toBe("fingerprint text 0");
  });
  it("keeps catalog units and terms", () => {
    const { course } = toSearchResult(result(["catalog"]));
    expect(course.unitsTotal).toBe(12);
    expect(course.terms).toEqual(["Fall"]);
  });
});

describe("plan keys", () => {
  it("names a slot by year and season", () => expect(planKey(2, "IAP")).toBe("2-IAP"));
});
