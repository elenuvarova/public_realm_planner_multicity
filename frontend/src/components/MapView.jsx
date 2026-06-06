import { useState, useMemo } from "react";
import { MapContainer, TileLayer, GeoJSON, Circle, Marker, Popup, Tooltip, ZoomControl, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SCORE_RAMP, MAP_COLORS, scoreColor } from "../mapColors";

const SERVICE_RADIUS_M = 500;

const ASSET_SINGULAR = {
  toilets:          "Public toilet",
  benches:          "Bench",
  waste_bins:       "Waste bin",
  drinking_water:   "Drinking water point",
  fitness_stations: "Fitness station",
  bike_parking:     "Bike parking",
  defibrillators:   "Defibrillator",
  dog_areas:        "Dog area",
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function unitStyle(feature) {
  return {
    fillColor: scoreColor(feature.properties.Score ?? 50),
    weight: 0.3,
    opacity: 0.5,
    color: "#888",
    fillOpacity: 0.72,
  };
}

function poiPointToLayer(_, latlng) {
  return L.circleMarker(latlng, {
    radius: 2.5,
    fillColor: MAP_COLORS.poi,
    color: "transparent",
    weight: 0,
    fillOpacity: 0.45,
  });
}

function rankIcon(rank) {
  return L.divIcon({
    html: `<div class="rank-marker">${rank}</div>`,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

const userSiteIcon = L.divIcon({
  html: `<div class="user-site-marker">+</div>`,
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Adds a user candidate site wherever the map background is clicked (plan mode).
function PlanClicks({ enabled, onAdd }) {
  useMapEvents({
    click(e) {
      if (enabled) onAdd(e.latlng.lng, e.latlng.lat);
    },
  });
  return null;
}

function fmtScore(score) {
  return Number.isFinite(score) ? score.toFixed(0) : "—";
}

function fmtGapPct(gap) {
  return Number.isFinite(gap) ? (gap * 100).toFixed(0) : "—";
}

function onEachUnit(feature, layer) {
  const p = feature.properties;
  layer.bindTooltip(
    `Score: <b>${fmtScore(p.Score)}</b>  Gap: ${fmtGapPct(p.GapScore)}%`,
    { sticky: true, className: "unit-tooltip" }
  );
}

export default function MapView({
  center, zoom = 12, units, assets, selectedFeatures, pois, layers, asset,
  planMode = false, userSites = [], onAddSite, onRemoveSite, mapRef,
}) {
  const assetName = ASSET_SINGULAR[asset] ?? "Facility";
  // Collapsed by default (per the owner's preference). The collapsed header still
  // shows the mini-ramp, so the score-grid colours have a key without taking space.
  const [legendOpen, setLegendOpen] = useState(false);
  const assetCoords = useMemo(
    () => assets?.features?.map((f) => ({
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      props: f.properties,
    })) ?? [],
    [assets]
  );

  return (
    <div
      className={`leaflet-map-wrap ${planMode ? "leaflet-map-wrap--plan" : ""}`}
      role="region"
      aria-label={`Map of ${assetName} service-gap scores and recommended sites`}
    >
    <MapContainer
      ref={mapRef}
      center={center}
      zoom={zoom}
      className="leaflet-map"
      scrollWheelZoom
      zoomControl={false}
      preferCanvas
    >
      <ZoomControl position="bottomright" />
      <PlanClicks enabled={planMode} onAdd={onAddSite} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={19}
      />

      {/* hexagon scoring grid — optional, off by default */}
      {layers.units && units && (
        <GeoJSON
          key="units"
          data={units}
          style={unitStyle}
          onEachFeature={onEachUnit}
        />
      )}

      {/* 500m coverage zones: existing assets */}
      {layers.coverage &&
        assetCoords.map((a, i) => (
          <Circle
            key={`cov-${i}`}
            center={[a.lat, a.lng]}
            radius={SERVICE_RADIUS_M}
            interactive={false}
            pathOptions={{
              color: MAP_COLORS.existing,
              weight: 0,
              fillColor: MAP_COLORS.existing,
              fillOpacity: 0.07,
            }}
          />
        ))}

      {/* 500m coverage zones: selected recommendations */}
      {layers.selected &&
        selectedFeatures.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates;
          return (
            <Circle
              key={`cov-sel-${feature.properties.rank}`}
              center={[lat, lng]}
              radius={SERVICE_RADIUS_M}
              interactive={false}
              pathOptions={{
                color: MAP_COLORS.recommended,
                weight: 0,
                fillColor: MAP_COLORS.recommended,
                fillOpacity: 0.12,
              }}
            />
          );
        })}

      {/* existing asset dots */}
      {layers.assets && assets && (
        <GeoJSON
          key="assets"
          data={assets}
          pointToLayer={(_, latlng) =>
            L.circleMarker(latlng, {
              radius: 4,
              fillColor: MAP_COLORS.existing,
              color: "#fff",
              weight: 1.5,
              fillOpacity: 0.9,
            })
          }
          onEachFeature={(feature, layer) => {
            const p = feature.properties ?? {};
            const title = escapeHtml(p.name || assetName);
            const access =
              p.accessible != null && p.accessible !== ""
                ? `<br/>Accessible: ${escapeHtml(p.accessible)}`
                : "";
            layer.bindPopup(`<b>${title}</b>${access}`);
          }}
        />
      )}

      {/* demand POIs */}
      {layers.pois && pois && (
        <GeoJSON key="pois" data={pois} pointToLayer={poiPointToLayer} />
      )}

      {/* ranked recommendation markers */}
      {layers.selected &&
        selectedFeatures.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates;
          const p = feature.properties;
          return (
            <Marker key={p.id || p.rank} position={[lat, lng]} icon={rankIcon(p.rank)}>
              <Popup>
                <b>Recommendation #{p.rank}</b>
                <br />
                Gap score: {fmtGapPct(p.GapScore)}%
                <br />
                Equity index: {Number.isFinite(p.EquityIndex) ? p.EquityIndex.toFixed(2) : "—"}
              </Popup>
            </Marker>
          );
        })}

      {/* what-if planner: user-placed candidate sites + their straight-line reach */}
      {userSites.map((s) => (
        <Circle
          key={`reach-${s.id}`}
          center={[s.lat, s.lng]}
          radius={SERVICE_RADIUS_M}
          interactive={false}
          pathOptions={{
            color: MAP_COLORS.recommended,
            weight: 1,
            dashArray: "4 3",
            fillColor: MAP_COLORS.recommended,
            fillOpacity: 0.1,
          }}
        />
      ))}
      {userSites.map((s) => (
        <Marker
          key={`site-${s.id}`}
          position={[s.lat, s.lng]}
          icon={userSiteIcon}
          eventHandlers={{ click: () => onRemoveSite && onRemoveSite(s.id) }}
        >
          <Tooltip direction="top" offset={[0, -10]}>Click to remove</Tooltip>
        </Marker>
      ))}
    </MapContainer>

      {/* collapsible map legend; MapView supplies all colors inline.
          Collapsed = compact header (title + mini ramp); click to expand details. */}
      <div className={`map-legend ${legendOpen ? "map-legend--open" : ""}`}>
        <button
          type="button"
          className="map-legend__header"
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
          aria-controls="map-legend-body"
        >
          <span className="map-legend__title">Service-gap score</span>
          <span className="map-legend__ramp" aria-hidden="true">
            {SCORE_RAMP.map((hex) => (
              <span
                key={hex}
                className="map-legend__swatch"
                style={{ backgroundColor: hex }}
              />
            ))}
          </span>
          <span className="map-legend__chevron" aria-hidden="true" />
        </button>

        <div className="map-legend__body" id="map-legend-body" hidden={!legendOpen}>
          <div className="map-legend__scale">
            <span>Well served</span>
            <span>Underserved</span>
          </div>
          <ul className="map-legend__items">
            <li className="map-legend__item">
              <span className="map-legend__dot" style={{ backgroundColor: MAP_COLORS.recommended }} />
              Recommended site
            </li>
            <li className="map-legend__item">
              <span className="map-legend__dot" style={{ backgroundColor: MAP_COLORS.existing }} />
              Existing {assetName.toLowerCase()}
            </li>
            <li className="map-legend__item">
              <span className="map-legend__dot" style={{ backgroundColor: MAP_COLORS.coverage }} />
              500 m coverage
            </li>
            <li className="map-legend__item">
              <span className="map-legend__dot" style={{ backgroundColor: MAP_COLORS.poi }} />
              Demand POI
            </li>
          </ul>
        </div>
      </div>

      {/* text alternative to the color map for screen readers */}
      <div
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        <h2>Recommended sites for {assetName.toLowerCase()}, ranked by need</h2>
        {selectedFeatures.length === 0 ? (
          <p>No recommended sites for the current budget.</p>
        ) : (
          <ol>
            {selectedFeatures.map((feature) => {
              const p = feature.properties;
              return (
                <li key={p.id || p.rank}>
                  Rank {p.rank}: gap score {fmtGapPct(p.GapScore)}%
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
