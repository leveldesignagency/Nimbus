#!/bin/bash

echo "🔧 Temporarily disabling dev mode bypass for testing..."
echo ""

# Backup original files
cp popup.js popup.js.backup
cp contentScript.js contentScript.js.backup

echo "✅ Backed up original files"

# Disable dev mode in popup.js
sed -i '' 's/if (isDeveloperMode()) {/\/\/ TEMP DISABLED FOR TESTING\n  \/\/ if (isDeveloperMode()) {/g' popup.js
sed -i '' 's/return true;$/\/\/ return true;/g' popup.js | grep -A 5 "isDeveloperMode"

# Disable dev mode in contentScript.js  
sed -i '' 's/if (isDeveloperMode()) {/\/\/ TEMP DISABLED FOR TESTING\n  \/\/ if (isDeveloperMode()) {/g' contentScript.js
sed -i '' 's/return true;$/\/\/ return true;/g' contentScript.js | grep -A 5 "isDeveloperMode"

echo ""
echo "✅ Dev mode bypass disabled!"
echo ""
echo "📝 To restore:"
echo "   cp popup.js.backup popup.js"
echo "   cp contentScript.js.backup contentScript.js"
echo ""
echo "🔄 Now reload the extension in chrome://extensions/"




