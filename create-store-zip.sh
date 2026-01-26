#!/bin/bash

# Create Chrome Web Store submission zip
# Excludes development files, docs, and git files

VERSION=$(grep '"version"' manifest.json | cut -d'"' -f4)
ZIP_NAME="nimbus-v${VERSION}-store.zip"

echo "Creating Chrome Web Store package: $ZIP_NAME"

# Remove old zip if exists
rm -f "$ZIP_NAME"

# Create zip with only necessary files
zip -r "$ZIP_NAME" \
  manifest.json \
  popup.html \
  popup.js \
  options.html \
  options.js \
  background.js \
  contentScript.js \
  tooltip.css \
  assets/ \
  "favicon_nimbus.png" \
  "Nimbus Favicon.png" \
  "Nimbus Logo-01.svg" \
  "Nimbus Logo-02.svg" \
  "NimbusLogo.svg" \
  ai.svg \
  -x "*.DS_Store" \
  -x "*/.git/*" \
  -x "*/node_modules/*" \
  -x "*/vercel-api/*" \
  -x "*.md" \
  -x "*.sh" \
  -x "*.zip" \
  -x "*/.vscode/*" \
  -x "*/__pycache__/*" \
  -x "*.pyc"

echo "✅ Created: $ZIP_NAME"
echo "📦 Size: $(du -h "$ZIP_NAME" | cut -f1)"
echo ""
echo "Ready to upload to Chrome Web Store!"

