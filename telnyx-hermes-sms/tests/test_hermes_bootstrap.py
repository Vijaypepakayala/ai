from pathlib import Path

from tests._hermes import find_hermes_root


def _write_fake_checkout(root: Path) -> Path:
    checkout = root / "hermes-agent"
    platform_base = checkout / "gateway" / "platforms" / "base.py"
    platform_base.parent.mkdir(parents=True)
    platform_base.write_text("# fake Hermes checkout\n")
    return checkout


def test_find_hermes_root_accepts_hermes_agent_root_parent_dir(monkeypatch, tmp_path):
    checkout = _write_fake_checkout(tmp_path / ".hermes")
    monkeypatch.setenv("HERMES_AGENT_ROOT", str(checkout.parent))
    monkeypatch.delenv("HERMES_HOME", raising=False)
    assert find_hermes_root() == checkout


def test_find_hermes_root_accepts_hermes_home(monkeypatch, tmp_path):
    checkout = _write_fake_checkout(tmp_path / ".hermes")
    monkeypatch.delenv("HERMES_AGENT_ROOT", raising=False)
    monkeypatch.setenv("HERMES_HOME", str(checkout.parent))
    assert find_hermes_root() == checkout


def test_find_hermes_root_prefers_package_adjacent_checkout_for_external_cwd(
    monkeypatch,
    tmp_path,
):
    checkout = _write_fake_checkout(tmp_path / "external")
    package_root = tmp_path / "external" / "telnyx-hermes-sms"
    fake_module = package_root / "tests" / "_hermes.py"
    fake_module.parent.mkdir(parents=True)
    fake_module.write_text("# fake bootstrap module\n")

    unrelated_cwd = tmp_path / "somewhere-else" / "workspace"
    unrelated_cwd.mkdir(parents=True)

    monkeypatch.delenv("HERMES_AGENT_ROOT", raising=False)
    monkeypatch.delenv("HERMES_HOME", raising=False)

    assert find_hermes_root(cwd=unrelated_cwd, module_file=fake_module) == checkout
