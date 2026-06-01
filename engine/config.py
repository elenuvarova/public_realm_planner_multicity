CITIES = {
    "paris": {
        "display_name": "Paris, France",
        "crs": 2154,                    # RGF93 / Lambert-93, metric (metres)
        "osm_place": "Paris, France",
        "admin_level": "8",
        "walk_radius_m": 500,           # planning threshold: 5-min walk ~80 m/min
        "candidate_min_dist_m": 300,    # min distance between two new assets
    },
    "antwerp": {
        "display_name": "Antwerpen, Belgium",
        "crs": 31370,                   # Belge 1972 / Belgian Lambert 72
        "osm_place": "Antwerp, Belgium",
        "admin_level": "8",
        "walk_radius_m": 500,
        "candidate_min_dist_m": 300,
    },
    "london": {
        "display_name": "London, United Kingdom",
        "crs": 27700,                   # OSGB36 / British National Grid
        "osm_place": "London, England",
        "admin_level": "8",
        "walk_radius_m": 500,
        "candidate_min_dist_m": 300,
    },
}

ASSETS = {
    "toilets": {
        "osm_tags": {"amenity": "toilets"},
        "demand_pois": {
            "leisure":          ["park"],
            "amenity":          ["school", "marketplace"],
            "public_transport": ["platform"],
            "railway":          ["station"],
        },
    },
    "benches": {
        "osm_tags": {"amenity": "bench"},
        "demand_pois": {
            "amenity":   ["pharmacy", "clinic", "hospital"],
            "leisure":   ["park"],
            "public_transport": ["platform"],
        },
    },
}

# H3 resolution for analysis grid
H3_RES = 9          # edge ~201 m, area ~0.11 km² — good ~250m city grid feel

# Output dir (relative to repo root)
OUTPUT_BASE = "frontend/public/data"
