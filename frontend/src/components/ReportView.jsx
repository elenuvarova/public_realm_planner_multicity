import { useEffect, useRef } from "react";

const CITY_LABELS = {
  paris:   "Paris, France",
  antwerp: "Antwerpen, Belgium",
  london:  "London, United Kingdom",
};

const CITY_DEPRIVATION = {
  paris:   "INSEE FILOSOFI 2019 (IRIS zones)",
  antwerp: "Statbel BIMD 2011 (statistical sectors)",
  london:  "ONS IMD 2019 (LSOA zones)",
};

const ASSET_LABELS = {
  toilets:          "Public Toilets",
  benches:          "Public Benches",
  waste_bins:       "Waste Bins",
  drinking_water:   "Drinking Water Points",
  fitness_stations: "Fitness Stations",
  bike_parking:     "Bike Parking",
  defibrillators:   "Defibrillators",
  dog_areas:        "Dog Areas",
};

const SOURCE_MAP = {
  "opendata.paris.fr":     { label: "opendata.paris.fr (ODbL)",     conf: "High" },
  "opendata.antwerpen.be": { label: "opendata.antwerpen.be (CC BY)", conf: "High" },
  "OpenStreetMap":         { label: "OpenStreetMap (ODbL)",          conf: "Moderate" },
};

function assetSource(assets) {
  const src = assets?.features?.[0]?.properties?.source ?? "";
  for (const [key, val] of Object.entries(SOURCE_MAP)) {
    if (src.includes(key)) return val;
  }
  return { label: "OpenStreetMap (ODbL)", conf: "Moderate" };
}

// selectedFeatures may arrive as a FeatureCollection or a plain feature array
function featureArray(selectedFeatures) {
  if (Array.isArray(selectedFeatures)) return selectedFeatures;
  return selectedFeatures?.features ?? [];
}

// trigger a client-side file download from a string blob
function downloadFile(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportGeoJSON(features, baseName) {
  const fc = { type: "FeatureCollection", features };
  downloadFile(
    `${baseName}.geojson`,
    "application/geo+json",
    JSON.stringify(fc, null, 2),
  );
}

function exportCSV(features, baseName) {
  const header = ["rank", "lat", "lng", "gap_score", "equity_index"];
  const rows = features.map((f) => {
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry.coordinates;
    return [
      p.rank ?? "",
      lat,
      lng,
      p.GapScore != null ? (p.GapScore * 100).toFixed(0) : "",
      p.EquityIndex != null ? p.EquityIndex.toFixed(3) : "",
    ].join(",");
  });
  const csv = [header.join(","), ...rows].join("\n");
  downloadFile(`${baseName}.csv`, "text/csv", csv);
}

export default function ReportView({
  city, asset, budget,
  selectedFeatures, scenario, assets,
  coverageBefore, coverageAfter,
  onClose,
}) {
  const meta     = scenario?.meta ?? {};
  const gain     = coverageAfter - coverageBefore;
  const src      = assetSource(assets);
  const cityLbl  = CITY_LABELS[city]  ?? city;
  const assetLbl = ASSET_LABELS[asset] ?? asset;
  const deprLbl  = CITY_DEPRIVATION[city] ?? "census deprivation index";
  const today    = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const features = featureArray(selectedFeatures);
  const baseName = `city-planner_${city}_${asset}_top${budget}`;

  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);

  // accessible modal: focus management, focus trap, restore on close, Escape
  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement;

    // move focus into the dialog on open
    (closeBtnRef.current ?? dialog)?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;

      const focusable = dialog.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeInDialog = dialog.contains(document.activeElement);

      if (e.shiftKey) {
        if (document.activeElement === first || !activeInDialog) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !activeInDialog) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // restore focus to the element focused before the dialog opened
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  return (
    <div
      className="report-overlay"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
    >
      {/* toolbar — hidden in print */}
      <div className="report-toolbar no-print">
        <button className="report-btn" onClick={() => window.print()}>
          Print / Save PDF
        </button>
        <button
          className="report-btn secondary"
          onClick={() => exportGeoJSON(features, baseName)}
        >
          Download GeoJSON
        </button>
        <button
          className="report-btn secondary"
          onClick={() => exportCSV(features, baseName)}
        >
          Download CSV
        </button>
        <button
          className="report-btn secondary"
          onClick={onClose}
          ref={closeBtnRef}
        >
          Close
        </button>
      </div>

      {/* printable page */}
      <div className="report-page">
        {/* ── header ── */}
        <div className="r-header">
          <div>
            <h1 id="report-title" className="r-title">City <span>Planner</span></h1>
            <p className="r-subtitle">
              Decision Brief · {cityLbl} · {assetLbl}
            </p>
          </div>
          <div className="r-date">{today}</div>
        </div>

        {/* ── situation ── */}
        <section className="r-section">
          <h2>Situation</h2>
          <p>
            <strong>{meta.n_existing_assets}</strong>{" "}
            {assetLbl.toLowerCase()} currently serve {cityLbl}.
            At a 500 m walking threshold,{" "}
            <strong>{(coverageBefore * 100).toFixed(1)}%</strong> of
            demand (parks, schools, transit stops within 800 m) is
            within reach of an existing facility.
            <strong> {(meta.n_demand_cells ?? "—")}</strong> analysis
            cells cover the city at H3 resolution 9 (≈200 m edge,
            ≈0.1 km²).
          </p>
        </section>

        {/* ── recommendation ── */}
        <section className="r-section r-highlight">
          <h2>Recommendation</h2>
          <p>
            Place <strong>{budget}</strong> new{" "}
            {assetLbl.toLowerCase()} at the locations below. Expected
            outcome: coverage increases from{" "}
            <strong>{(coverageBefore * 100).toFixed(1)}%</strong> to{" "}
            <strong>{(coverageAfter * 100).toFixed(1)}%</strong>{" "}
            <span className="r-gain">
              (+{(gain * 100).toFixed(1)} pp)
            </span>
            . Selection uses a greedy max-coverage algorithm with a
            ≥63% optimality guarantee (Nemhauser et al., 1978).
          </p>
        </section>

        {/* ── locations table ── */}
        <section className="r-section">
          <h2>Proposed Locations</h2>
          <table className="r-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Coordinates</th>
                <th>Gap score</th>
                <th>Equity index</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => {
                const p = f.properties;
                const [lng, lat] = f.geometry.coordinates;
                return (
                  <tr key={p.rank}>
                    <td className="r-rank">{p.rank}</td>
                    <td className="r-coords">
                      {Math.abs(lat).toFixed(4)}°{lat >= 0 ? "N" : "S"},{" "}
                      {Math.abs(lng).toFixed(4)}°{lng >= 0 ? "E" : "W"}
                    </td>
                    <td>{(p.GapScore * 100).toFixed(0)}%</td>
                    <td>{p.EquityIndex?.toFixed(3) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="r-two-col">
          {/* ── methodology ── */}
          <section className="r-section">
            <h2>Methodology</h2>
            <p>
              Composite score per analysis cell:
            </p>
            <pre className="r-formula">
              Score = 100 × (1 − GapScore × EquityIndex)
            </pre>
            <ul className="r-list">
              <li>
                <strong>GapScore</strong> — walking-network distance
                (OSMnx + multi-source Dijkstra) from each cell to the
                nearest existing {assetLbl.toLowerCase()}, capped at 2× the
                500 m radius and min-max normalised within the city
                (0 = fully covered, 1 = farthest reachable point).
              </li>
              <li>
                <strong>EquityIndex</strong> — 0.1 + 0.9 × mean of two
                min-max-normalised indicators: census deprivation
                ({deprLbl}) and demand-POI density within 800 m
                (parks, schools, transit stops, markets).
              </li>
            </ul>
            <p>
              Candidates: centroids of bottom 40% cells by Score,
              filtered ≥300 m from existing assets. Final selection:
              greedy maximisation of demand-weighted coverage
              (≥63% of optimal, Nemhauser et al. 1978).
            </p>
          </section>

          {/* ── data sources ── */}
          <section className="r-section">
            <h2>Data Sources</h2>
            <table className="r-table">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Source</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{assetLbl}</td>
                  <td>{src.label}</td>
                  <td>
                    <span className={`conf conf-${src.conf.toLowerCase()}`}>
                      {src.conf}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Demand POIs</td>
                  <td>OpenStreetMap (ODbL)</td>
                  <td>
                    <span className="conf conf-moderate">Moderate</span>
                  </td>
                </tr>
                <tr>
                  <td>Deprivation</td>
                  <td>{deprLbl}</td>
                  <td>
                    <span className="conf conf-high">High</span>
                  </td>
                </tr>
                <tr>
                  <td>Walk network</td>
                  <td>OSMnx / OpenStreetMap</td>
                  <td>
                    <span className="conf conf-high">High</span>
                  </td>
                </tr>
              </tbody>
            </table>

            <h2>Limitations</h2>
            <ul className="r-list">
              <li>
                Walking distance snaps cells and assets to the nearest
                OSM graph node, so very short trips carry a{" "}
                <strong>±50–100 m approximation</strong>; unmapped paths
                or private cut-throughs are not counted.
              </li>
              <li>
                OSM may{" "}
                <strong>under-map facilities in peripheral areas</strong>,
                overstating gaps where volunteer coverage is thin.
              </li>
              <li>
                Deprivation vintages differ by city ({deprLbl}); the{" "}
                <strong>Antwerp BIMD (2011)</strong> in particular predates
                the other indices and may understate recent change.
              </li>
              <li>
                Scores are <strong>city-relative</strong> (min-max within
                city). Cross-city comparison requires unified
                normalisation — see the Compare view’s density metrics.
              </li>
            </ul>
          </section>
        </div>

        <footer className="r-footer">
          Generated by City Planner · data under ODbL and CC BY 4.0 ·
          analysis code open source
        </footer>
      </div>
    </div>
  );
}
