import { useState, useEffect, useMemo } from "react";
import MapView from "./components/MapView";
import ControlPanel from "./components/ControlPanel";
import ReportView from "./components/ReportView";

const CITY_CONFIG = {
  paris:   { center: [48.8566,  2.3522], zoom: 12 },
  antwerp: { center: [51.2213,  4.4051], zoom: 12 },
  london:  { center: [51.5074, -0.1278], zoom: 10 },
};

export default function App() {
  // ── available city/asset combos (loaded once from index.json) ──────────────
  const [available, setAvailable] = useState([]);
  const [selection, setSelection] = useState({ city: "paris", asset: "toilets" });

  useEffect(() => {
    fetch("/data/index.json")
      .then((r) => r.json())
      .then((d) => {
        const list = d.available ?? [];
        setAvailable(list);
        // default to Paris if present
        const paris = list.find((e) => e.city === "paris");
        if (paris) setSelection({ city: paris.city, asset: paris.asset });
        else if (list[0]) setSelection({ city: list[0].city, asset: list[0].asset });
      })
      .catch(() => {});
  }, []);

  // ── layer visibility ───────────────────────────────────────────────────────
  const [layers, setLayers] = useState({
    coverage: true,
    assets:   true,
    selected: true,
    pois:     false,
    units:    false,
  });

  // ── data ──────────────────────────────────────────────────────────────────
  const [coreData, setCoreData] = useState(null);  // scenario + selected + assets
  const [units, setUnits]       = useState(null);
  const [pois, setPois]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    const { city, asset } = selection;
    const BASE = `/data/${city}/${asset}`;

    setCoreData(null);
    setUnits(null);
    setPois(null);
    setLoading(true);
    setError(null);

    // core files (fast: scenario ~1 MB, selected ~3 KB, assets ~20–240 KB)
    Promise.all([
      fetch(`${BASE}/scenario.json`).then((r) => r.json()),
      fetch(`${BASE}/selected.geojson`).then((r) => r.json()),
      fetch(`${BASE}/existing_assets.geojson`).then((r) => r.json()),
    ])
      .then(([scenario, selected, assets]) => {
        setCoreData({ scenario, selected, assets });
        setLoading(false);
      })
      .catch((e) => { setError(e); setLoading(false); });

    // heavy files — loaded in background (units may be 1–10 MB)
    fetch(`${BASE}/units.geojson`).then((r) => r.json()).then(setUnits).catch(() => {});
    fetch(`${BASE}/demand_pois.geojson`).then((r) => r.json()).then(setPois).catch(() => {});
  }, [selection.city, selection.asset]);

  // reset layers when city changes (heavy layers default off)
  useEffect(() => {
    setLayers({ coverage: true, assets: true, selected: true, pois: false, units: false });
  }, [selection.city, selection.asset]);

  // ── slider ────────────────────────────────────────────────────────────────
  const maxBudget = coreData?.selected?.features?.length ?? 10;
  const [budget, setBudget] = useState(5);
  // clamp budget to maxBudget when city changes
  useEffect(() => { setBudget((b) => Math.min(b, maxBudget)); }, [maxBudget]);

  const selectedFiltered = useMemo(() => {
    if (!coreData?.selected?.features) return [];
    return coreData.selected.features.filter((f) => f.properties.rank <= budget);
  }, [coreData, budget]);

  // ── coverage stats ────────────────────────────────────────────────────────
  const scenario = coreData?.scenario ?? null;
  const steps = scenario?.coverage_steps ?? [];
  const coverageBefore = steps[0] ?? 0;
  const coverageAfter  = steps[budget] ?? coverageBefore;

  // ── report ────────────────────────────────────────────────────────────────
  const [showReport, setShowReport] = useState(false);

  // ── render ────────────────────────────────────────────────────────────────
  const mapCfg = CITY_CONFIG[selection.city] ?? CITY_CONFIG.paris;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Public Realm Planner</h1>
        <nav className="city-selector">
          {available.map((opt) => (
            <button
              key={`${opt.city}/${opt.asset}`}
              className={`city-btn ${
                selection.city === opt.city && selection.asset === opt.asset
                  ? "active"
                  : ""
              }`}
              onClick={() => setSelection({ city: opt.city, asset: opt.asset })}
            >
              {opt.label}
            </button>
          ))}
        </nav>
      </header>

      {loading && <div className="fullscreen-msg">Loading {selection.city}…</div>}
      {error && (
        <div className="fullscreen-msg error">Error: {error.message}</div>
      )}

      {!loading && !error && coreData && (
        <div className="app-body">
          <ControlPanel
            budget={budget}
            maxBudget={maxBudget}
            onBudgetChange={setBudget}
            coverageBefore={coverageBefore}
            coverageAfter={coverageAfter}
            scenario={scenario}
            layers={layers}
            onLayersChange={setLayers}
            onReportOpen={() => setShowReport(true)}
          />
          <MapView
            key={`${selection.city}-${selection.asset}`}
            center={mapCfg.center}
            zoom={mapCfg.zoom}
            units={units}
            assets={coreData.assets}
            selectedFeatures={selectedFiltered}
            pois={pois}
            layers={layers}
          />
        </div>
      )}

      {showReport && coreData && (
        <ReportView
          city={selection.city}
          asset={selection.asset}
          budget={budget}
          selectedFeatures={selectedFiltered}
          scenario={scenario}
          assets={coreData.assets}
          coverageBefore={coverageBefore}
          coverageAfter={coverageAfter}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
