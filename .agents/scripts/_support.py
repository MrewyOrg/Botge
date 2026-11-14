"""Validate small JSON inputs shared by the agent command-line tools."""

import json
import math
from typing import TYPE_CHECKING, Never, cast

if TYPE_CHECKING:
    from pathlib import Path

type Object = dict[str, object]


def fail(message: str) -> Never:
    """Stop a CLI command with a concise diagnostic."""
    raise SystemExit(message)


def read_json(path: Path) -> object:
    """Read JSON without letting untyped decoder values escape the boundary."""
    return json.loads(path.read_text())


def record(value: object) -> Object:
    """Require an object with string keys, preserving unchecked field values."""
    if not isinstance(value, dict):
        fail('Expected a JSON object')
    raw = cast('dict[object, object]', value)
    result: Object = {}
    for key, item in raw.items():
        if not isinstance(key, str):
            fail('JSON object keys must be strings')
        result[key] = item
    return result


def sequence(value: object) -> list[object]:
    """Require an array before inspecting individual elements."""
    if not isinstance(value, list):
        fail('Expected a JSON array')
    return cast('list[object]', value)


def text(value: object) -> str:
    """Require a nonempty string."""
    if not isinstance(value, str) or not value:
        fail('Expected a nonempty string')
    return value


def number(value: object) -> float:
    """Require a finite, positive measurement rather than accepting booleans."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        fail('Expected a numeric measurement')
    try:
        result = float(value)
    except OverflowError:
        fail('Measurements must be finite and positive')
    if not math.isfinite(result) or result <= 0:
        fail('Measurements must be finite and positive')
    return result
