import { MapContainer, TileLayer, GeoJSON, Circle, Marker, Popup, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

function scoreColor(score) {
  if (score < 65) return "#d73027";
  if (score < 72) return "#f46d43";
  if (score < 79) return "#fdae61";
  if (score < 86) return "#a6d96a";
  return "#1a9850";
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
    fillColor: "#8b5cf6",
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

function onEachUnit(feature, layer) {
  const p = feature.properties;
  layer.bindTooltip(
    `Score: <b>${p.Score?.toFixed(0)}</b>  Gap: ${(p.GapScore * 100).toFixed(0)}%`,
    { sticky: true, className: "unit-tooltip" }
  );
}

export default function MapView({ center, zoom = 12, units, assets, selectedFeatures, pois, layers, asset }) {
  const assetName = ASSET_SINGULAR[asset] ?? "Facility";
  const assetCoords = assets?.features?.map((f) => ({
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    props: f.properties,
  })) ?? [];

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className="leaflet-map"
      scrollWheelZoom
    >
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
            pathOptions={{
              color: "#3b82f6",
              weight: 0,
              fillColor: "#3b82f6",
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
              pathOptions={{
                color: "#f97316",
                weight: 0,
                fillColor: "#f97316",
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
              fillColor: "#3b82f6",
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
                Gap score: {(p.GapScore * 100).toFixed(0)}%
                <br />
                Equity index: {p.EquityIndex?.toFixed(2)}
              </Popup>
            </Marker>
          );
        })}
    </MapContainer>
  );
}
