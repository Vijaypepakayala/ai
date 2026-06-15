import os
import sys
from pathlib import Path

import pytest


def find_hermes_root() -> Path | None:
    """Locate a Hermes Agent checkout for tests that import gateway modules."""
    candidates = []
    env_root = os.getenv("HERMES_AGENT_ROOT")
    if env_root:
        candidates.append(Path(env_root).expanduser())
    candidates.extend([
        Path.cwd().parent / "hermes-agent",
        Path.home() / ".hermes" / "hermes-agent",
    ])
    for candidate in candidates:
        if (candidate / "gateway" / "platforms" / "base.py").exists():
            return candidate
    return None


def ensure_hermes_on_path() -> Path:
    """Add the Hermes checkout to sys.path or skip with setup guidance."""
    hermes_root = find_hermes_root()
    if hermes_root is None:
        pytest.skip(
            "Hermes Agent checkout not found. Set HERMES_AGENT_ROOT to a local "
            "hermes-agent checkout, or clone Hermes to ~/.hermes/hermes-agent "
            "before running runtime/live tests.",
            allow_module_level=True,
        )
    if str(hermes_root) not in sys.path:
        sys.path.insert(0, str(hermes_root))
    return hermes_root
