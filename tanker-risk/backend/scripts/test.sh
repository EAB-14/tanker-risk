#!/usr/bin/env bash
# Run the backend regression suite.
set -e
cd "$(dirname "$0")/.."
PYTHONPATH=. .venv/bin/pytest -q "$@"
