import ast
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_plugin_manifest_is_platform():
    manifest = yaml.safe_load((ROOT / 'plugin.yaml').read_text())
    assert manifest['name'] == 'telnyx-sms-platform'
    assert manifest['label'] == 'Telnyx SMS'
    assert manifest['kind'] == 'platform'
    required = {item['name'] for item in manifest['requires_env']}
    assert {'TELNYX_API_KEY', 'TELNYX_SMS_FROM_NUMBER'} <= required
    optional = {item['name'] for item in manifest['optional_env']}
    assert 'TELNYX_SMS_ALLOWED_USERS' in optional
    assert 'TELNYX_SMS_HOME_CHANNEL' in optional


def test_register_platform_shape():
    tree = ast.parse((ROOT / 'adapter.py').read_text())
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
    register_calls = [
        call for call in calls
        if isinstance(call.func, ast.Attribute) and call.func.attr == 'register_platform'
    ]
    assert register_calls, 'adapter must call ctx.register_platform(...)'
    keywords = {kw.arg: kw.value for kw in register_calls[0].keywords}
    assert keywords['name'].value == 'telnyx_sms'
    assert keywords['label'].value == 'Telnyx SMS'
    assert keywords['allowed_users_env'].value == 'TELNYX_SMS_ALLOWED_USERS'
    assert keywords['allow_all_env'].value == 'TELNYX_SMS_ALLOW_ALL_USERS'
    assert keywords['cron_deliver_env_var'].value == 'TELNYX_SMS_HOME_CHANNEL'
    assert keywords['pii_safe'].value is True


def test_api_constants():
    tree = ast.parse((ROOT / 'adapter.py').read_text())
    constants = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                constants[node.targets[0].id] = ast.literal_eval(node.value)
            except Exception:
                continue

    assert constants['TELNYX_API_BASE'] == 'https://api.telnyx.com/v2'
    assert constants['DEFAULT_WEBHOOK_PATH'] == '/webhooks/telnyx/sms'
    assert constants['MAX_SMS_LENGTH'] == 1600
    assert "TELNYX_MESSAGES_URL = f\"{TELNYX_API_BASE}/messages\"" in (ROOT / 'adapter.py').read_text()


def test_plugin_package_entrypoint_exists():
    init_file = ROOT / '__init__.py'
    assert init_file.exists(), 'Hermes directory plugins require __init__.py'
    text = init_file.read_text()
    assert 'register' in text


def test_manifest_documents_code_supported_env_vars():
    manifest = yaml.safe_load((ROOT / 'plugin.yaml').read_text())
    env_names = {item['name'] for block in ('requires_env', 'optional_env') for item in manifest.get(block, [])}
    assert 'TELNYX_SMS_API_BASE' in env_names
    assert 'TELNYX_SMS_SIGNATURE_TOLERANCE' in env_names


def test_env_example_includes_live_test_guard():
    env_example = (ROOT / '.env.example').read_text()
    assert 'TELNYX_SMS_LIVE_TEST=0' in env_example
    assert 'TELNYX_SMS_TEST_TO=' in env_example


def test_pyproject_declares_repo_named_installer_entrypoint():
    pyproject = (ROOT / 'pyproject.toml').read_text()
    assert 'telnyx-hermes-sms = "telnyx_hermes_sms.installer:main"' in pyproject
    assert 'telnyx-hermes-sms-install = "telnyx_hermes_sms.installer:main"' in pyproject


def test_skill_documents_installer_first_instead_of_manual_copy():
    skill = (ROOT / 'SKILL.md').read_text()
    assert 'uvx --from "git+https://github.com/team-telnyx/telnyx-hermes-sms.git" telnyx-hermes-sms' in skill
    assert 'uv tool install --python 3.12 "git+https://github.com/team-telnyx/telnyx-hermes-sms.git"' in skill
    assert 'cp __init__.py adapter.py plugin.yaml' not in skill


def test_readme_documents_hermes_checkout_contract():
    readme = (ROOT / 'README.md').read_text()
    assert 'Choose the path that matches your goal' in readme
    assert 'You do not need a local Hermes source\ncheckout just to install and enable the plugin' in readme
    assert "you do need a local\n`hermes-agent` checkout because the runtime and plugin-loading tests import" in readme
    assert '`HERMES_AGENT_ROOT` is only a locator; it does not replace the checkout' in readme
    assert 'Hermes checkout contract:' in readme
    assert 'not just the Hermes data directory such as `~/.hermes`' in readme
    assert 'export HERMES_AGENT_ROOT="$HOME/.hermes/hermes-agent"' in readme
    assert 'git clone https://github.com/NousResearch/hermes-agent.git "$HOME/.hermes/hermes-agent"' in readme
    assert 'the environment variable does not' in readme
    assert 'bootstrap or download Hermes for you' in readme
    assert 'test -d "$HERMES_AGENT_ROOT/gateway" -a -f "$HERMES_AGENT_ROOT/pyproject.toml"' in readme
    assert 'or just: export HERMES_AGENT_ROOT="$HERMES_HOME"' in readme
    assert 'Hermes-dependent test modules skip with an explicit setup message' in readme
    assert 'contributors reach the skip guidance' in readme
    assert '`Path | None` annotation' in readme
    assert 'Hermes-dependent tests skip with a Python-version message' in readme
    assert 'If you only want to validate the installer path from issue `#3`' in readme


def test_hermes_bootstrap_defers_annotation_evaluation():
    bootstrap = (ROOT / 'tests' / '_hermes.py').read_text()
    assert bootstrap.startswith('from __future__ import annotations')
    assert 'Hermes-dependent tests require Python 3.10+' in bootstrap
    assert 'git clone https://github.com/NousResearch/hermes-agent.git ' in bootstrap


def test_readme_and_bootstrap_script_document_download_first_install_path():
    readme = (ROOT / 'README.md').read_text()
    assert './install.sh' in readme

    script = (ROOT / 'install.sh').read_text()
    assert 'uv run --python 3.12 --with . telnyx-hermes-sms-install "$@"' in script
