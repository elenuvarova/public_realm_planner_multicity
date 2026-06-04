import { useState, useEffect, useMemo } from "react";
import MapView from "./components/MapView";
import ControlPanel from "./components/ControlPanel";
import ReportView from "./components/ReportView";
import CompareView from "./components/CompareView";
import Tour from "./components/Tour";
import { Loader, ErrorState } from "./components/Status";

const CITY_CONFIG = {
  paris:   { center: [48.8566,  2.3522], zoom: 12, label: "Paris"   },
  antwerp: { center: [51.2213,  4.4051], zoom: 12, label: "Antwerp" },
  london:  { center: [51.5074, -0.1278], zoom: 10, label: "London"  },
};

const ASSET_LABELS_SHORT = {
  toilets:          "Toilets",
  benches:          "Benches",
  waste_bins:       "Waste bins",
  drinking_water:   "Drinking water",
  fitness_stations: "Fitness",
  bike_parking:     "Bike parking",
  defibrillators:   "Defibrillators",
  dog_areas:        "Dog areas",
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
  const [reloadKey, setReloadKey] = useState(0);  // bump to re-fetch on retry
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    const { city, asset } = selection;
    const BASE = `/data/${city}/${asset}`;
    let cancelled = false;  // guard against out-of-order responses on fast switches

    const ok = (r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    };

    setCoreData(null);
    setUnits(null);
    setPois(null);
    setLoading(true);
    setError(null);

    // core files (fast: scenario ~1 MB, selected ~3 KB, assets ~20–240 KB)
    Promise.all([
      fetch(`${BASE}/scenario.json`).then(ok),
      fetch(`${BASE}/selected.geojson`).then(ok),
      fetch(`${BASE}/existing_assets.geojson`).then(ok),
    ])
      .then(([scenario, selected, assets]) => {
        if (cancelled) return;
        setCoreData({ scenario, selected, assets });
        setLoading(false);
      })
      .catch((e) => { if (!cancelled) { setError(e); setLoading(false); } });

    // heavy files — loaded in background (units may be 1–10 MB)
    fetch(`${BASE}/units.geojson`).then(ok).then((d) => !cancelled && setUnits(d)).catch(() => {});
    fetch(`${BASE}/demand_pois.geojson`).then(ok).then((d) => !cancelled && setPois(d)).catch(() => {});

    return () => { cancelled = true; };
  }, [selection.city, selection.asset, reloadKey]);

  // Layer toggles are a user preference — keep them across city/asset switches.
  // (Heavy layers start off via the initial state above; switching reloads the
  //  matching units/pois data for whatever layers are currently enabled.)

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

  // ── view mode ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState("map");  // "map" | "compare"

  // ── mobile control-panel drawer ────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { setPanelOpen(false); }, [selection.city, selection.asset, mode]);

  // ── tour ──────────────────────────────────────────────────────────────────
  const [showTour, setShowTour] = useState(() => !localStorage.getItem("tour_seen"));
  const handleTourDone = () => {
    localStorage.setItem("tour_seen", "1");
    setShowTour(false);
  };

  // ── render ────────────────────────────────────────────────────────────────
  const mapCfg = CITY_CONFIG[selection.city] ?? CITY_CONFIG.paris;

  const availableCities = useMemo(
    () => [...new Set(available.map((o) => o.city))],
    [available]
  );
  const availableAssets = useMemo(
    () => [...new Set(available.map((o) => o.asset))],
    [available]
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <h1>City Planner</h1>
          <div className="mode-toggle">
            <button
              className={`mode-btn ${mode === "map" ? "active" : ""}`}
              onClick={() => setMode("map")}
            >
              Map
            </button>
            <button
              className={`mode-btn ${mode === "compare" ? "active" : ""}`}
              onClick={() => setMode("compare")}
            >
              Compare
            </button>
          </div>
          <div className="header-actions">
            <button
              className="header-icon-btn"
              onClick={() => setShowTour(true)}
              title="Start tour"
              aria-label="Start product tour"
            >
              ?
            </button>
          </div>
        </div>

        {mode === "map" && (
          <div className="header-selectors">
            <label className="header-select-label">
              City
              <select
                className="header-select"
                value={selection.city}
                onChange={(e) => setSelection((s) => ({ ...s, city: e.target.value }))}
              >
                {availableCities.map((city) => (
                  <option key={city} value={city}>
                    {CITY_CONFIG[city]?.label ?? city}
                  </option>
                ))}
              </select>
            </label>
            <label className="header-select-label">
              Asset type
              <select
                className="header-select"
                value={selection.asset}
                onChange={(e) => setSelection((s) => ({ ...s, asset: e.target.value }))}
              >
                {availableAssets.map((asset) => (
                  <option key={asset} value={asset}>
                    {ASSET_LABELS_SHORT[asset] ?? asset}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </header>

      {mode === "compare" && (
        <CompareView initialAsset={selection.asset} />
      )}

      {mode === "map" && loading && (
        <Loader fill message={`Loading ${mapCfg.label}…`} />
      )}
      {mode === "map" && error && (
        <ErrorState
          fill
          title="Couldn’t load this dataset"
          message={`${mapCfg.label} · ${ASSET_LABELS_SHORT[selection.asset] ?? selection.asset}. ${error.message}`}
          onRetry={reload}
        />
      )}

      {mode === "map" && !loading && !error && coreData && (
        <div className="app-body">
          <ControlPanel
            open={panelOpen}
            budget={budget}
            maxBudget={maxBudget}
            onBudgetChange={setBudget}
            coverageBefore={coverageBefore}
            coverageAfter={coverageAfter}
            scenario={scenario}
            layers={layers}
            onLayersChange={setLayers}
            onReportOpen={() => setShowReport(true)}
            asset={selection.asset}
          />
          {panelOpen && (
            <button
              className="panel-backdrop"
              aria-label="Close panel"
              onClick={() => setPanelOpen(false)}
            />
          )}
          <MapView
            key={`${selection.city}-${selection.asset}`}
            center={mapCfg.center}
            zoom={mapCfg.zoom}
            units={units}
            assets={coreData.assets}
            selectedFeatures={selectedFiltered}
            pois={pois}
            layers={layers}
            asset={selection.asset}
          />
          <button
            className="panel-toggle"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
          >
            ☰ Scenario
          </button>
        </div>
      )}

      {showTour && <Tour onDone={handleTourDone} />}

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
