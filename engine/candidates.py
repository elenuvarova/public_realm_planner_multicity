"""
Candidate location generation and greedy max-coverage optimiser.

Phase 0: candidates = centroids of under-served H3 cells (bottom 40% by Score).
Phase 3 (senior): add DBSCAN POI-cluster anchors + network-node sampling + MCLP via spopt.
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
from scipy.spatial import cKDTree

# Walking trips are longer than the straight line between two points. We use a
# circuity factor to reconcile the two distance models in this file:
#   - GapScore (scoring.py) is a WALKING-NETWORK distance.
#   - Candidate coverage sets here are computed with a fast Euclidean kd-tree.
# Shrinking the Euclidean radius by this factor makes "reachable in a straight
# line" approximate "reachable on foot within service_radius_m", so the headline
# coverage numbers stay consistent with the gap map. ~1.35 is a common urban
# street-network circuity (Boeing 2019, "Street Network Models and Measures").
CIRCUITY_FACTOR = 1.35


def generate_candidates(
    grid: gpd.GeoDataFrame,
    assets: gpd.GeoDataFrame,
    city_crs: int,
    priority_pct: float = 0.40,
    min_dist_m: float = 300.0,
) -> gpd.GeoDataFrame:
    """
    Build a candidate pool from:
      1. Centroids of cells in the bottom `priority_pct` by Score (highest gap).
      2. Filtered to remove points within `min_dist_m` of an existing asset.
      3. Deduplicated: no two candidates within `min_dist_m/2` of each other.

    Returns GeoDataFrame in EPSG:4326 with columns:
      id, geometry, h3_id, Score, GapScore, EquityIndex, demand_weight.
    """
    grid_m = grid.to_crs(city_crs)

    # pick the most under-served cells
    threshold = grid["Score"].quantile(priority_pct)
    under = grid_m[grid["Score"] <= threshold].copy()
    if under.empty:
        under = grid_m.copy()

    # centroids as candidate points
    under["geometry"] = under.geometry.centroid
    cx = under["geometry"].x.values
    cy = under["geometry"].y.values

    # drop candidates within min_dist_m of an existing asset
    if len(assets) > 0:
        assets_m = assets.to_crs(city_crs)
        ax = assets_m.geometry.centroid.x.values
        ay = assets_m.geometry.centroid.y.values
        atree = cKDTree(np.column_stack([ax, ay]))
        d_to_asset, _ = atree.query(np.column_stack([cx, cy]), k=1)
        under = under[d_to_asset >= min_dist_m].copy()
        cx = under["geometry"].x.values
        cy = under["geometry"].y.values

    # deduplicate: no two candidates within min_dist_m/2 of each other (greedy pass)
    if len(cx) == 0:
        return gpd.GeoDataFrame(columns=["id", "geometry", "Score", "GapScore",
                                         "EquityIndex", "demand_weight"], crs=4326)

    kept = []
    eliminated = set()
    tree = cKDTree(np.column_stack([cx, cy]))
    order = under["GapScore"].argsort()[::-1].values   # highest gap first
    for i in order:
        if i in eliminated:
            continue
        kept.append(i)
        nearby = tree.query_ball_point([cx[i], cy[i]], r=min_dist_m / 2)
        for j in nearby:
            if j != i:
                eliminated.add(j)

    cands = under.iloc[kept].copy().reset_index(drop=True)
    cands["id"] = [f"cand_{i:04d}" for i in range(len(cands))]

    keep_cols = ["id", "geometry", "Score", "GapScore", "EquityIndex", "demand_weight"]
    keep_cols += [c for c in ["poi_count", "h3_id"] if c in cands.columns]
    cands = cands[[c for c in keep_cols if c in cands.columns]].to_crs(4326)
    print(f"  candidates: {len(cands)} after filtering")
    return cands


def _existing_covered(demand_grid, dem_m, asset_m, dx, dy, service_radius_m):
    """
    Boolean mask of demand cells already served by existing assets.

    Prefers the walking-network distance precomputed on the grid
    (`dist_to_nearest_m`, the same quantity GapScore is derived from) so the
    coverage baseline matches the gap map. Falls back to a circuity-adjusted
    Euclidean nearest-asset query when that column is unavailable.
    """
    if "dist_to_nearest_m" in demand_grid.columns:
        return demand_grid["dist_to_nearest_m"].values <= service_radius_m
    covered = np.zeros(len(dem_m), dtype=bool)
    if len(asset_m) > 0:
        ax = asset_m.geometry.centroid.x.values
        ay = asset_m.geometry.centroid.y.values
        d_existing, _ = cKDTree(np.column_stack([ax, ay])).query(np.column_stack([dx, dy]), k=1)
        covered = d_existing <= service_radius_m / CIRCUITY_FACTOR
    return covered


def greedy_max_coverage(
    candidates: gpd.GeoDataFrame,
    demand_grid: gpd.GeoDataFrame,
    assets: gpd.GeoDataFrame,
    city_crs: int,
    service_radius_m: float = 500.0,
    budget: int = 10,
) -> tuple[gpd.GeoDataFrame, dict]:
    """
    Greedy maximal coverage: iteratively select the candidate that covers the most
    uncovered demand (population-weighted, or poi_count-weighted for Phase 0).
    Guarantee: ≥ (1 − 1/e) ≈ 63% of the optimal coverage (Nemhauser et al.).

    Returns:
      selected  — GeoDataFrame of chosen candidate locations
      report    — dict with coverage_before, coverage_after, coverage_gain, newly_covered
    """
    dem_m = demand_grid.to_crs(city_crs)
    cand_m = candidates.to_crs(city_crs)
    asset_m = assets.to_crs(city_crs)

    # demand points: cell centroids weighted by demand_weight
    dx = dem_m.geometry.centroid.x.values
    dy = dem_m.geometry.centroid.y.values
    dw = demand_grid["demand_weight"].values \
        if "demand_weight" in demand_grid.columns else np.ones(len(dem_m))

    cx = cand_m.geometry.x.values
    cy = cand_m.geometry.y.values

    # coverage sets: which demand cells each candidate covers within reach.
    # Use a circuity-shrunk Euclidean radius so straight-line reach approximates
    # the walking-network reach that GapScore is built on (see CIRCUITY_FACTOR).
    eff_radius = service_radius_m / CIRCUITY_FACTOR
    dem_tree = cKDTree(np.column_stack([dx, dy]))
    cov_sets = dem_tree.query_ball_point(np.column_stack([cx, cy]), r=eff_radius)

    # before: how much is already covered by existing assets. Prefer the
    # walking-network distance already on the grid (consistent with GapScore);
    # fall back to a circuity-adjusted Euclidean estimate only if it's absent.
    covered = _existing_covered(demand_grid, dem_m, asset_m, dx, dy, service_radius_m)
    total_demand = dw.sum() or 1.0
    before_pct = float(dw[covered].sum() / total_demand)

    # greedy selection — track coverage at each step for the browser slider
    chosen_indices = []
    coverage_steps = [round(before_pct, 4)]   # step 0 = no new assets
    for _ in range(budget):
        best_c, best_gain = -1, 0.0
        for c_idx, cell_ids in enumerate(cov_sets):
            if c_idx in chosen_indices:
                continue
            gain = float(dw[cell_ids][~covered[cell_ids]].sum())
            if gain > best_gain:
                best_gain, best_c = gain, c_idx
        if best_c < 0 or best_gain == 0.0:
            break
        for i in cov_sets[best_c]:
            covered[i] = True
        chosen_indices.append(best_c)
        coverage_steps.append(round(float(dw[covered].sum() / total_demand), 4))

    after_pct = float(dw[covered].sum() / total_demand)

    selected = candidates.iloc[chosen_indices].copy().reset_index(drop=True)
    selected["rank"] = range(1, len(selected) + 1)

    report = {
        "solver":                    "greedy",
        "budget":                    budget,
        "service_radius_m":          service_radius_m,
        "circuity_factor":           CIRCUITY_FACTOR,
        "coverage_basis":            "network baseline + circuity-adjusted candidate reach",
        "n_selected":                len(selected),
        "coverage_before":           round(before_pct, 4),
        "coverage_after":            round(after_pct, 4),
        "coverage_gain":             round(after_pct - before_pct, 4),
        "newly_covered_demand_pct":  round(after_pct - before_pct, 4),
        "coverage_steps":            coverage_steps,
    }
    print(f"  coverage: {before_pct:.1%} → {after_pct:.1%}  (+{after_pct-before_pct:.1%})")
    return selected, report


def mclp_max_coverage(
    candidates: gpd.GeoDataFrame,
    demand_grid: gpd.GeoDataFrame,
    assets: gpd.GeoDataFrame,
    city_crs: int,
    service_radius_m: float = 500.0,
    budget: int = 10,
) -> tuple[gpd.GeoDataFrame, dict]:
    """
    Exact MCLP via PuLP/CBC integer linear program.

    Maximises total weighted demand covered subject to a facility budget p.
    Falls back to greedy_max_coverage on import error or infeasible solve.

    Returns same (selected, report) interface as greedy_max_coverage.
    """
    try:
        import pulp
    except ImportError:
        print("  ⚠ pulp not installed — falling back to greedy")
        return greedy_max_coverage(candidates, demand_grid, assets, city_crs,
                                   service_radius_m, budget)

    dem_m = demand_grid.to_crs(city_crs)
    cand_m = candidates.to_crs(city_crs)
    asset_m = assets.to_crs(city_crs)

    dx = dem_m.geometry.centroid.x.values
    dy = dem_m.geometry.centroid.y.values
    dw = (demand_grid["demand_weight"].values
          if "demand_weight" in demand_grid.columns else np.ones(len(dem_m)))

    cx = cand_m.geometry.x.values
    cy = cand_m.geometry.y.values
    n_cands = len(cx)
    n_demand = len(dx)

    if n_cands == 0:
        return greedy_max_coverage(candidates, demand_grid, assets, city_crs,
                                   service_radius_m, budget)

    # coverage sets: circuity-shrunk Euclidean reach (≈ walking-network reach)
    eff_radius = service_radius_m / CIRCUITY_FACTOR
    dem_tree = cKDTree(np.column_stack([dx, dy]))
    cov_sets = dem_tree.query_ball_point(np.column_stack([cx, cy]), r=eff_radius)

    # existing coverage by assets already in place (network baseline when available)
    covered_before = _existing_covered(demand_grid, dem_m, asset_m, dx, dy, service_radius_m)

    total_demand = dw.sum() or 1.0
    before_pct = float(dw[covered_before].sum() / total_demand)

    # only uncovered demand cells are relevant for the ILP
    uncov_mask = ~covered_before
    uncov_idx = np.where(uncov_mask)[0]

    # reverse map: for each uncovered demand cell, which candidates can cover it?
    covering_cands: list[list[int]] = [[] for _ in range(n_demand)]
    for j, cells in enumerate(cov_sets):
        for i in cells:
            if uncov_mask[i]:
                covering_cands[i].append(j)

    # ILP formulation
    prob = pulp.LpProblem("MCLP", pulp.LpMaximize)
    y = [pulp.LpVariable(f"y_{j}", cat="Binary") for j in range(n_cands)]
    z = [pulp.LpVariable(f"z_{k}", cat="Binary") for k in range(len(uncov_idx))]

    # objective: maximise weighted coverage of currently-uncovered demand
    prob += pulp.lpSum(float(dw[i]) * z_k for z_k, i in zip(z, uncov_idx))

    # budget: select at most `budget` facilities
    prob += pulp.lpSum(y) <= budget

    # coverage constraints: demand cell k is covered only if at least one
    # selected facility within radius covers it
    for k, i in enumerate(uncov_idx):
        cj = covering_cands[i]
        if cj:
            prob += pulp.lpSum(y[j] for j in cj) >= z[k]

    prob.solve(pulp.PULP_CBC_CMD(msg=False))

    status = pulp.LpStatus[prob.status]
    if status not in ("Optimal", "Not Solved"):
        print(f"  ⚠ MCLP solver status: {status} — falling back to greedy")
        return greedy_max_coverage(candidates, demand_grid, assets, city_crs,
                                   service_radius_m, budget)

    chosen_indices = [
        j for j in range(n_cands)
        if pulp.value(y[j]) is not None and pulp.value(y[j]) > 0.5
    ]

    # generate coverage_steps for the browser slider:
    # sort chosen facilities by marginal gain (greedy order within the optimal set)
    covered = covered_before.copy()
    ordered_chosen = []
    coverage_steps = [round(before_pct, 4)]
    remaining = set(chosen_indices)
    for _ in range(len(chosen_indices)):
        best_c, best_gain = -1, -1.0
        for j in remaining:
            new_cells = [i for i in cov_sets[j] if not covered[i]]
            gain = float(dw[new_cells].sum()) if new_cells else 0.0
            if gain > best_gain:
                best_gain, best_c = gain, j
        if best_c < 0:
            break
        remaining.remove(best_c)
        ordered_chosen.append(best_c)
        for i in cov_sets[best_c]:
            covered[i] = True
        coverage_steps.append(round(float(dw[covered].sum() / total_demand), 4))

    after_pct = float(dw[covered].sum() / total_demand)
    selected = candidates.iloc[ordered_chosen].copy().reset_index(drop=True)
    selected["rank"] = range(1, len(selected) + 1)

    report = {
        "solver":                    "mclp",
        "budget":                    budget,
        "service_radius_m":          service_radius_m,
        "circuity_factor":           CIRCUITY_FACTOR,
        "coverage_basis":            "network baseline + circuity-adjusted candidate reach",
        "n_selected":                len(selected),
        "coverage_before":           round(before_pct, 4),
        "coverage_after":            round(after_pct, 4),
        "coverage_gain":             round(after_pct - before_pct, 4),
        "newly_covered_demand_pct":  round(after_pct - before_pct, 4),
        "coverage_steps":            coverage_steps,
    }
    print(f"  coverage: {before_pct:.1%} → {after_pct:.1%}  "
          f"(+{after_pct - before_pct:.1%})  [MCLP exact]")
    return selected, report


# pandas import needed inside greedy (referenced via module-level alias)
import pandas as pd  # noqa: E402 — late import to avoid circular at top of file
