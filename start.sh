#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Backend
echo "Starting backend..."
cd "$ROOT/backend"
"$ROOT/.venv/bin/uvicorn" main:app --host 0.0.0.0 --port 8001 --reload &
BACKEND_PID=$!

# Frontend
echo "Starting frontend..."
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  ShelfLife running at http://localhost:5174"
echo "  API docs at         http://localhost:8001/docs"
echo ""
echo "  Press Ctrl+C to stop"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
