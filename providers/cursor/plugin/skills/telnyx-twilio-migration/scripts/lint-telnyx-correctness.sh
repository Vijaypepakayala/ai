#!/usr/bin/env bash
# Compatibility entrypoint for the language-aware Telnyx correctness linter.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: lint-telnyx-correctness.sh requires Python 3.8+" >&2
  exit 2
fi

exec python3 "$SCRIPT_DIR/lint_telnyx_correctness.py" "$@"
