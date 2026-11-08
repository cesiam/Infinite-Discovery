import { describe, expect, it } from "vitest";
import { girTags, seasonOf, termCode, tone } from "./blocks";
import { planTermOf } from "./plan";

describe("course blocks", () => {
  it("colors classes by area", () => {
    expect(tone("6.1210")).toBe("red");
    expect(tone("18.06")).toBe("mint");
    expect(tone("8.02")).toBe("sky");
    expect(tone("21M.030")).toBe("wisteria");
    expect(tone("2.001")).toBe("vanilla");
  });
  it("reads GIR tags from the units line", () => {
    expect(girTags("5-0-7 CALC I")).toEqual(["Calc I"]);
    expect(girTags("5-0-7 CALC II")).toEqual(["Calc II"]);
    expect(girTags("3-0-9 HASS-A; CI-H")).toEqual(["HASS-A", "CI-H"]);
    expect(girTags("5-0-7 REST")).toEqual(["REST"]);
    expect(girTags("3-0-9")).toEqual([]);
  });
  it("names terms the short way", () => {
    expect(termCode("Fall", 2026)).toBe("F26");
    expect(termCode("IAP", 2027)).toBe("IAP27");
    expect(termCode("Summer", 2027)).toBe("U27");
  });
  it("places dates in a season and plan year", () => {
    expect(seasonOf(new Date(2026, 10, 8))).toEqual({ season: "Fall", calendarYear: 2026 });
    expect(seasonOf(new Date(2027, 0, 10)).season).toBe("IAP");
    expect(seasonOf(new Date(2027, 3, 1)).season).toBe("Spring");
    expect(planTermOf(new Date(2026, 10, 8))).toEqual({ year: 1, season: "Fall" });
    expect(planTermOf(new Date(2027, 3, 1))).toEqual({ year: 1, season: "Spring" });
    expect(planTermOf(new Date(2027, 9, 1))).toEqual({ year: 2, season: "Fall" });
  });
});
