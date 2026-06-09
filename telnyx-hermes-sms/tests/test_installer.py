from pathlib import Path
import subprocess
import sys

import pytest

from telnyx_hermes_sms import installer


def test_install_plugin_writes_expected_files(tmp_path):
    written = installer.install_plugin(tmp_path)

    assert [path.name for path in written] == [
        "__init__.py",
        "adapter.py",
        "plugin.yaml",
        ".env.example",
    ]
    assert (tmp_path / "__init__.py").read_text() == installer.INIT_FILE
    assert (tmp_path / "adapter.py").read_text() == (Path(__file__).resolve().parents[1] / "adapter.py").read_text()
    assert "name: telnyx-sms-platform" in (tmp_path / "plugin.yaml").read_text()
    assert "TELNYX_API_KEY" in (tmp_path / ".env.example").read_text()


def test_install_plugin_requires_force_for_existing_files(tmp_path):
    installer.install_plugin(tmp_path)

    with pytest.raises(FileExistsError):
        installer.install_plugin(tmp_path)


def test_install_plugin_force_overwrites_existing_files(tmp_path):
    installer.install_plugin(tmp_path)
    init_path = tmp_path / "__init__.py"
    init_path.write_text("stale")

    installer.install_plugin(tmp_path, force=True)

    assert init_path.read_text() == installer.INIT_FILE


def test_main_installs_plugin_and_prints_next_steps(tmp_path, capsys):
    exit_code = installer.main(["--target-dir", str(tmp_path)])

    assert exit_code == 0
    assert (tmp_path / "__init__.py").exists()
    assert (tmp_path / "adapter.py").exists()
    assert (tmp_path / "plugin.yaml").exists()
    assert (tmp_path / ".env.example").exists()

    captured = capsys.readouterr()
    assert f"Installed Telnyx Hermes SMS plugin to {tmp_path}" in captured.out
    assert "hermes plugins enable telnyx-sms-platform" in captured.out
    assert "gateway.platforms.telnyx_sms.enabled: true" in captured.out


def test_python_m_entrypoint_installs_plugin(tmp_path):
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "telnyx_hermes_sms",
            "--target-dir",
            str(tmp_path),
        ],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "__init__.py").exists()
    assert "Installed Telnyx Hermes SMS plugin" in result.stdout
