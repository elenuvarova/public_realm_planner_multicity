const CITY_LABELS = {
  paris:   "Paris, France",
  antwerp: "Antwerpen, Belgium",
  london:  "London, United Kingdom",
};

const ASSET_LABELS = {
  toilets: "Public Toilets",
  benches: "Public Benches",
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
  const today    = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="report-overlay">
      {/* toolbar — hidden in print */}
      <div className="report-toolbar no-print">
        <button className="report-btn" onClick={() => window.print()}>
          Print / Save PDF
        </button>
        <button className="report-btn secondary" onClick={onClose}>
          Close
        </button>
      </div>

      {/* printable page */}
      <div className="report-page">
        {/* ── header ── */}
        <div className="r-header">
          <div>
            <h1 className="r-title">Public Realm Planner</h1>
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
              {selectedFeatures.map((f) => {
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
                <strong>GapScore</strong> — min-max normalised distance
                to nearest existing {asset} (0 = fully covered,
                1 = farthest point in city).
              </li>
              <li>
                <strong>EquityIndex</strong> — 0.1 + 0.9 × normalised
                demand-POI density within 800 m (parks, schools,
                transit stops, markets).
              </li>
            </ul>
            <p>
              Candidates: centroids of bottom 40% cells by Score,
              filtered ≥300 m from existing assets. Final selection:
              greedy maximisation of population-weighted demand coverage.
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
                  <td>City boundary</td>
                  <td>OSMnx / OpenStreetMap</td>
                  <td>
                    <span className="conf conf-high">High</span>
                  </td>
                </tr>
              </tbody>
            </table>

            <h2 style={{ marginTop: "1.2rem" }}>Limitations</h2>
            <ul className="r-list">
              <li>
                Distances are <strong>straight-line</strong>, not
                walking-network. Actual coverage is likely lower near
                barriers or sparse path networks.
              </li>
              <li>
                OSM may{" "}
                <strong>under-map facilities in peripheral areas</strong>,
                overstating gaps where volunteer coverage is thin.
              </li>
              <li>
                Equity proxied by demand POI density only; census
                deprivation indices not yet integrated (Phase 2).
              </li>
              <li>
                Scores are <strong>city-relative</strong> (min-max within
                city). Cross-city comparison requires unified
                normalisation.
              </li>
            </ul>
          </section>
        </div>

        <footer className="r-footer">
          Generated by Public Realm Planner · data under ODbL and CC BY 4.0 ·
          analysis code open source
        </footer>
      </div>
    </div>
  );
}
