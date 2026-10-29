// The buildings in public/campus/dorms.png, left to right, as pixel ranges of the
// 1124 x 166 image; `top` is each roofline (first opaque row), where the hover label sits.
// The drawing is stylized, so only some buildings resemble their dorm (Baker House's
// curves on the far left, Simmons Hall's window grid); the rest are a best-guess
// assignment of MIT residence halls. Edit names here.
export const DORMS_IMAGE = { width: 1124, height: 166 };

export const DORMS: { name: string; from: number; to: number; top: number }[] = [
  { name: "Baker House", from: 0, to: 67, top: 62 },
  { name: "Burton Conner House", from: 68, to: 137, top: 67 },
  { name: "Random Hall", from: 137, to: 207, top: 90 },
  { name: "Next House", from: 207, to: 268, top: 65 },
  { name: "Maseeh Hall", from: 269, to: 331, top: 61 },
  { name: "McCormick Hall", from: 332, to: 389, top: 65 },
  { name: "East Campus", from: 389, to: 445, top: 80 },
  { name: "New House", from: 445, to: 525, top: 66 },
  { name: "New Vassar", from: 526, to: 574, top: 59 },
  { name: "Ashdown House", from: 574, to: 607, top: 79 },
  { name: "Simmons Hall", from: 607, to: 647, top: 67 },
  { name: "The Warehouse", from: 647, to: 680, top: 68 },
  { name: "Sidney-Pacific", from: 680, to: 727, top: 52 },
  { name: "Edgerton House", from: 727, to: 776, top: 66 },
  { name: "Graduate Tower at Site 4", from: 776, to: 819, top: 1 },
  { name: "Westgate", from: 819, to: 900, top: 62 },
  { name: "MacGregor House", from: 900, to: 967, top: 15 },
  { name: "Tang Hall", from: 968, to: 1024, top: 57 },
  { name: "70 Amherst Street", from: 1024, to: 1072, top: 71 },
  { name: "Graduate Junction", from: 1072, to: 1124, top: 75 },
];
