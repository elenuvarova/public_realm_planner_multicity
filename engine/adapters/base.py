"""
Abstract city adapter interface.

Every city provides:
  load_city_boundary()        → GeoDataFrame (EPSG:4326)
  load_assets(type, boundary) → GeoDataFrame (EPSG:4326)
  load_demand_pois(boundary, tags) → GeoDataFrame (EPSG:4326)

Default implementations for load_city_boundary and load_demand_pois use OSMnx.
Subclasses override load_assets (and optionally the others) for authoritative sources.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import geopandas as gpd
import osmnx as ox


def _empty_assets() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        columns=["geometry", "asset_type", "source", "open", "accessible"], crs=4326
    )


class CityAdapter(ABC):
    def __init__(self, city_key: str, city_crs: int, osm_place: str):
        self.city_key = city_key
        self.city_crs = city_crs
        self.osm_place = osm_place

    # ── required ──────────────────────────────────────────────────────────────

    @abstractmethod
    def load_assets(
        self,
        asset_type: str,
        city_boundary_wgs: gpd.GeoDataFrame | None = None,
    ) -> gpd.GeoDataFrame: ...

    # ── defaults (all cities share these unless overridden) ───────────────────

    def load_city_boundary(self) -> gpd.GeoDataFrame:
        print(f"  loading {self.osm_place} boundary from OSM...")
        return ox.geocode_to_gdf(self.osm_place)[["geometry"]].to_crs(4326)

    def load_demand_pois(
        self, city_boundary_wgs: gpd.GeoDataFrame, demand_tags: dict
    ) -> gpd.GeoDataFrame:
        print("  fetching demand POIs from OSM...")
        poly = city_boundary_wgs.union_all()
        try:
            gdf = ox.features_from_polygon(poly, tags=demand_tags)
        except Exception as e:
            print(f"  OSM POI fetch warning: {e}")
            return gpd.GeoDataFrame(columns=["geometry", "poi_type"], crs=4326)
        if gdf.empty:
            return gpd.GeoDataFrame(columns=["geometry", "poi_type"], crs=4326)
        gdf = gdf.reset_index(drop=True)
        gdf["poi_type"] = "unknown"
        for tag_key in demand_tags:
            if tag_key in gdf.columns:
                mask = gdf[tag_key].notna()
                gdf.loc[mask, "poi_type"] = gdf.loc[mask, tag_key].astype(str)
        # reproject to metric CRS for accurate centroid
        gdf["geometry"] = gdf.to_crs(self.city_crs).geometry.centroid.to_crs(4326)
        return gdf[["geometry", "poi_type"]].dropna(subset=["geometry"]).to_crs(4326)

    # ── shared helper: fetch any asset type from OSM ──────────────────────────

    def _osm_assets(
        self, city_boundary_wgs: gpd.GeoDataFrame, asset_type: str
    ) -> gpd.GeoDataFrame:
        from ..config import ASSETS

        tags = ASSETS[asset_type]["osm_tags"]
        poly = city_boundary_wgs.union_all()
        print(f"  fetching {asset_type} from OSM for {self.city_key}...")
        try:
            gdf = ox.features_from_polygon(poly, tags=tags)
        except Exception as e:
            print(f"  OSM {asset_type} fetch warning: {e}")
            return _empty_assets()
        if gdf.empty:
            return _empty_assets()
        gdf = gdf.reset_index(drop=True)
        gdf["geometry"] = gdf.to_crs(self.city_crs).geometry.centroid.to_crs(4326)
        gdf["asset_type"] = asset_type
        gdf["source"] = "OpenStreetMap"
        gdf["open"] = True
        gdf["accessible"] = None
        return (
            gdf[["geometry", "asset_type", "source", "open", "accessible"]]
            .dropna(subset=["geometry"])
            .to_crs(4326)
        )
