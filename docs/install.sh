#!/usr/bin/env bash
# The Fluzy AI installer moved to https://raw.githubusercontent.com/frRitamDas/fluzyai/main/docs/install.sh
# This shim keeps old `curl ... github.io ... | bash` one-liners working.
set -euo pipefail
exec bash -c "$(curl -fsSL https://raw.githubusercontent.com/frRitamDas/fluzyai/main/docs/install.sh)"
