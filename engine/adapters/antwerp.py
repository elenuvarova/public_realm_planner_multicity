"""
Antwerp city adapter.

Sources:
  - Toilets: opendata.antwerpen.be ArcGIS Hub (openbaar-toilet), CC BY 4.0
             → fallback: OpenStreetMap (amenity=toilets)
  - Boundary + POIs: OSMnx / OpenStreetMap
"""

from __future__ import annotations

import geopandas as gpd
import requests

from .base import CityAdapter, _empty_assets

# Direct GeoJSON download from Stad Antwerpen open data portal.
# ArcGIS Hub blocks requests without a browser User-Agent.
_HUB_GEOJSON = (
    "https://portaal-stadantwerpen.opendata.arcgis.com"
    "/datasets/openbaar-toilet.geojson"
)


class AntwerpAdapter(CityAdapter):
    def __init__(self):
        from ..config import CITIES
        cfg = CITIES["antwerp"]
        super().__init__("antwerp", cfg["crs"], cfg["osm_place"])

    def load_assets(
        self, asset_type: str, city_boundary_wgs: gpd.GeoDataFrame | None = None
    ) -> gpd.GeoDataFrame:
        if asset_type == "toilets":
            return self._load_toilets(city_boundary_wgs)
        return self._osm_assets(city_boundary_wgs, asset_type)

    def _load_toilets(
        self, city_boundary_wgs: gpd.GeoDataFrame | None
    ) -> gpd.GeoDataFrame:
        print("  fetching Antwerp toilets from opendata.antwerpen.be...")
        try:
            resp = requests.get(
                _HUB_GEOJSON,
                headers={"User-Agent": "Mozilla/5.0 (PublicRealmPlanner/1.0)"},
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            feats = data.get("features", [])
            if feats:
                gdf = gpd.GeoDataFrame.from_features(feats, crs=4326)
                gdf["asset_type"] = "toilet"
                gdf["source"] = "opendata.antwerpen.be"
                gdf["open"] = True
                # field name varies — try common candidates
                for acc_col in ("rolstoeltoegankelijk", "accessible", "wheelchair"):
                    if acc_col in gdf.columns:
                        gdf["accessible"] = gdf[acc_col]
                        break
                else:
                    gdf["accessible"] = None
                keep = ["geometry", "asset_type", "source", "open", "accessible"]
                gdf = gdf[[c for c in keep if c in gdf.columns]].dropna(subset=["geometry"])
                print(f"  loaded {len(gdf)} Antwerp toilets from Hub")
                return gdf.to_crs(4326)
        except Exception as e:
            print(f"  Antwerp Hub fetch failed ({e}), falling back to OSM")

        if city_boundary_wgs is not None:
            return self._osm_assets(city_boundary_wgs, "toilets")
        return _empty_assets()
