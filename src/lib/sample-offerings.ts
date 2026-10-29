// Sample meeting times for the predicted-schedule view. The catalog API has no meeting
// times; replace this with registrar data when there is a source for it. Only api.ts imports it.
export type Weekday = "M" | "T" | "W" | "R" | "F";
export interface Meeting {
  kind: "Lecture" | "Recitation" | "Lab";
  days: Weekday[];
  start: number;
  end: number;
}

const lecture = (days: Weekday[], start: number, end: number): Meeting => ({
  kind: "Lecture",
  days,
  start,
  end,
});
const recitation = (days: Weekday[], start: number, end: number): Meeting => ({
  kind: "Recitation",
  days,
  start,
  end,
});
const lab = (days: Weekday[], start: number, end: number): Meeting => ({
  kind: "Lab",
  days,
  start,
  end,
});

export const SAMPLE_MEETINGS: Record<
  string,
  Partial<Record<"Fall" | "IAP" | "Spring" | "Summer", Meeting[]>>
> = {
  "18.01": {
    Fall: [lecture(["M", "W", "F"], 13, 14), recitation(["T", "R"], 10, 11)],
    Spring: [lecture(["M", "W", "F"], 10, 11), recitation(["T", "R"], 13, 14)],
  },
  "18.02": {
    Fall: [lecture(["M", "W", "F"], 10, 11), recitation(["T", "R"], 11, 12)],
    Spring: [lecture(["M", "W", "F"], 11, 12), recitation(["T", "R"], 10, 11)],
  },
  "18.03": {
    Fall: [lecture(["M", "W", "F"], 13, 14)],
    Spring: [lecture(["M", "W", "F"], 13, 14), recitation(["T", "R"], 12, 13)],
  },
  "18.06": {
    Fall: [lecture(["M", "W", "F"], 11, 12), recitation(["T"], 14, 15)],
    Spring: [lecture(["M", "W", "F"], 11, 12), recitation(["R"], 14, 15)],
  },
  "8.01": {
    Fall: [lecture(["M", "W", "F"], 9, 11)],
    Spring: [lecture(["T", "R"], 9, 11), recitation(["F"], 9, 10)],
  },
  "8.02": {
    Fall: [lecture(["T", "R"], 9, 11), recitation(["F"], 9, 10)],
    Spring: [lecture(["M", "W", "F"], 9, 11)],
  },
  "5.111": {
    Fall: [lecture(["M", "W", "F"], 11, 12), recitation(["T", "R"], 13, 14)],
    Spring: [lecture(["M", "W", "F"], 11, 12), recitation(["T", "R"], 15, 16)],
  },
  "6.100A": {
    Fall: [lecture(["M", "W"], 14.5, 16), recitation(["F"], 11, 12)],
    Spring: [lecture(["T", "R"], 14.5, 16)],
  },
  "6.1200": {
    Fall: [lecture(["T", "R"], 11, 12.5), recitation(["W", "F"], 13, 14)],
    Spring: [lecture(["T", "R"], 14.5, 16), recitation(["W", "F"], 11, 12)],
  },
  "6.1210": {
    Fall: [lecture(["T", "R"], 11, 12.5), recitation(["W", "F"], 10, 11)],
    Spring: [lecture(["T", "R"], 11, 12.5), recitation(["W", "F"], 10, 11)],
  },
  "6.1010": {
    Fall: [lecture(["M"], 15, 16), lab(["W"], 14, 17)],
    Spring: [lecture(["M"], 15, 16), lab(["W"], 14, 17)],
  },
  "6.1910": {
    Fall: [lecture(["T", "R"], 14, 15.5), recitation(["W"], 10, 11)],
    Spring: [lecture(["T", "R"], 14, 15.5), recitation(["W"], 10, 11)],
  },
  "6.3900": {
    Fall: [lecture(["M"], 9.5, 11), lab(["W"], 9.5, 11)],
    Spring: [lecture(["M"], 9.5, 11), lab(["T"], 13, 14.5)],
  },
  "2.001": {
    Fall: [lecture(["M", "W"], 14, 15.5), recitation(["F"], 14, 15)],
    Spring: [lecture(["T", "R"], 9.5, 11), recitation(["F"], 10, 11)],
  },
  "14.01": {
    Fall: [lecture(["M", "W"], 11, 12.5), recitation(["F"], 11, 12)],
    Spring: [lecture(["T", "R"], 11, 12.5), recitation(["F"], 12, 13)],
  },
  "21M.301": {
    Fall: [lecture(["M", "W"], 13, 14.5), lab(["F"], 13, 14)],
    Spring: [lecture(["T", "R"], 13, 14.5)],
  },
  "24.900": { Fall: [lecture(["M", "W"], 11, 12.5)], Spring: [lecture(["T", "R"], 14, 15.5)] },
};
