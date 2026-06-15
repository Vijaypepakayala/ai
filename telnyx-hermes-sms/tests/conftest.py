import sys

from tests._hermes import find_hermes_root


HERMES_ROOT = find_hermes_root()
if HERMES_ROOT is not None and str(HERMES_ROOT) not in sys.path:
    sys.path.insert(0, str(HERMES_ROOT))


def _ensure_telnyx_sms_registered():
    """Pre-register telnyx_sms so Platform('telnyx_sms') works in all tests."""
    try:
        from gateway.platform_registry import PlatformEntry, platform_registry
    except (ImportError, ModuleNotFoundError):
        return

    if not platform_registry.is_registered("telnyx_sms"):
        platform_registry.register(
            PlatformEntry(
                name="telnyx_sms",
                label="Telnyx SMS",
                adapter_factory=lambda cfg: None,
                check_fn=lambda: True,
            )
        )


_ensure_telnyx_sms_registered()
