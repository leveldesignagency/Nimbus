#!/bin/bash

# Script to set OAuth client ID for production (Chrome Web Store)
# This uses the published extension ID OAuth client

echo "🔧 Setting up OAuth for production (Chrome Web Store)"
echo ""

PROD_CLIENT_ID="910760921542-kn4l16sg0b25egp8aitr9rt23gmc4fdr.apps.googleusercontent.com"
PROD_EXTENSION_ID="abmihilkdbamlelkmpfegjfimcjpcihh"

echo "📋 Production Extension ID: $PROD_EXTENSION_ID"
echo "📋 Production OAuth Client ID: $PROD_CLIENT_ID"
echo ""

# Backup manifest
cp manifest.json manifest.json.backup

# Remove existing oauth2 if present, then add production one
python3 << EOF
import json
import sys

try:
    with open('manifest.json', 'r') as f:
        manifest = json.load(f)
    
    # Remove existing oauth2
    if 'oauth2' in manifest:
        del manifest['oauth2']
    
    # Add production oauth2
    manifest['oauth2'] = {
        "client_id": "$PROD_CLIENT_ID",
        "scopes": [
            "https://www.googleapis.com/auth/userinfo.email"
        ]
    }
    
    with open('manifest.json', 'w') as f:
        json.dump(manifest, f, indent=2)
    
    print("✅ Production OAuth client ID added to manifest.json")
    print("")
    print("📦 Ready to create zip for Chrome Web Store!")
    
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
EOF



