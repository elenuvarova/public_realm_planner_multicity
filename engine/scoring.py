"""
TES-style multiplicative scoring.

Score = 100 × (1 − GapScore × EquityIndex)
EquityIndex = 0.1 + 0.9 × mean(min-max normalised equity indicators)

Phase 0: GapScore = capped distance to nearest existing asset.
Phase 2: replace with network-distance coverage + proper census equity indicators.

Sources:
  TES methodology (American Forests, Toronto 2024):
    Ni = (xi − xi_min) / (xi_max − xi_min)
    E  = 0.1 + 0.9 × mean(N_i)
    GapScore = gap / gap_max
    Score = 100 × (1 − GapScore × E)
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree


def _minmax(s: pd.Series) -> pd.Series:
    """Min-max normalise a Series to [0, 1]. Returns 0 everywhere if no spread."""
    lo, hi = s.min(), s.max()
    if hi == lo:
        return pd.Series(0.0, index=s.index)
    return (s - lo) / (hi - lo)


def compute_gap_score(
    grid: gpd.GeoDataFrame,
    assets: gpd.GeoDataFrame,
    city_crs: int,
    walk_radius_m: float = 500.0,
) -> gpd.GeoDataFrame:
    """
    For each H3 cell centroid, compute GapScore = (dist_to_nearest_asset / walk_radius_m).clip(0, 1).
    Cells already within walk_radius_m of an existing asset score 0 (well-served).

    Uses Euclidean distance in metric CRS (Phase 0 approximation).
    Phase 2: replace with network walking distance.
    """
    grid_m = grid.to_crs(city_crs)
    assets_m = assets.to_crs(city_crs)

    # centroid coordinates in metres
    cx = grid_m.geometry.centroid.x.values
    cy = grid_m.geometry.centroid.y.values
    ax = assets_m.geometry.centroid.x.values
    ay = assets_m.geometry.centroid.y.values

    if len(ax) == 0:
        grid = grid.copy()
        grid["dist_to_nearest_m"] = walk_radius_m
        grid["GapScore"] = 1.0
        return grid

    tree = cKDTree(np.column_stack([ax, ay]))
    dist, _ = tree.query(np.column_stack([cx, cy]), k=1)

    grid = grid.copy()
    grid["dist_to_nearest_m"] = dist.round(1)

    # GapScore: 0 = fully served (within radius), 1 = maximum gap
    gap_raw = np.clip(dist, 0, walk_radius_m * 2)   # cap at 2× radius so outliers don't compress scale
    gapmax = gap_raw.max()
    grid["GapScore"] = (gap_raw / gapmax).round(4) if gapmax > 0 else 0.0
    return grid


def compute_demand_score(
    grid: gpd.GeoDataFrame,
    pois: gpd.GeoDataFrame,
    city_crs: int,
    count_radius_m: float = 800.0,
) -> gpd.GeoDataFrame:
    """
    Count demand POIs (parks, stations, schools, markets) within `count_radius_m`
    of each cell centroid. Used as a crude demand weight and equity proxy for Phase 0.

    Phase 2: replace with actual population from GHSL + 2SFCA.
    """
    grid_m = grid.to_crs(city_crs)
    pois_m = pois.to_crs(city_crs)

    cx = grid_m.geometry.centroid.x.values
    cy = grid_m.geometry.centroid.y.values
    px = pois_m.geometry.centroid.x.values
    py = pois_m.geometry.centroid.y.values

    grid = grid.copy()
    if len(px) == 0:
        grid["poi_count"] = 0
        grid["demand_weight"] = 1.0
        return grid

    tree = cKDTree(np.column_stack([px, py]))
    counts = tree.query_ball_point(np.column_stack([cx, cy]), r=count_radius_m)
    grid["poi_count"] = [len(c) for c in counts]

    # normalise to [0.1, 1] so every cell has at least some demand weight
    pc = grid["poi_count"].astype(float)
    pmax = pc.max()
    grid["demand_weight"] = (0.1 + 0.9 * (pc / pmax)).round(4) if pmax > 0 else 1.0
    return grid


def compute_equity_index(grid: gpd.GeoDataFrame, equity_cols: list[str]) -> gpd.GeoDataFrame:
    """
    EquityIndex = 0.1 + 0.9 × mean(min-max normalised equity indicators).
    Phase 0: uses poi_count as single proxy (denser POI area = higher demand need).
    Phase 2: replace with % elderly, deprivation index, heat, child share.
    """
    grid = grid.copy()
    usable = [c for c in equity_cols if c in grid.columns and grid[c].notna().any()]
    if not usable:
        grid["EquityIndex"] = 0.5    # neutral if no equity data
        return grid

    normed = pd.DataFrame({c: _minmax(grid[c]) for c in usable}, index=grid.index)
    grid["EquityIndex"] = (0.1 + 0.9 * normed.mean(axis=1)).round(4)

    # per-indicator contribution columns (for the explainability panel)
    for c in usable:
        grid[f"contrib_{c}"] = (grid["GapScore"] * 0.9 * normed[c] / len(usable)).round(4)
    return grid


def compute_score(grid: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Final TES-style score.  Requires GapScore and EquityIndex already on the frame.
    Score = 100 × (1 − GapScore × EquityIndex).
    Low score = high priority.
    """
    grid = grid.copy()
    grid["Score"] = (100.0 * (1.0 - grid["GapScore"] * grid["EquityIndex"])).clip(0, 100).round(2)
    grid["priority"] = (100 - grid["Score"]).round(2)   # convenience: high = needs attention
    return grid
