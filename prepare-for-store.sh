#!/bin/bash
# Script to prepare Nimbus extension for Chrome Web Store submission

echo "🚀 Preparing Nimbus extension for Chrome Web Store..."

# Create a clean directory for the store package
STORE_DIR="nimbus-store-package"
rm -rf "$STORE_DIR"
mkdir -p "$STORE_DIR"

# Copy required files
echo "📦 Copying extension files..."
cp manifest.json "$STORE_DIR/"
cp background.js "$STORE_DIR/"
cp contentScript.js "$STORE_DIR/"
cp popup.html "$STORE_DIR/"
cp popup.js "$STORE_DIR/"
cp options.html "$STORE_DIR/"
cp options.js "$STORE_DIR/"
cp tooltip.css "$STORE_DIR/"

# Copy assets directory
echo "🖼️  Copying assets..."
cp -r assets "$STORE_DIR/"

# Copy logo and favicon (if needed)
cp "Nimbus Logo-02.svg" "$STORE_DIR/" 2>/dev/null || true
cp "Nimbus Favicon.png" "$STORE_DIR/" 2>/dev/null || true

# Create zip file
echo "📦 Creating zip package..."
cd "$STORE_DIR"
zip -r ../nimbus-extension.zip . -x "*.DS_Store" "*.git*"
cd ..

echo "✅ Package created: nimbus-extension.zip"
echo "📋 Next steps:"
echo "   1. Review the package contents"
echo "   2. Create store listing assets (screenshots, promotional images)"
echo "   3. Create privacy policy"
echo "   4. Upload to Chrome Web Store"

