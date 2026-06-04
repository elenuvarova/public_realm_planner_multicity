import { useState, useEffect } from "react";
import { SkeletonCard } from "./Status";

const ASSET_LABELS = {
  toilets:          "Toilets",
  benches:          "Benches",
  waste_bins:       "Waste Bins",
  drinking_water:   "Drinking Water",
  fitness_stations: "Fitness Stations",
  bike_parking:     "Bike Parking",
  defibrillators:   "Defibrillators",
  dog_areas:        "Dog Areas",
};

const CITY_META = {
  paris:   { label: "Paris, France",          deprivation: "INSEE FILOSOFI 2019" },
  antwerp: { label: "Antwerpen, Belgium",      deprivation: "Statbel BIMD 2011"  },
  london:  { label: "London, United Kingdom",  deprivation: "ONS IMD 2019"        },
};

const CITIES = ["paris", "antwerp", "london"];
const H3_RES9_AREA_KM2 = 0.1054;  // average H3 resolution 9 cell area

function CoverageBar({ before, after }) {
  return (
    <div className="ccbar-wrap">
      <div className="ccbar-row">
        <span className="ccbar-rowlabel">Now</span>
        <div className="ccbar-track">
          <div className="ccbar-fill ccbar-fill--before" style={{ width: `${(before * 100).toFixed(1)}%` }} />
        </div>
        <span className="ccbar-pct">{(before * 100).toFixed(1)}%</span>
      </div>
      <div className="ccbar-row">
        <span className="ccbar-rowlabel">+10</span>
        <div className="ccbar-track">
          <div className="ccbar-fill ccbar-fill--after" style={{ width: `${(after * 100).toFixed(1)}%` }} />
        </div>
        <span className="ccbar-pct">{(after * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

export default function CompareView({ asset: assetProp, onAssetChange }) {
  const [localAsset, setLocalAsset] = useState(assetProp ?? "toilets");
  const asset = assetProp ?? localAsset;
  const setAsset = onAssetChange ?? setLocalAsset;
  const [reports, setReports] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;  // guard against out-of-order responses on fast switches
    setLoading(true);
    const next = {};
    Promise.all(
      CITIES.map((city) =>
        fetch(`/data/${city}/${asset}/report.json`)
          .then((r) => r.json())
          .then((d) => { next[city] = d; })
          .catch(() => { next[city] = null; })
      )
    ).then(() => {
      if (cancelled) return;
      setReports({ ...next });
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [asset]);

  return (
    <div className="compare-view">
      {/* asset selector */}
      <div className="compare-asset-tabs">
        {Object.entries(ASSET_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={`compare-asset-tab ${asset === key ? "active" : ""}`}
            aria-pressed={asset === key}
            onClick={() => setAsset(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="compare-body">
        <div className="compare-heading-row">
          <h2 className="compare-title">
            {ASSET_LABELS[asset]} — city comparison
          </h2>
          <span className="compare-radius-tag">500 m walk radius · budget = 10</span>
        </div>

        {/* normalisation banner */}
        <div className="compare-norm-banner">
          <span className="cnorm-icon">⚠</span>
          <div>
            <strong>Scores are city-local, not cross-city.</strong>{" "}
            Coverage = demand-weighted share of H3 cells within 500 m walking distance
            of an existing {ASSET_LABELS[asset].toLowerCase()}.
            Gap score and equity index are min-max normalised independently for each city —
            a 90% coverage in Paris and 90% in London mean the same local standard,
            but the underlying asset density (per km²) can differ dramatically.
            Use the <em>density</em> and <em>area</em> stats below for cross-city context.
          </div>
        </div>

        {loading ? (
          <div className="compare-cards">
            {CITIES.map((c) => <SkeletonCard key={c} />)}
          </div>
        ) : (
          <div className="compare-cards">
            {CITIES.map((city) => {
              const r = reports[city];
              const meta = CITY_META[city];

              if (!r) {
                return (
                  <div key={city} className="compare-card compare-card--missing">
                    <div className="ccard-city">{meta.label}</div>
                    <div className="ccard-na">No data for this asset type</div>
                  </div>
                );
              }

              const areakm2     = Math.round((r.n_grid_cells ?? 0) * H3_RES9_AREA_KM2);
              const densityRaw  = areakm2 ? (r.n_existing_assets / areakm2) * 10 : 0;
              const density     = densityRaw >= 10 ? Math.round(densityRaw) : densityRaw.toFixed(1);
              const gain        = ((r.coverage_after - r.coverage_before) * 100).toFixed(1);
              const hasGain     = r.coverage_after > r.coverage_before + 0.001;
              const coverageNow = (r.coverage_before * 100).toFixed(1);

              // coverage level bucket for card accent colour
              const coverageClass =
                r.coverage_before >= 0.8  ? "compare-card--high"
                : r.coverage_before >= 0.4 ? "compare-card--mid"
                : "compare-card--low";

              return (
                <div key={city} className={`compare-card ${coverageClass}`}>
                  <div className="ccard-city">{meta.label}</div>

                  <div className="ccard-hero">
                    <span className="ccard-big">{coverageNow}%</span>
                    <span className="ccard-hero-label">current coverage</span>
                  </div>

                  <CoverageBar before={r.coverage_before} after={r.coverage_after} />

                  {hasGain ? (
                    <div className="ccard-gain">+{gain}% with 10 new {ASSET_LABELS[asset].toLowerCase()}</div>
                  ) : (
                    <div className="ccard-gain ccard-gain--zero">No coverage gap at this budget</div>
                  )}

                  <div className="ccard-stats">
                    <div className="cstat">
                      <span className="cstat-val">{(r.n_existing_assets ?? 0).toLocaleString()}</span>
                      <span className="cstat-key">existing</span>
                    </div>
                    <div className="cstat">
                      <span className="cstat-val">{density}</span>
                      <span className="cstat-key">per 10 km²</span>
                    </div>
                    <div className="cstat">
                      <span className="cstat-val">{(r.n_grid_cells ?? 0).toLocaleString()}</span>
                      <span className="cstat-key">grid cells</span>
                    </div>
                    <div className="cstat">
                      <span className="cstat-val">~{areakm2.toLocaleString()} km²</span>
                      <span className="cstat-key">city area</span>
                    </div>
                  </div>

                  <div className="ccard-footer">
                    Deprivation: {meta.deprivation}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* methodology */}
        <div className="compare-method-note">
          <p>
            <strong>Score = 100 × (1 − GapScore × EquityIndex)</strong>.{" "}
            GapScore = multi-source Dijkstra walking distance to nearest asset,
            capped at 2× radius and normalised within each city.
            EquityIndex = 0.1 + 0.9 × mean(deprivation_score, demand_weight), both
            min-max normalised within each city.
            City area approximated from H3 resolution 9 cell count (≈ {H3_RES9_AREA_KM2} km²/cell).
          </p>
          <p>
            Optimiser: greedy set cover (≥63% of optimal, Nemhauser et al.).
            Data: OpenStreetMap · INSEE FILOSOFI 2019 · Statbel BIMD 2011 · ONS IMD 2019.
          </p>
        </div>
      </div>
    </div>
  );
}
