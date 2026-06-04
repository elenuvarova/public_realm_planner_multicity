"""
Export engine outputs as static GeoJSON + JSON report.
Files land in frontend/public/data/{city}/{asset}/ so Express serves them as-is.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd

from .config import OUTPUT_BASE


def _trim_gdf(gdf: gpd.GeoDataFrame, keep_cols: list[str]) -> gpd.GeoDataFrame:
    """Return only the columns that exist + geometry, reprojected to WGS84."""
    cols = ["geometry"] + [c for c in keep_cols if c in gdf.columns]
    return gdf[cols].to_crs(4326)


def write_outputs(
    city: str,
    asset: str,
    grid: gpd.GeoDataFrame,
    assets: gpd.GeoDataFrame,
    candidates: gpd.GeoDataFrame,
    selected: gpd.GeoDataFrame,
    pois: gpd.GeoDataFrame,
    report: dict,
    repo_root: str | None = None,
) -> Path:
    """
    Write all layers and the report JSON to frontend/public/data/{city}/{asset}/.

    Returns the output directory path.
    """
    base = Path(repo_root or Path(__file__).parent.parent) / OUTPUT_BASE / city / asset
    base.mkdir(parents=True, exist_ok=True)

    # augment report counts before writing scenario (slider needs them in meta)
    report["city"] = city
    report["asset"] = asset
    report["n_existing_assets"] = len(assets)
    report["n_candidates_pool"] = len(candidates)
    report["n_grid_cells"] = len(grid)

    # --- analysis units (choropleth) ---
    # Columns the frontend renders (color + tooltips) plus dist_to_nearest_m, the
    # actual walking-network distance to the nearest existing asset — the what-if
    # planner needs it to define "underserved" as literally >500 m on foot, not a
    # normalized GapScore band. Coordinates rounded to 5 dp (~1.1 m).
    units_out = _trim_gdf(grid, ["Score", "GapScore", "EquityIndex", "dist_to_nearest_m"])
    units_out.to_file(base / "units.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)

    # --- existing assets ---
    assets_out = _trim_gdf(assets, ["name", "accessible", "source"])
    assets_out.to_file(base / "existing_assets.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)

    # --- selected (greedy result) ---
    if not selected.empty:
        sel_out = _trim_gdf(selected, ["id", "rank", "Score", "GapScore", "EquityIndex"])
        sel_out.to_file(base / "selected.geojson", driver="GeoJSON", COORDINATE_PRECISION=6)

    # --- demand POIs (parks/schools/stops) ---
    if not pois.empty:
        pois_out = _trim_gdf(pois, ["poi_type"])
        pois_out.to_file(base / "demand_pois.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)

    # --- scenario data for the browser slider ---
    _write_scenario_json(base, grid, candidates, report)

    # --- summary report ---
    with open(base / "report.json", "w") as f:
        json.dump(report, f, indent=2)

    # --- update top-level index (consumed by city selector in frontend) ---
    _update_index(base.parent.parent, city, asset, report)

    print(f"  output → {base}")
    return base


def _write_scenario_json(
    out_dir: Path,
    grid: gpd.GeoDataFrame,
    candidates: gpd.GeoDataFrame,
    report: dict,
) -> None:
    """
    Pre-computed scenario data for the browser slider.

    The frontend only reads `meta` and `coverage_steps`; the recommendations come
    from selected.geojson filtered by rank. The full demand map and candidate pool
    used to be embedded here (~1 MB/city for London) but were never read by the
    client, so they are intentionally omitted to keep this file tiny.
    """
    n_demand_cells = int(grid["h3_id"].notna().sum()) if "h3_id" in grid.columns else len(grid)

    scenario = {
        "meta": {
            "city":              report.get("city", ""),
            "asset":             report.get("asset", ""),
            "service_radius_m":  report.get("service_radius_m", 500),
            "n_demand_cells":    n_demand_cells,
            "n_existing_assets": report.get("n_existing_assets", 0),
            "n_candidates_pool": report.get("n_candidates_pool", 0),
            # equity-score provenance: 'real' | 'neutral_fallback' (CompareView follow-up)
            "deprivation_source":       report.get("deprivation_source", "real"),
            "deprivation_zones_joined": report.get("deprivation_zones_joined", 0),
        },
        "coverage_steps": report.get("coverage_steps", []),
    }
    with open(out_dir / "scenario.json", "w") as f:
        json.dump(scenario, f)


def _update_index(data_root: Path, city: str, asset: str, report: dict) -> None:
    """Keep frontend/public/data/index.json current with all generated city/asset runs."""
    from .config import CITIES

    index_path = data_root / "index.json"
    if index_path.exists():
        with open(index_path) as f:
            index = json.load(f)
    else:
        index = {"available": []}

    key = f"{city}/{asset}"
    lookup = {f"{e['city']}/{e['asset']}": i for i, e in enumerate(index["available"])}
    entry = {
        "city":             city,
        "asset":            asset,
        "label":            f"{CITIES[city]['display_name']} · {asset.capitalize()}",
        "coverage_before":  report.get("coverage_before", 0),
        "coverage_after":   report.get("coverage_after", 0),
        "n_existing":       report.get("n_existing_assets", 0),
    }
    if key in lookup:
        index["available"][lookup[key]] = entry
    else:
        index["available"].append(entry)

    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)
