#!/usr/bin/env bash
# One-command launcher: sets up deps on first run, starts backend + frontend,
# opens the dashboard in the default browser.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
info() { printf "\033[36m▸\033[0m %s\n" "$*"; }
warn() { printf "\033[33m⚠\033[0m %s\n" "$*"; }

# ----- shutdown hook -----
cleanup() {
  echo ""
  info "shutting down…"
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ----- backend setup -----
bold "Backend"
if [[ ! -d "$BACKEND/.venv" ]]; then
  info "creating Python venv"
  python3 -m venv "$BACKEND/.venv"
fi
if [[ ! -f "$BACKEND/.venv/.deps_ok" ]]; then
  info "installing backend dependencies (first run)"
  "$BACKEND/.venv/bin/pip" install --quiet --upgrade pip
  "$BACKEND/.venv/bin/pip" install --quiet \
    fastapi "uvicorn[standard]" pandas numpy scipy statsmodels openpyxl python-multipart pyarrow \
    pytest httpx
  touch "$BACKEND/.venv/.deps_ok"
fi

# Seed DB from the source file if the DB doesn't exist yet
if [[ ! -f "$BACKEND/data/vlcc.db" ]]; then
  info "seeding SQLite (ingest + calibrate VLCC/Suezmax)"
  (cd "$BACKEND" && PYTHONPATH=. .venv/bin/python scripts/seed_from_source.py)
fi

# ----- frontend setup -----
bold "Frontend"
if [[ ! -d "$FRONTEND/node_modules" ]]; then
  info "installing frontend dependencies (first run, may take a minute)"
  (cd "$FRONTEND" && npm install --silent --no-fund --no-audit)
fi

# ----- start servers -----
bold "Starting servers"
(cd "$BACKEND" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" --log-level warning) \
  > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
info "backend pid $BACKEND_PID → $BACKEND_URL"

(cd "$FRONTEND" && npx vite --host 127.0.0.1 --port "$FRONTEND_PORT") \
  > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
info "frontend pid $FRONTEND_PID → $FRONTEND_URL"

# ----- wait for both to come up -----
for i in {1..30}; do
  if curl -sf -o /dev/null "$BACKEND_URL/health" && curl -sf -o /dev/null "$FRONTEND_URL/"; then
    break
  fi
  sleep 0.5
done

if ! curl -sf -o /dev/null "$BACKEND_URL/health"; then
  warn "backend did not respond on $BACKEND_URL — see $LOG_DIR/backend.log"
fi
if ! curl -sf -o /dev/null "$FRONTEND_URL/"; then
  warn "frontend did not respond on $FRONTEND_URL — see $LOG_DIR/frontend.log"
fi

# ----- open browser -----
if command -v open >/dev/null 2>&1; then
  open "$FRONTEND_URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$FRONTEND_URL"
fi

bold "Running"
echo "  • Dashboard: $FRONTEND_URL"
echo "  • API:       $BACKEND_URL/docs"
echo "  • Logs:      $LOG_DIR/"
echo ""
echo "Press Ctrl-C to stop."

wait
