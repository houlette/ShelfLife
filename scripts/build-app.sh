#!/bin/bash
# Build ShelfLife.app
# Run once after cloning (or after updating the frontend) to produce the
# double-clickable app bundle in the project root.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$PROJECT/scripts"
APP="$PROJECT/ShelfLife.app"
CONTENTS="$APP/Contents"

echo "▶ Building frontend…"
cd "$PROJECT/frontend"
npm run build

echo "▶ Assembling ShelfLife.app…"
rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

cp "$SCRIPTS/app-bundle/Info.plist" "$CONTENTS/Info.plist"
# Substitute the real project path into the launcher template
sed "s|__PROJECT__|$PROJECT|g" "$SCRIPTS/app-bundle/MacOS/ShelfLife" > "$CONTENTS/MacOS/ShelfLife"
chmod +x "$CONTENTS/MacOS/ShelfLife"

echo "▶ Generating icon…"
"$PROJECT/.venv/bin/python3" "$SCRIPTS/make_icon.py" "$CONTENTS/Resources/AppIcon.icns"

echo ""
echo "✓ ShelfLife.app is ready."
echo "  • Double-click $APP to launch"
echo "  • Drag it to your Dock or Desktop for quick access"
echo "  • Re-run this script after frontend changes"
