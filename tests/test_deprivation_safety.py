"""
Provenance + download/extraction-hardening invariants for engine/deprivation.py.

All of these run offline: the fallback path is triggered by an unknown city key,
and the zip helpers are exercised with in-memory archives.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import geopandas as gpd
import pytest
from shapely.geometry import Point

from engine import deprivation as dep

from .conftest import TEST_CRS


def _tiny_grid() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {"h3_id": ["a", "b"]},
        geometry=[Point(500_000, 200_000), Point(500_200, 200_200)],
        crs=TEST_CRS,
    )


# ── provenance (Task 2) ───────────────────────────────────────────────────────

def test_load_deprivation_unknown_city_reports_fallback():
    grid, status = dep.load_deprivation("atlantis", _tiny_grid(), None, TEST_CRS)
    assert status["deprivation_source"] == "neutral_fallback"
    assert status["zones_joined"] == 0
    assert (grid["deprivation_score"] == 0.5).all()


def test_load_deprivation_failure_reports_fallback_with_reason(monkeypatch):
    """A loader that raises must surface a neutral_fallback status + a reason."""
    def boom(grid, boundary, crs):
        raise RuntimeError("network down")

    monkeypatch.setitem(dep._LOADERS, "paris", boom)
    grid, status = dep.load_deprivation("paris", _tiny_grid(), None, TEST_CRS)
    assert status["deprivation_source"] == "neutral_fallback"
    assert status["reason"] is not None
    assert (grid["deprivation_score"] == 0.5).all()


def test_load_deprivation_success_reports_real(monkeypatch):
    """A loader returning (grid, zones) must surface a 'real' provenance."""
    def ok(grid, boundary, crs):
        grid = grid.copy()
        grid["deprivation_score"] = 0.3
        return grid, 123

    monkeypatch.setitem(dep._LOADERS, "london", ok)
    _, status = dep.load_deprivation("london", _tiny_grid(), None, TEST_CRS)
    assert status["deprivation_source"] == "real"
    assert status["zones_joined"] == 123


# ── zip-slip / size hardening (Task 5) ────────────────────────────────────────

def test_safe_extract_blocks_zip_slip(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../escape.txt", "pwned")
    buf.seek(0)
    with zipfile.ZipFile(buf) as zf:
        with pytest.raises(ValueError, match="zip-slip"):
            dep._safe_extract_zip(zf, tmp_path)
    assert not (tmp_path.parent / "escape.txt").exists()


def test_safe_extract_blocks_absolute_path(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("/etc/evil.txt", "pwned")
    buf.seek(0)
    with zipfile.ZipFile(buf) as zf:
        with pytest.raises(ValueError, match="absolute path"):
            dep._safe_extract_zip(zf, tmp_path)


def test_safe_extract_allows_normal_members(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("sub/data.txt", "ok")
    buf.seek(0)
    with zipfile.ZipFile(buf) as zf:
        dep._safe_extract_zip(zf, tmp_path)
    assert (tmp_path / "sub" / "data.txt").read_text() == "ok"


# ── URL allowlist (Task 5) ────────────────────────────────────────────────────

def test_assert_safe_zip_url_rejects_http():
    with pytest.raises(ValueError, match="non-https"):
        dep._assert_safe_zip_url("http://www.data.gouv.fr/x.zip")


def test_assert_safe_zip_url_rejects_unknown_host():
    with pytest.raises(ValueError, match="allowlist"):
        dep._assert_safe_zip_url("https://evil.example.com/x.zip")


def test_assert_safe_zip_url_accepts_allowed_host():
    # Should not raise.
    dep._assert_safe_zip_url("https://www.data.gouv.fr/contours-iris.zip")


# ── atomic cache write (Task 3) ───────────────────────────────────────────────

def test_atomic_write_no_partial_on_failure(tmp_path):
    target = tmp_path / "cache.csv"

    def failing_write(p: Path):
        p.write_text("partial")
        raise RuntimeError("interrupted")

    with pytest.raises(RuntimeError):
        dep._atomic_write(target, failing_write)
    # The real cache path must not exist, and no .tmp turds remain.
    assert not target.exists()
    assert list(tmp_path.glob("*.tmp")) == []


def test_atomic_write_replaces_in_place(tmp_path):
    target = tmp_path / "cache.csv"
    dep._atomic_write(target, lambda p: Path(p).write_text("v1"))
    assert target.read_text() == "v1"
    dep._atomic_write(target, lambda p: Path(p).write_text("v2"))
    assert target.read_text() == "v2"
