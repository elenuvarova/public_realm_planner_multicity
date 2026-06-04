import { Spinner } from "./Status";
import { MAP_COLORS, SCORE_RAMP } from "../mapColors";

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
  dataReady = {},
  planMode = false,
  onTogglePlan,
  gridReady = false,
  gapEstimate = { reached: 0, total: 0, pct: 0 },
  userSiteCount = 0,
  onClearSites,
}) {
  const gain = coverageAfter - coverageBefore;
  const meta = scenario?.meta ?? {};
  const assetLabel = ASSET_LABELS[asset] ?? asset ?? "assets";

  const LAYER_DEFS = [
    { key: "coverage", label: "Coverage zones (500 m)",  color: MAP_COLORS.existing },
    { key: "assets",   label: `Existing ${assetLabel}`,  color: MAP_COLORS.existing },
    { key: "selected", label: "Recommendations",          color: MAP_COLORS.recommended },
    { key: "pois",     label: "Demand POIs",             color: MAP_COLORS.poi },
    { key: "units",    label: "Score grid (H3)",         color: SCORE_RAMP[2] },
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
        <CoverageBar label="Before" value={coverageBefore} color={MAP_COLORS.existing} />
        <div aria-live="polite" role="status">
          <CoverageBar label="After" value={coverageAfter} color="var(--c-success)" />
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
        {LAYER_DEFS.map(({ key, label, color }) => {
          // heavy layers (units/pois) load in the background — show a spinner
          // while the layer is enabled but its data hasn't arrived yet
          const isHeavy = key === "units" || key === "pois";
          const loading = isHeavy && layers[key] && !dataReady[key];
          return (
            <label key={key} className="layer-toggle">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => toggle(key)}
              />
              {loading ? (
                <Spinner size={12} />
              ) : (
                <span className="layer-dot" style={{ background: color }} />
              )}
              {label}
            </label>
          );
        })}
      </section>

      <section className="panel-section">
        <h3>What-if planner</h3>
        <button
          className={`plan-btn ${planMode ? "plan-btn--active" : ""}`}
          onClick={onTogglePlan}
          disabled={!gridReady}
          aria-pressed={planMode}
        >
          {planMode ? "✓ Done placing" : "✎ Place your own sites"}
        </button>

        {!gridReady ? (
          <p className="plan-hint">Loading the score grid…</p>
        ) : planMode ? (
          <p className="plan-hint">Click the map to drop a candidate · click a pin to remove it.</p>
        ) : null}

        <div className="plan-readout" aria-live="polite">
          <span className="plan-pct">{(gapEstimate.pct * 100).toFixed(0)}%</span>
          <span className="plan-pct-label">of the service gap within reach</span>
        </div>
        <p className="plan-sub">
          {gapEstimate.reached.toLocaleString()} of {gapEstimate.total.toLocaleString()} underserved
          cells · {userSiteCount} of your sites
        </p>
        {userSiteCount > 0 && (
          <button className="plan-clear" onClick={onClearSites}>Clear my sites</button>
        )}
        <p className="plan-caveat">
          Straight-line estimate — approximates walking reach. The headline coverage above uses the
          full walking network.
        </p>
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
