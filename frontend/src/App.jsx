import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import MapView from "./components/MapView";
import ControlPanel from "./components/ControlPanel";
import { Loader, ErrorState, EmptyState } from "./components/Status";
import { IconHelp, IconMenu } from "./components/Icons";
import { selectByBudget, coverageAt, underservedCentroids, gapClosure, REACH_M } from "./lib/scenario";

// Conditional-only views — code-split so they stay out of the initial bundle.
const ReportView  = lazy(() => import("./components/ReportView"));
const CompareView = lazy(() => import("./components/CompareView"));
const Tour        = lazy(() => import("./components/Tour"));

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

// ── storage helpers ──────────────────────────────────────────────────────────
// localStorage throws in Safari Private Mode / restricted contexts; never let
// that white-screen the app.
function safeLocalGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeLocalSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — ignore */
  }
}

// ── URL state ────────────────────────────────────────────────────────────────
// Read once on mount. Values are validated against available data later (and
// against the small fixed sets here) before they override the default.
function readUrlState() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return {};
  }
  const out = {};
  const city = params.get("city");
  const asset = params.get("asset");
  const n = params.get("n");
  const view = params.get("view");
  if (city) out.city = city;
  if (asset) out.asset = asset;
  if (n !== null && /^\d+$/.test(n)) out.n = parseInt(n, 10);
  if (view === "map" || view === "compare") out.view = view;
  return out;
}

const URL_INIT = readUrlState();

export default function App() {
  // ── available city/asset combos (loaded once from index.json) ──────────────
  const [available, setAvailable] = useState([]);
  const [indexError, setIndexError] = useState(false);
  const [selection, setSelection] = useState({
    city:  URL_INIT.city  ?? "paris",
    asset: URL_INIT.asset ?? "toilets",
  });
  // True while the current selection came from the URL and has not yet been
  // validated against index.json — keeps the index effect from clobbering it.
  const urlSelectionPending = useRef(URL_INIT.city != null || URL_INIT.asset != null);

  useEffect(() => {
    fetch("/data/index.json")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((d) => {
        const list = d.available ?? [];
        setAvailable(list);

        // If the URL gave us a selection, only accept it if it exists in the
        // data; otherwise fall back to the default selection logic.
        const urlCombo =
          URL_INIT.city && URL_INIT.asset
            ? list.find((e) => e.city === URL_INIT.city && e.asset === URL_INIT.asset)
            : null;

        if (urlSelectionPending.current && urlCombo) {
          urlSelectionPending.current = false;
          return; // keep the URL-provided selection as-is
        }
        urlSelectionPending.current = false;

        // No valid URL selection — default to Paris if present, else first entry.
        const paris = list.find((e) => e.city === "paris");
        if (paris) setSelection({ city: paris.city, asset: paris.asset });
        else if (list[0]) setSelection({ city: list[0].city, asset: list[0].asset });
      })
      .catch((e) => {
        // Was silently swallowed; a fatal failure here leaves empty dropdowns and
        // a stuck UI. Surface it non-blockingly so it's diagnosable.
        console.warn("Failed to load /data/index.json:", e);
        setIndexError(true);
        urlSelectionPending.current = false;
      });
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

    // heavy files — loaded in background (units may be 1–10 MB). Non-fatal, but
    // log so silent 404s are diagnosable.
    fetch(`${BASE}/units.geojson`).then(ok)
      .then((d) => !cancelled && setUnits(d))
      .catch((e) => console.warn(`units.geojson unavailable for ${city}/${asset}:`, e));
    fetch(`${BASE}/demand_pois.geojson`).then(ok)
      .then((d) => !cancelled && setPois(d))
      .catch((e) => console.warn(`demand_pois.geojson unavailable for ${city}/${asset}:`, e));

    return () => { cancelled = true; };
  }, [selection.city, selection.asset, reloadKey]);

  // Layer toggles are a user preference — keep them across city/asset switches.
  // (Heavy layers start off via the initial state above; switching reloads the
  //  matching units/pois data for whatever layers are currently enabled.)

  // ── slider ────────────────────────────────────────────────────────────────
  // Derive maxBudget defensively: the slider/coverage indexing must never run
  // past the recommendation count or the coverage_steps array, even if a future
  // dataset ships != 10 recommendations.
  const recCount = coreData?.selected?.features?.length ?? 10;
  const stepCount = coreData?.scenario?.coverage_steps?.length ?? 11;
  const maxBudget = Math.max(0, Math.min(recCount, stepCount - 1));
  const [budget, setBudget] = useState(URL_INIT.n ?? 5);
  // clamp budget to maxBudget when city changes
  useEffect(() => { setBudget((b) => Math.min(b, maxBudget)); }, [maxBudget]);

  const selectedFiltered = useMemo(
    () => selectByBudget(coreData?.selected?.features, budget),
    [coreData, budget]
  );

  // ── coverage stats ────────────────────────────────────────────────────────
  const scenario = coreData?.scenario ?? null;
  const steps = scenario?.coverage_steps ?? [];
  const coverageBefore = coverageAt(steps, 0);
  const coverageAfter  = coverageAt(steps, budget);

  // ── report ────────────────────────────────────────────────────────────────
  const [showReport, setShowReport] = useState(false);

  // ── view mode ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState(URL_INIT.view ?? "map");  // "map" | "compare"

  // ── URL write-back ─────────────────────────────────────────────────────────
  // Mirror city/asset/budget/mode into the query string (no navigation, no new
  // history entries) so the current view is shareable / reloadable.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("city", selection.city);
      params.set("asset", selection.asset);
      params.set("n", String(budget));
      params.set("view", mode);
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    } catch {
      /* history/URL unavailable — non-fatal */
    }
  }, [selection.city, selection.asset, budget, mode]);

  // ── mobile control-panel drawer ────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { setPanelOpen(false); }, [selection.city, selection.asset, mode]);

  // ── what-if planner ─────────────────────────────────────────────────────────
  // Drop extra candidate sites and see how much more of the service gap they'd
  // close (straight-line estimate; see lib/scenario.js for the honesty caveats).
  const [planMode, setPlanMode] = useState(false);
  const [userSites, setUserSites] = useState([]); // [{ id, lng, lat }]
  const siteId = useRef(0);
  const mapRef = useRef(null); // Leaflet map instance (for the keyboard "add at center" path)
  useEffect(() => { setUserSites([]); setPlanMode(false); }, [selection.city, selection.asset]);

  const addUserSite = (lng, lat) =>
    setUserSites((s) => [...s, { id: ++siteId.current, lng, lat }]);
  const removeUserSite = (id) => setUserSites((s) => s.filter((p) => p.id !== id));
  // keyboard-operable alternative to clicking the map: drop a site at the current
  // map center (the map is arrow-key pannable when focused)
  const addSiteAtCenter = () => {
    const m = mapRef.current;
    if (m) { const c = m.getCenter(); addUserSite(c.lng, c.lat); }
  };

  const underserved = useMemo(
    () => underservedCentroids(units?.features),
    [units]
  );
  const gapEstimate = useMemo(() => {
    const recs = selectedFiltered.map((f) => f.geometry.coordinates);
    const mine = userSites.map((p) => [p.lng, p.lat]);
    const base = gapClosure(underserved, recs, REACH_M);          // recommendations only
    const all = gapClosure(underserved, [...recs, ...mine], REACH_M); // + your sites
    return {
      total: all.total,
      pct: all.pct,                                  // overall high-need cells within reach
      recommendedPct: base.pct,                      // closed by the recommendations alone
      yoursAddsPct: all.total ? (all.reached - base.reached) / all.total : 0, // marginal from your sites
    };
  }, [underserved, selectedFiltered, userSites]);

  // ── tour ──────────────────────────────────────────────────────────────────
  const [showTour, setShowTour] = useState(() => !safeLocalGet("tour_seen"));
  const handleTourDone = () => {
    safeLocalSet("tour_seen", "1");
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
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <div className="header-top">
          <h1>City Planner</h1>
          <div className="mode-toggle" role="group" aria-label="View mode">
            <button
              className={`mode-btn ${mode === "map" ? "active" : ""}`}
              onClick={() => setMode("map")}
              aria-pressed={mode === "map"}
            >
              Map
            </button>
            <button
              className={`mode-btn ${mode === "compare" ? "active" : ""}`}
              onClick={() => setMode("compare")}
              aria-pressed={mode === "compare"}
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
              <IconHelp />
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

      <main id="main-content" tabIndex={-1} className="app-main">
      {mode === "compare" && (
        <Suspense fallback={<Loader fill message="Loading comparison…" />}>
          <CompareView
            asset={selection.asset}
            onAssetChange={(a) => setSelection((s) => ({ ...s, asset: a }))}
          />
        </Suspense>
      )}

      {mode === "map" && indexError && !available.length && (
        <ErrorState
          fill
          title="Couldn’t load the dataset index"
          message="The list of available cities and assets failed to load. Check your connection and try again."
          onRetry={reload}
        />
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

      {mode === "map" && !loading && !error && coreData && selectedFiltered.length === 0 && (
        <EmptyState
          fill
          title="No recommendations to show"
          message={`There are no recommended locations for ${mapCfg.label} · ${ASSET_LABELS_SHORT[selection.asset] ?? selection.asset} at the current budget.`}
        />
      )}

      {mode === "map" && !loading && !error && coreData && selectedFiltered.length > 0 && (
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
            dataReady={{ units: !!units, pois: !!pois }}
            planMode={planMode}
            onTogglePlan={() => setPlanMode((p) => !p)}
            gridReady={!!units}
            gapEstimate={gapEstimate}
            userSites={userSites}
            onAddAtCenter={addSiteAtCenter}
            onRemoveSite={removeUserSite}
            onClearSites={() => setUserSites([])}
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
            mapRef={mapRef}
            center={mapCfg.center}
            zoom={mapCfg.zoom}
            units={units}
            assets={coreData.assets}
            selectedFeatures={selectedFiltered}
            pois={pois}
            layers={layers}
            asset={selection.asset}
            planMode={planMode}
            userSites={userSites}
            onAddSite={addUserSite}
            onRemoveSite={removeUserSite}
          />
          <button
            className="panel-toggle"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
          >
            <IconMenu /> Scenario
          </button>
        </div>
      )}
      </main>

      {showTour && (
        <Suspense fallback={null}>
          <Tour onDone={handleTourDone} />
        </Suspense>
      )}

      {showReport && coreData && (
        <Suspense fallback={<Loader fill message="Preparing report…" />}>
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
        </Suspense>
      )}
    </div>
  );
}
