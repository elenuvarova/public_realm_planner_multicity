"""
London city adapter.

Sources:
  - Toilets: OpenStreetMap (amenity=toilets) — no single authoritative API.
             Great British Public Toilet Map data is in OSM.
  - Boundary + POIs: OSMnx / OpenStreetMap
"""

from __future__ import annotations

import geopandas as gpd

from .base import CityAdapter


class LondonAdapter(CityAdapter):
    def __init__(self):
        from ..config import CITIES
        cfg = CITIES["london"]
        super().__init__("london", cfg["crs"], cfg["osm_place"])

    def load_assets(
        self, asset_type: str, city_boundary_wgs: gpd.GeoDataFrame | None = None
    ) -> gpd.GeoDataFrame:
        return self._osm_assets(city_boundary_wgs, asset_type)
