import { describe, it, expect } from "vitest";
import {
  selectByBudget,
  coverageAt,
  cityAreaKm2,
  assetDensityPer10Km2,
  H3_RES9_AREA_KM2,
  ringCentroid,
  underservedCentroids,
  haversineMeters,
  gapClosure,
} from "./scenario";
import { scoreColor, SCORE_RAMP } from "../mapColors";

const feats = (...ranks) => ranks.map((rank) => ({ properties: { rank } }));

describe("selectByBudget", () => {
  const features = feats(1, 2, 3, 4, 5);

  it("returns nothing at budget 0", () => {
    expect(selectByBudget(features, 0)).toHaveLength(0);
  });
  it("returns the single top rank at budget 1", () => {
    expect(selectByBudget(features, 1).map((f) => f.properties.rank)).toEqual([1]);
  });
  it("returns all at the max budget", () => {
    expect(selectByBudget(features, 5)).toHaveLength(5);
  });
  it("does not exceed the available features past max", () => {
    expect(selectByBudget(features, 99)).toHaveLength(5);
  });
  it("is safe on non-array / missing rank", () => {
    expect(selectByBudget(undefined, 3)).toEqual([]);
    expect(selectByBudget([{ properties: {} }], 3)).toEqual([]);
  });
});

describe("coverageAt", () => {
  const steps = [0.5, 0.6, 0.7, 0.8];

  it("returns the baseline at budget 0", () => {
    expect(coverageAt(steps, 0)).toBe(0.5);
  });
  it("indexes by budget", () => {
    expect(coverageAt(steps, 2)).toBe(0.7);
  });
  it("clamps past the last step", () => {
    expect(coverageAt(steps, 10)).toBe(0.8);
  });
  it("returns 0 on empty / invalid steps", () => {
    expect(coverageAt([], 3)).toBe(0);
    expect(coverageAt(undefined, 3)).toBe(0);
  });
});

describe("density helpers", () => {
  it("cityAreaKm2 rounds cells × cell-area", () => {
    expect(cityAreaKm2(1000)).toBe(Math.round(1000 * H3_RES9_AREA_KM2));
    expect(cityAreaKm2(0)).toBe(0);
    expect(cityAreaKm2(undefined)).toBe(0);
  });
  it("assetDensityPer10Km2 is 0 when area is unknown", () => {
    expect(assetDensityPer10Km2(100, 0)).toBe(0);
  });
  it("assetDensityPer10Km2 scales per 10 km²", () => {
    const area = cityAreaKm2(1000); // ~105 km²
    expect(assetDensityPer10Km2(210, 1000)).toBeCloseTo((210 / area) * 10, 5);
  });
});

describe("ringCentroid", () => {
  it("averages a square's corners to its center", () => {
    const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]; // closed
    expect(ringCentroid(ring)).toEqual([1, 1]);
  });
  it("handles an open ring", () => {
    expect(ringCentroid([[0, 0], [4, 0], [2, 3]])).toEqual([2, 1]);
  });
  it("is safe on empty input", () => {
    expect(ringCentroid([])).toBeNull();
    expect(ringCentroid(undefined)).toBeNull();
  });
});

describe("underservedCentroids", () => {
  const feature = (gap) => ({
    properties: { GapScore: gap },
    geometry: { coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
  });
  it("keeps only cells above the gap threshold", () => {
    const cells = underservedCentroids([feature(0.2), feature(0.8), feature(0.5)], 0.5);
    expect(cells).toHaveLength(1); // only 0.8 (> 0.5); 0.5 is not strictly greater
    expect(cells[0]).toEqual([1, 1]);
  });
  it("is safe on non-array", () => {
    expect(underservedCentroids(null)).toEqual([]);
  });
});

describe("haversineMeters", () => {
  it("is ~111 km per degree of latitude", () => {
    expect(haversineMeters([0, 0], [0, 1])).toBeCloseTo(111195, -2);
  });
  it("is zero for the same point", () => {
    expect(haversineMeters([2.35, 48.85], [2.35, 48.85])).toBe(0);
  });
});

describe("gapClosure", () => {
  // three underserved cells near Paris; a site on top of the first
  const cells = [[2.3500, 48.8500], [2.3600, 48.8500], [2.4000, 48.8500]];
  it("reaches only cells within the radius", () => {
    const r = gapClosure(cells, [[2.3500, 48.8500]], 300);
    expect(r.reached).toBe(1);
    expect(r.total).toBe(3);
    expect(r.pct).toBeCloseTo(1 / 3, 5);
  });
  it("a wider radius reaches the close pair", () => {
    // ~730 m between the first two cells at this latitude
    const r = gapClosure(cells, [[2.3500, 48.8500]], 800);
    expect(r.reached).toBe(2);
  });
  it("returns zero with no sites or no cells", () => {
    expect(gapClosure(cells, [], 500)).toEqual({ reached: 0, total: 3, pct: 0 });
    expect(gapClosure([], [[0, 0]], 500)).toEqual({ reached: 0, total: 0, pct: 0 });
  });
});

describe("scoreColor", () => {
  it("maps well-served (high score) to the palest ramp color", () => {
    expect(scoreColor(95)).toBe(SCORE_RAMP[0]);
    expect(scoreColor(86)).toBe(SCORE_RAMP[0]);
  });
  it("maps underserved (low score) to the darkest red", () => {
    expect(scoreColor(10)).toBe(SCORE_RAMP[4]);
    expect(scoreColor(64.9)).toBe(SCORE_RAMP[4]);
  });
  it("respects each bucket boundary", () => {
    expect(scoreColor(85)).toBe(SCORE_RAMP[1]);
    expect(scoreColor(78)).toBe(SCORE_RAMP[2]);
    expect(scoreColor(71)).toBe(SCORE_RAMP[3]);
  });
});
