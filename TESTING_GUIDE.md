# Testing Guide - Subscription Verification Fixes

## Method 1: Test API Directly (Fastest - No Extension Needed)

### Test the verify-license endpoint:

```bash
# Replace YOUR_EMAIL with your actual email from Stripe
curl -X POST https://nimbus-api-ten.vercel.app/api/verify-license \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"YOUR_EMAIL@example.com"}'
```

**Expected Response (if subscription is active):**
```json
{
  "valid": true,
  "subscriptionId": "sub_xxxxx",
  "customerId": "cus_xxxxx",
  "status": "active",
  "expiryDate": "2026-01-01T00:00:00.000Z",
  "email": "your@email.com",
  ...
}
```

**If you get an error**, check:
- Is the email correct? (must match exactly in Stripe)
- Is the subscription active in Stripe dashboard?
- Has Vercel deployed the latest code? (check deployment status)

---

## Method 2: Test in Unpacked Extension (With Real Subscription Check)

### Step 1: Temporarily Disable Dev Mode Bypass

Edit `popup.js` and `contentScript.js` - comment out the dev mode bypass:

**In popup.js (around line 189):**
```javascript
async function checkSubscription() {
  // TEMPORARILY DISABLED FOR TESTING
  // if (isDeveloperMode()) {
  //   console.log('🔧 [DEV MODE] Developer mode detected - bypassing subscription check');
  //   ...
  //   return true;
  // }
  
  // Continue with real subscription check...
}
```

**In contentScript.js (around line 132):**
```javascript
async function checkSubscription() {
  // TEMPORARILY DISABLED FOR TESTING
  // if (isDeveloperMode()) {
  //   ...
  //   return true;
  // }
  
  // Continue with real subscription check...
}
```

### Step 2: Load Extension in Unpacked Mode

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select: `/Users/charlesmorgan/Documents/CursorIQ`
5. Open the extension popup

### Step 3: Check Console Logs

Open DevTools (F12 or right-click popup → Inspect) and look for:
- `[SUBSCRIPTION CHECK]` logs
- `[VERIFY SUBSCRIPTION]` logs
- `[GOOGLE LOGIN]` logs

### Step 4: Test Verify Subscription Button

1. Go to subscription tab in popup
2. Click "Already paid? Verify Subscription"
3. Check console for detailed logs
4. Should see: `[VERIFY SUBSCRIPTION] Response data: {...}`

---

## Method 3: Check Vercel Deployment Status

### Check if API fix is deployed:

1. Go to: https://vercel.com
2. Login to your account
3. Find project: `nimbus-api`
4. Check "Deployments" tab
5. Look for latest deployment (should be recent, within last few minutes)
6. Status should be "Ready" (green)

### Test deployment directly:

```bash
# This should return the fixed version (with customer email retrieval)
curl -X POST https://nimbus-api-ten.vercel.app/api/verify-license \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"test@example.com"}' \
  -v
```

**Check the response** - it should NOT have `undefined` in the email field.

---

## Method 4: Test with Published Extension (After Update)

### Step 1: Wait for Chrome Web Store Update

1. Submit new zip package (version 1.0.14)
2. Wait for Chrome to approve (usually 1-3 days)
3. Extension will auto-update for users

### Step 2: Test on Your Account

1. Remove extension completely
2. Reinstall from Chrome Web Store
3. Sign in with Google
4. Click "Verify Subscription"
5. Should work now!

---

## Method 5: Quick API Health Check

### Test all endpoints:

```bash
# 1. Verify License
curl -X POST https://nimbus-api-ten.vercel.app/api/verify-license \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"YOUR_EMAIL"}'

# 2. Get Session (if you have a session ID)
curl -X POST https://nimbus-api-ten.vercel.app/api/get-session \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"cs_test_xxxxx"}'

# 3. Create Portal Session
curl -X POST https://nimbus-api-ten.vercel.app/api/create-portal-session \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_EMAIL","subscriptionId":"sub_xxxxx"}'
```

---

## What to Look For in Console Logs

### Good Signs (Working):
```
[SUBSCRIPTION CHECK] Starting check: { hasSubscriptionId: true, ... }
[SUBSCRIPTION CHECK] API response data: { valid: true, ... }
[VERIFY SUBSCRIPTION] Subscription is valid!
```

### Bad Signs (Still Broken):
```
[VERIFY SUBSCRIPTION] HTTP error: 500
[SUBSCRIPTION CHECK] API verification exception: ...
Error verifying license key
```

---

## Debugging Checklist

- [ ] Vercel deployment is live (check dashboard)
- [ ] API returns valid JSON (test with curl)
- [ ] Email matches exactly in Stripe dashboard
- [ ] Subscription status is "active" or "trialing" in Stripe
- [ ] Console logs show detailed error messages
- [ ] No `undefined` in API responses
- [ ] Extension has correct API URL (`https://nimbus-api-ten.vercel.app/api`)

---

## Quick Test Script

Save this as `test-api.sh`:

```bash
#!/bin/bash

EMAIL="your@email.com"  # Replace with your email

echo "Testing verify-license API..."
curl -X POST https://nimbus-api-ten.vercel.app/api/verify-license \
  -H "Content-Type: application/json" \
  -d "{\"licenseKey\":\"$EMAIL\"}" \
  | jq '.'  # Pretty print JSON (install jq: brew install jq)

echo ""
echo "✅ If you see 'valid: true', the API is working!"
```

Run: `chmod +x test-api.sh && ./test-api.sh`




