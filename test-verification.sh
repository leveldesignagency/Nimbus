#!/bin/bash

echo "🔍 Testing Nimbus Subscription Verification API"
echo "================================================"
echo ""

# Get email from user
read -p "Enter your email (from Stripe): " EMAIL

if [ -z "$EMAIL" ]; then
  echo "❌ Email is required"
  exit 1
fi

echo ""
echo "📡 Testing API endpoint..."
echo "URL: https://nimbus-api-ten.vercel.app/api/verify-license"
echo "Email: $EMAIL"
echo ""

RESPONSE=$(curl -s -X POST https://nimbus-api-ten.vercel.app/api/verify-license \
  -H "Content-Type: application/json" \
  -d "{\"licenseKey\":\"$EMAIL\"}")

echo "Response:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
echo "✅ Check above for 'valid: true' - if you see it, the API is working!"
echo "❌ If you see errors, check:"
echo "   1. Email matches exactly in Stripe dashboard"
echo "   2. Subscription is active in Stripe"
echo "   3. Vercel deployment is live"
