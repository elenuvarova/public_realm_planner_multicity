function CoverageBar({ label, value, color }) {
  return (
    <div className="coverage-bar-row">
      <span className="coverage-label">{label}</span>
      <div className="coverage-bar-track">
        <div
          className="coverage-bar-fill"
          style={{ width: `${(value * 100).toFixed(1)}%`, background: color }}
        />
      </div>
      <span className="coverage-value">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

const ASSET_LABELS = {
  toilets:          "toilets",
  benches:          "benches",
  waste_bins:       "waste bins",
  drinking_water:   "drinking water points",
  fitness_stations: "fitness stations",
  bike_parking:     "bike parking",
  defibrillators:   "defibrillators",
  dog_areas:        "dog areas",
};

export default function ControlPanel({
  open = false,
  budget,
  maxBudget,
  onBudgetChange,
  coverageBefore,
  coverageAfter,
  scenario,
  layers,
  onLayersChange,
  onReportOpen,
  asset,
}) {
  const gain = coverageAfter - coverageBefore;
  const meta = scenario?.meta ?? {};
  const assetLabel = ASSET_LABELS[asset] ?? asset ?? "assets";

  const LAYER_DEFS = [
    { key: "coverage", label: "Coverage zones (500 m)",            color: "#3b82f6" },
    { key: "assets",   label: `Existing ${assetLabel}`,            color: "#3b82f6" },
    { key: "selected", label: "Recommendations",                    color: "#f97316" },
    { key: "pois",     label: "Demand POIs",                       color: "#8b5cf6" },
    { key: "units",    label: "Score grid (H3)",                   color: "#fdae61" },
  ];

  function toggle(key) {
    onLayersChange((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className={`control-panel ${open ? "control-panel--open" : ""}`} aria-label="Scenario controls">
      <section className="panel-section">
        <h3>Scenario</h3>
        <label className="slider-label">
          New {assetLabel}: <strong>{budget}</strong>
        </label>
        <input
          type="range"
          min={1}
          max={maxBudget}
          value={budget}
          onChange={(e) => onBudgetChange(Number(e.target.value))}
          className="slider"
          aria-label={`Number of new ${assetLabel} to place`}
        />
        <div className="slider-ends">
          <span>1</span>
          <span>{maxBudget}</span>
        </div>
      </section>

      <section className="panel-section">
        <h3>Coverage (500 m walk)</h3>
        <CoverageBar label="Before" value={coverageBefore} color="#3b82f6" />
        <div aria-live="polite" role="status">
          <CoverageBar label="After" value={coverageAfter} color="#22c55e" />
          {gain > 0.001 ? (
            <p className="gain-label">+{(gain * 100).toFixed(1)}% more demand covered</p>
          ) : (
            <p className="gain-label" style={{ color: "var(--c-text-muted)" }}>
              Already well covered — adding more has little effect at this budget.
            </p>
          )}
        </div>
      </section>

      <section className="panel-section">
        <h3>Data</h3>
        <ul className="stats-list">
          <li>
            <span>Existing {assetLabel}</span>
            <strong>{(meta.n_existing_assets ?? 0).toLocaleString?.() ?? "—"}</strong>
          </li>
          <li>
            <span>Analysis cells</span>
            <strong>{(meta.n_demand_cells ?? 0).toLocaleString?.() ?? "—"}</strong>
          </li>
          <li>
            <span>Candidate pool</span>
            <strong>{(meta.n_candidates_pool ?? 0).toLocaleString?.() ?? "—"}</strong>
          </li>
        </ul>
      </section>

      <section className="panel-section">
        <h3>Layers</h3>
        {LAYER_DEFS.map(({ key, label, color }) => (
          <label key={key} className="layer-toggle">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => toggle(key)}
            />
            <span className="layer-dot" style={{ background: color }} />
            {label}
          </label>
        ))}
      </section>

      <section className="panel-section note panel-section--footer">
        <p>
          Score = gap × equity (TES-adapted).
          <br />
          Greedy selection: ≥63% of optimal coverage.
        </p>
        <p className="source">
          Source: opendata · OpenStreetMap
        </p>
      </section>

      <section className="panel-section">
        <button className="report-cta" onClick={onReportOpen}>
          Generate Decision Report
        </button>
      </section>
    </aside>
  );
}
