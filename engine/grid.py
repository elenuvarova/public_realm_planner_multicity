"""
H3 hex grid generation for analysis units (MAUP-safe, equal-area cells).

H3 v4 API notes:
  - Coordinate order is (lat, lng) — NOT (lng, lat)
  - cell_to_boundary returns [(lat, lng), ...] → must flip for Shapely (lng, lat)
  - h3shape_to_cells replaces polyfill
"""

import geopandas as gpd
import h3
import pandas as pd
from shapely.geometry import Point, Polygon

from .config import H3_RES


def make_grid(city_boundary_wgs: gpd.GeoDataFrame, res: int = H3_RES) -> gpd.GeoDataFrame:
    """
    Build an H3 hex grid (resolution `res`) clipped to the city polygon.
    Returns GeoDataFrame in EPSG:4326 with columns: h3_id, geometry.
    """
    poly = city_boundary_wgs.union_all()
    h3shape = h3.geo_to_h3shape(poly)           # shapely Polygon → H3Shape
    cell_ids = h3.h3shape_to_cells(h3shape, res) # set of hex IDs whose centroid falls in poly

    rows = []
    for cid in cell_ids:
        boundary = h3.cell_to_boundary(cid)      # [(lat, lng), ...]
        hex_poly = Polygon([(lng, lat) for lat, lng in boundary])
        lat, lng = h3.cell_to_latlng(cid)        # centroid, (lat, lng)
        rows.append({"h3_id": cid, "cx": lng, "cy": lat, "geometry": hex_poly})

    grid = gpd.GeoDataFrame(rows, crs=4326)

    # clip to exact boundary (cells selected by centroid; clip trims edge overhang)
    boundary_gs = gpd.GeoSeries([poly], crs=4326)
    grid = gpd.clip(grid, boundary_gs)
    grid = grid.reset_index(drop=True)
    print(f"  grid: {len(grid)} H3 cells at resolution {res}")
    return grid
