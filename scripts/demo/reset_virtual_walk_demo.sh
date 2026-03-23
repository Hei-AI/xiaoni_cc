#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
"$ROOT_DIR/scripts/demo/clear_virtual_walk_demo.sh"
"$ROOT_DIR/scripts/demo/seed_virtual_walk_demo.sh"
