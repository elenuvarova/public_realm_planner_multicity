"""
TES-style multiplicative scoring.

Score = 100 × (1 − GapScore × EquityIndex)
EquityIndex = 0.1 + 0.9 × mean(min-max normalised equity indicators)

GapScore:
  Phase 0: Euclidean distance to nearest existing asset (compute_gap_score).
  Phase 2: Walking-network distance via OSMnx + multi-source Dijkstra
           (compute_network_gap_score — default when boundary is available).

Sources:
  TES methodology (American Forests, Toronto 2024):
    Ni = (xi − xi_min) / (xi_max − xi_min)
    E  = 0.1 + 0.9 × mean(N_i)
    GapScore = gap / gap_max
    Score = 100 × (1 − GapScore × E)
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

_REPO_ROOT = Path(__file__).parent.parent
_GRAPH_CACHE = _REPO_ROOT / "cache" / "graphs"


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


def compute_network_gap_score(
    grid: gpd.GeoDataFrame,
    assets: gpd.GeoDataFrame,
    boundary: gpd.GeoDataFrame,
    city_key: str,
    city_crs: int,
    walk_radius_m: float = 500.0,
) -> gpd.GeoDataFrame:
    """
    Walking-network gap score using OSMnx + multi-source Dijkstra.

    Builds (or loads from cache/graphs/) a projected walk graph, then runs
    multi-source Dijkstra from all existing asset nodes to find the nearest
    walking distance to every H3 cell centroid.

    Falls back to Euclidean compute_gap_score on any error.
    """
    import networkx as nx
    import osmnx as ox

    _GRAPH_CACHE.mkdir(parents=True, exist_ok=True)
    cache_path = _GRAPH_CACHE / f"{city_key}_walk_{city_crs}.graphml"

    try:
        if cache_path.exists():
            print(f"  loading cached walk graph ({cache_path.name})...")
            G = ox.load_graphml(str(cache_path))
        else:
            print("  building walk graph from OSM (will be cached)...")
            poly = boundary.union_all()
            G = ox.graph_from_polygon(poly, network_type="walk", retain_all=False)
            G = ox.project_graph(G, to_crs=city_crs)
            ox.save_graphml(G, filepath=str(cache_path))
            print(f"  walk graph saved to {cache_path.name}")

        if len(assets) == 0:
            raise ValueError("no existing assets — cannot compute network gap")

        # snap assets to nearest graph nodes
        assets_proj = assets.to_crs(city_crs)
        asset_nodes = ox.nearest_nodes(
            G,
            X=assets_proj.geometry.centroid.x.values,
            Y=assets_proj.geometry.centroid.y.values,
        )

        # multi-source Dijkstra: one pass gives distance from *nearest* asset
        # to every reachable node within the cutoff
        cutoff = walk_radius_m * 3  # gradient beyond threshold; 1500 m default
        lengths = dict(
            nx.multi_source_dijkstra_path_length(
                G, sources=set(asset_nodes), cutoff=cutoff, weight="length"
            )
        )

        # snap H3 centroids to graph nodes and look up distances
        grid_proj = grid.to_crs(city_crs)
        centroid_nodes = ox.nearest_nodes(
            G,
            X=grid_proj.geometry.centroid.x.values,
            Y=grid_proj.geometry.centroid.y.values,
        )
        dist_m = np.array([lengths.get(n, cutoff) for n in centroid_nodes], dtype=float)

        grid = grid.copy()
        grid["dist_to_nearest_m"] = dist_m.round(1)
        gap_raw = np.clip(dist_m, 0, walk_radius_m * 2)
        gap_max = gap_raw.max()
        grid["GapScore"] = (gap_raw / gap_max).round(4) if gap_max > 0 else 0.0

        covered_pct = (dist_m <= walk_radius_m).mean() * 100
        print(f"  network gap: median {np.median(dist_m):.0f} m  "
              f"covered ≤{walk_radius_m:.0f} m: {covered_pct:.1f}%")
        return grid

    except Exception as exc:
        print(f"  ⚠ network gap failed ({exc!r}), falling back to Euclidean")
        return compute_gap_score(grid, assets, city_crs, walk_radius_m)


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
