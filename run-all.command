#!/bin/zsh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

clear
printf "Moonwalk Selfie Parade\n"
printf "Project: %s\n\n" "$PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed. Please install Node.js first."
  echo "Press Enter to close..."
  read -r
  exit 1
fi

NEED_INSTALL=0
for path in \
  "node_modules" \
  "apps/frontend/node_modules" \
  "apps/server/node_modules" \
  "apps/electron/node_modules"
do
  if [ ! -d "$path" ]; then
    NEED_INSTALL=1
    break
  fi
done

if [ "$NEED_INSTALL" -eq 1 ]; then
  echo "Installing dependencies (first run or missing modules)..."
  npm install
  npm run install:all
  echo
fi

echo "Starting all services..."
echo "- Server:   http://localhost:3000"
echo "- Frontend: http://localhost:5173"
echo

echo "Opening app routes in your browser..."
npm run dev:all:open
