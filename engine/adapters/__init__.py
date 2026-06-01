from .base import CityAdapter
from .paris import ParisAdapter
from .antwerp import AntwerpAdapter
from .london import LondonAdapter

_REGISTRY: dict[str, type[CityAdapter]] = {
    "paris":   ParisAdapter,
    "antwerp": AntwerpAdapter,
    "london":  LondonAdapter,
}


def get_adapter(city: str) -> CityAdapter:
    cls = _REGISTRY.get(city)
    if cls is None:
        raise ValueError(
            f"No adapter for city '{city}'. Available: {list(_REGISTRY)}"
        )
    return cls()
