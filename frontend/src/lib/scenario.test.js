import { describe, it, expect } from "vitest";
import {
  selectByBudget,
  coverageAt,
  cityAreaKm2,
  assetDensityPer10Km2,
  H3_RES9_AREA_KM2,
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
