/**
 * Single source of truth for the colors painted on the map, so the legend
 * swatches/dots and the actual Leaflet layers can never drift apart.
 */

// Colorblind-safe sequential ColorBrewer YlOrRd 5-class ramp.
// Higher TES Score = better served = paler yellow; lower = underserved = dark red.
export const SCORE_RAMP = ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];

export const MAP_COLORS = {
  recommended: "#f97316", // brand orange — recommended sites
  existing:    "#3b82f6", // blue — existing assets + coverage discs
  poi:         "#8b5cf6", // purple — demand POIs
  coverage:    "rgba(59, 130, 246, 0.18)", // faint blue — 500 m coverage swatch
};

/** Map a TES Score (0–100) to its ramp bucket color. */
export function scoreColor(score) {
  if (score >= 86) return SCORE_RAMP[0];
  if (score >= 79) return SCORE_RAMP[1];
  if (score >= 72) return SCORE_RAMP[2];
  if (score >= 65) return SCORE_RAMP[3];
  return SCORE_RAMP[4];
}
