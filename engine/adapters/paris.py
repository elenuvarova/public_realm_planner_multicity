"""
Paris city adapter.

Sources:
  - Toilets:        opendata.paris.fr  (Opendatasoft v2.1, ODbL)
  - City boundary:  OSMnx geocode
  - POIs:           OpenStreetMap via osmnx.features_from_place (ODbL)
  - Analysis units: H3 hex grid (Phase 0) — IRIS added in Phase 1
"""
# Module-level functions kept for backward compat.
# ParisAdapter class at the bottom wires them into the adapter protocol.

import geopandas as gpd
import osmnx as ox
import pandas as pd
import requests
from shapely.geometry import Point, Polygon

OPENDATASOFT_BASE = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets"


def load_city_boundary() -> gpd.GeoDataFrame:
    """Paris commune boundary from OSM."""
    print("  loading Paris boundary from OSM...")
    gdf = ox.geocode_to_gdf("Paris, France")
    return gdf[["geometry"]].to_crs(4326)


def load_toilets() -> gpd.GeoDataFrame:
    """
    Fetch all Paris public toilets (sanisettes) from opendata.paris.fr.
    Returns GeoDataFrame in EPSG:4326 with columns: id, name, open, accessible.
    """
    print("  fetching Paris toilets from opendata.paris.fr...")
    url = f"{OPENDATASOFT_BASE}/sanisettesparis/exports/geojson"
    gdf = gpd.read_file(url)

    # normalise columns we actually need downstream
    rename = {
        "type":       "name",
        "statut":     "status",
        "acces_pmr":  "accessible",
        "horaire":    "opening_hours",
    }
    gdf = gdf.rename(columns={k: v for k, v in rename.items() if k in gdf.columns})
    gdf["open"] = gdf.get("status", pd.Series("En service", index=gdf.index)) == "En service"
    gdf["asset_type"] = "toilet"
    gdf["source"] = "opendata.paris.fr"

    # keep only in-service toilets (statut = 'En service')
    if "status" in gdf.columns:
        gdf = gdf[gdf["status"] == "En service"].copy()

    gdf = gdf[["geometry", "name", "open", "accessible", "asset_type", "source"]].copy()
    gdf = gdf.dropna(subset=["geometry"])
    return gdf.set_crs(4326, allow_override=True).to_crs(4326)


def load_demand_pois(city_boundary_wgs: gpd.GeoDataFrame, demand_tags: dict) -> gpd.GeoDataFrame:
    """
    Fetch demand generators (parks, schools, stations, markets) from OSM.
    demand_tags: e.g. {"leisure":["park"], "amenity":["school","marketplace"], ...}
    """
    print("  fetching demand POIs from OSM...")
    poly = city_boundary_wgs.union_all()

    # osmnx 2.x: features_from_polygon (replaces geometries_from_polygon)
    try:
        gdf = ox.features_from_polygon(poly, tags=demand_tags)
    except Exception as e:
        print(f"  OSM POI fetch warning: {e}")
        return gpd.GeoDataFrame(columns=["geometry", "poi_type"], crs=4326)

    if gdf.empty:
        return gpd.GeoDataFrame(columns=["geometry", "poi_type"], crs=4326)

    # flatten MultiIndex columns (osmnx returns element_type + osmid)
    gdf = gdf.reset_index(drop=True)

    # derive poi_type from whichever tag matched
    gdf["poi_type"] = "unknown"
    for tag_key in demand_tags:
        if tag_key in gdf.columns:
            mask = gdf[tag_key].notna()
            gdf.loc[mask, "poi_type"] = gdf.loc[mask, tag_key].astype(str)

    # use centroid for any non-point geometry so downstream distance math is uniform
    # reproject to metric CRS (2154) for accurate centroid, then back to WGS84
    gdf["geometry"] = gdf.to_crs(2154).geometry.centroid.to_crs(4326)

    return gdf[["geometry", "poi_type"]].dropna(subset=["geometry"]).to_crs(4326)


# ── adapter class ─────────────────────────────────────────────────────────────

from .base import CityAdapter


class ParisAdapter(CityAdapter):
    def __init__(self):
        from ..config import CITIES
        cfg = CITIES["paris"]
        super().__init__("paris", cfg["crs"], cfg["osm_place"])

    def load_city_boundary(self):
        return load_city_boundary()

    def load_assets(self, asset_type: str, city_boundary_wgs=None):
        if asset_type == "toilets":
            return load_toilets()
        return self._osm_assets(city_boundary_wgs, asset_type)

    def load_demand_pois(self, city_boundary_wgs, demand_tags):
        return load_demand_pois(city_boundary_wgs, demand_tags)
