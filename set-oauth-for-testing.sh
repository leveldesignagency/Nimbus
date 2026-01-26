#!/bin/bash

# Script to set OAuth client ID for testing (unpacked mode)
# Usage: ./set-oauth-for-testing.sh [UNPACKED_EXTENSION_ID]

echo "🔧 Setting up OAuth for testing (unpacked mode)"
echo ""

if [ -z "$1" ]; then
  echo "❌ Error: Please provide your unpacked extension ID"
  echo ""
  echo "Usage: ./set-oauth-for-testing.sh [YOUR_UNPACKED_EXTENSION_ID]"
  echo ""
  echo "To get your unpacked extension ID:"
  echo "1. Go to chrome://extensions/"
  echo "2. Find 'Nimbus' extension"
  echo "3. Copy the Extension ID"
  echo ""
  exit 1
fi

UNPACKED_ID="$1"
PROD_CLIENT_ID="910760921542-kn4l16sg0b25egp8aitr9rt23gmc4fdr.apps.googleusercontent.com"

echo "📋 Unpacked Extension ID: $UNPACKED_ID"
echo ""
echo "⚠️  IMPORTANT: You need to create an OAuth client for this ID first!"
echo ""
echo "Steps:"
echo "1. Go to: https://console.cloud.google.com/apis/credentials"
echo "2. Click '+ CREATE CREDENTIALS' → 'OAuth client ID'"
echo "3. Application type: Chrome App"
echo "4. Application ID: $UNPACKED_ID"
echo "5. Copy the Client ID you get"
echo ""
read -p "Enter the OAuth Client ID for your unpacked extension: " TEST_CLIENT_ID

if [ -z "$TEST_CLIENT_ID" ]; then
  echo "❌ No client ID provided. Exiting."
  exit 1
fi

echo ""
echo "✅ Adding OAuth client ID to manifest.json..."

# Backup manifest
cp manifest.json manifest.json.backup

# Remove existing oauth2 if present, then add new one
python3 << EOF
import json
import sys

try:
    with open('manifest.json', 'r') as f:
        manifest = json.load(f)
    
    # Remove existing oauth2
    if 'oauth2' in manifest:
        del manifest['oauth2']
    
    # Add new oauth2
    manifest['oauth2'] = {
        "client_id": "$TEST_CLIENT_ID",
        "scopes": [
            "https://www.googleapis.com/auth/userinfo.email"
        ]
    }
    
    with open('manifest.json', 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print("✅ OAuth client ID added to manifest.json")
    print("")
    print("🔄 Now:")
    print("1. Reload the extension in chrome://extensions/")
    print("2. Test 'Sign in with Google'")
    print("")
    print("📝 To restore production OAuth client ID:")
    print("   Run: ./set-oauth-for-production.sh")
    
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
EOF



