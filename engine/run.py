"""
Engine CLI entry point.

Usage:
  python -m engine.run --city paris   --asset toilets [--budget 10] [--radius 500]
  python -m engine.run --city antwerp --asset toilets
  python -m engine.run --city london  --asset toilets
  python -m engine.run --all                          # run every registered city/asset

Runs the full pipeline:
  load → reproject → grid → existing assets → demand POIs → gap score →
  equity index → TES score → candidates → greedy optimise → export
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from engine.config import ASSETS, CITIES
from engine.adapters import get_adapter
from engine.candidates import generate_candidates, greedy_max_coverage, mclp_max_coverage
from engine.deprivation import load_deprivation
from engine.export import write_outputs
from engine.grid import make_grid
from engine.scoring import (
    compute_demand_score,
    compute_equity_index,
    compute_gap_score,
    compute_network_gap_score,
    compute_score,
)


def run(city: str, asset: str, budget: int, radius: float, solver: str = "greedy") -> None:
    t0 = time.time()
    cfg = CITIES[city]
    asset_cfg = ASSETS[asset]
    crs = cfg["crs"]
    adapter = get_adapter(city)

    print(f"\n{'='*52}")
    print(f"  Public Realm Planner — engine")
    print(f"  city={city}  asset={asset}  budget={budget}  radius={radius}m")
    print(f"{'='*52}\n")

    print("[1/7] city boundary")
    boundary = adapter.load_city_boundary()

    print("[2/7] H3 analysis grid")
    grid = make_grid(boundary, res=9)

    print(f"[3/7] existing {asset}")
    assets = adapter.load_assets(asset_type=asset, city_boundary_wgs=boundary)
    print(f"  loaded {len(assets)} existing assets")

    print("[4/7] demand POIs")
    pois = adapter.load_demand_pois(boundary, asset_cfg["demand_pois"])
    print(f"  loaded {len(pois)} demand POIs")

    print("[5/7] scoring")
    grid = compute_network_gap_score(grid, assets, boundary, city, crs, walk_radius_m=radius)
    grid = compute_demand_score(grid, pois, crs, count_radius_m=radius * 1.6)
    grid = load_deprivation(city, grid, boundary, crs)
    grid = compute_equity_index(grid, equity_cols=["deprivation_score", "demand_weight"])
    grid = compute_score(grid)
    print(f"  score range: {grid['Score'].min():.1f} – {grid['Score'].max():.1f}")
    print(f"  median gap:  {grid['dist_to_nearest_m'].median():.0f} m")

    print("[6/7] candidates + optimisation")
    cands = generate_candidates(
        grid, assets, crs,
        priority_pct=0.40,
        min_dist_m=cfg["candidate_min_dist_m"],
    )
    _optimise = mclp_max_coverage if solver == "mclp" else greedy_max_coverage
    selected, report = _optimise(
        cands, grid, assets, crs,
        service_radius_m=radius,
        budget=budget,
    )

    print("[7/7] export")
    out_dir = write_outputs(
        city=city, asset=asset,
        grid=grid, assets=assets, candidates=cands,
        selected=selected, pois=pois, report=report,
        repo_root=str(REPO_ROOT),
    )

    elapsed = time.time() - t0
    print(f"\n✓  Done in {elapsed:.1f}s")
    print(f"   Output: {out_dir}")
    print(f"   Coverage: {report['coverage_before']:.1%} → {report['coverage_after']:.1%}")
    print(f"   Selected {report['n_selected']}/{budget} locations\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Public Realm Planner — engine")
    parser.add_argument("--city",   default="paris",   choices=list(CITIES),  help="Target city")
    parser.add_argument("--asset",  default="toilets", choices=list(ASSETS),  help="Asset type")
    parser.add_argument("--budget", default=10, type=int,   help="Number of new assets")
    parser.add_argument("--radius", default=500.0, type=float, help="Service radius in metres")
    parser.add_argument("--all",    action="store_true", help="Run all registered city/asset combinations")
    parser.add_argument("--solver", default="greedy", choices=["greedy", "mclp"],
                        help="Optimiser: greedy (fast, ≥63%% optimal) or mclp (exact ILP via CBC)")
    args = parser.parse_args()

    if args.all:
        combos = [(c, a) for c in CITIES for a in ASSETS]
        for city, asset in combos:
            try:
                run(city, asset, args.budget, args.radius, solver=args.solver)
            except Exception as e:
                print(f"\n⚠ {city}/{asset} failed: {e}\n")
    else:
        run(args.city, args.asset, args.budget, args.radius, solver=args.solver)


if __name__ == "__main__":
    main()
