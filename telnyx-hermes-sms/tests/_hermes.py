import os
import sys
from pathlib import Path

import pytest


def _candidate_roots(root: Path) -> list[Path]:
    """Accept either a checkout root or its Hermes home parent directory."""
    expanded = root.expanduser()
    candidates = [expanded]
    if expanded.name != "hermes-agent":
        candidates.append(expanded / "hermes-agent")
    return candidates


def find_hermes_root() -> Path | None:
    """Locate a Hermes Agent checkout for tests that import gateway modules."""
    candidates = []
    env_root = os.getenv("HERMES_AGENT_ROOT")
    if env_root:
        candidates.extend(_candidate_roots(Path(env_root)))
    env_home = os.getenv("HERMES_HOME")
    if env_home:
        candidates.extend(_candidate_roots(Path(env_home)))
    candidates.extend([
        Path.cwd().parent / "hermes-agent",
        Path.home() / ".hermes",
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
            "Hermes Agent checkout not found. Set HERMES_AGENT_ROOT to the "
            "hermes-agent checkout (or its parent Hermes home), set HERMES_HOME "
            "to the Hermes home directory, or clone Hermes to "
            "~/.hermes/hermes-agent before running runtime/live tests.",
            allow_module_level=True,
        )
    if str(hermes_root) not in sys.path:
        sys.path.insert(0, str(hermes_root))
    return hermes_root
