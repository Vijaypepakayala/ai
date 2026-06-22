#!/usr/bin/env bash

set -euo pipefail

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required for the recommended local install path." >&2
  echo "Install uv from https://docs.astral.sh/uv/getting-started/installation/ and re-run ./install.sh." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$repo_root"
uv run --python 3.12 --with . telnyx-hermes-sms-install "$@"
