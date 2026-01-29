#!/bin/bash
# Push privacy policy to both Nimbus and nimbus-api repos.
# Run from: /Users/charlesmorgan/Documents/CursorIQ

set -e

echo "=== 1. Pushing Nimbus repo (index.html + vercel-api/public/privacy.html already committed) ==="
cd /Users/charlesmorgan/Documents/CursorIQ
git push origin main
echo "✅ Nimbus pushed."
echo ""

echo "=== 2. Adding privacy.html to nimbus-api repo and pushing ==="
WORK_DIR=$(mktemp -d)
trap "rm -rf $WORK_DIR" EXIT

git clone https://github.com/leveldesignagency/nimbus-api.git "$WORK_DIR/nimbus-api"
cp /Users/charlesmorgan/Documents/CursorIQ/vercel-api/public/privacy.html "$WORK_DIR/nimbus-api/public/"

cd "$WORK_DIR/nimbus-api"
git add public/privacy.html
git diff --staged --quiet && echo "privacy.html unchanged in nimbus-api, skipping commit" || git commit -m "Add privacy policy page for Chrome Web Store"
git push origin main
echo "✅ nimbus-api pushed."
echo ""

echo "Done. In 1–2 minutes check: https://nimbus-api-ten.vercel.app/privacy.html"
echo "Nimbus GitHub Pages (if enabled): https://leveldesignagency.github.io/Nimbus/"
