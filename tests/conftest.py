"""Shared pytest fixtures + path setup for the engine invariant suite.

These tests run entirely on synthetic GeoDataFrames — no network, no OSM fetch,
no census download — so they're safe to run in CI without the heavy data pipeline.
"""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import Point, Polygon

# Make `import engine...` work when pytest is invoked from the repo root.
_REPO_ROOT = Path(__file__).parent.parent
if str(_REPO_ROOT) in sys.path:
    sys.path.remove(str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT))

# Metric CRS used throughout the tests (British National Grid, metres).
TEST_CRS = 27700


def _square(cx: float, cy: float, half: float = 100.0) -> Polygon:
    """A small square polygon centred on (cx, cy) — stands in for an H3 cell."""
    return Polygon([
        (cx - half, cy - half),
        (cx + half, cy - half),
        (cx + half, cy + half),
        (cx - half, cy + half),
    ])


@pytest.fixture
def synthetic_grid() -> gpd.GeoDataFrame:
    """
    A 5×5 lattice of square 'cells' (200 m pitch) already carrying GapScore,
    EquityIndex and demand_weight columns — enough to exercise scoring + coverage
    without any real geodata.
    """
    rng = np.random.default_rng(42)
    rows = []
    pitch = 200.0
    n = 5
    for i in range(n):
        for j in range(n):
            cx = 500_000 + i * pitch
            cy = 200_000 + j * pitch
            rows.append({
                "h3_id": f"cell_{i}_{j}",
                "geometry": _square(cx, cy),
                "GapScore": float(rng.uniform(0, 1)),
                "demand_weight": float(rng.uniform(0.1, 1.0)),
                "deprivation_score": float(rng.uniform(0, 1)),
            })
    return gpd.GeoDataFrame(rows, crs=TEST_CRS)


@pytest.fixture
def synthetic_assets() -> gpd.GeoDataFrame:
    """One existing asset near the corner of the lattice."""
    return gpd.GeoDataFrame(
        {"name": ["existing-1"]},
        geometry=[Point(500_000, 200_000)],
        crs=TEST_CRS,
    )
