# Stripe Payment System Setup - URGENT

## ✅ Code Implementation Complete

I've implemented a complete Stripe-based payment system to replace Chrome Web Store in-app purchases. The extension now:

1. ✅ Blocks all functionality without payment
2. ✅ Opens Stripe checkout when users click "Subscribe"
3. ✅ Verifies license keys via API
4. ✅ Allows users to enter license keys manually
5. ✅ Checks subscription status on every use

## 🚨 IMMEDIATE ACTION REQUIRED

### Step 1: Set Up Stripe Account (5 minutes)

1. Go to https://stripe.com and create an account (or log in)
2. Get your API keys:
   - Go to **Developers** → **API keys**
   - Copy your **Publishable key** (starts with `pk_`)
   - Copy your **Secret key** (starts with `sk_`) - click "Reveal test key" if needed

### Step 2: Add Stripe Keys to Vercel (2 minutes)

1. Go to your Vercel dashboard: https://vercel.com
2. Select your project: `nimbus-api`
3. Go to **Settings** → **Environment Variables**
4. Add these variables:

```
STRIPE_SECRET_KEY = sk_test_... (your Stripe secret key)
STRIPE_PUBLISHABLE_KEY = pk_test_... (your Stripe publishable key)
STRIPE_WEBHOOK_SECRET = (leave empty for now, we'll add this later)
```

5. Click **Save**
6. **Redeploy** your Vercel project (go to Deployments → click "..." → Redeploy)

### Step 3: Deploy Updated API Files (2 minutes)

The new API files are ready in `/vercel-api/api/`:
- `create-checkout.js` - Creates Stripe checkout sessions
- `verify-license.js` - Verifies license keys
- `stripe-webhook.js` - Handles payment webhooks (optional, for auto-activation)

**Push to GitHub:**
```bash
cd /Users/charlesmorgan/Documents/CursorIQ
git add vercel-api/
git commit -m "Add Stripe payment system"
git push origin main
```

Vercel will auto-deploy.

### Step 4: Test the System (5 minutes)

1. **Test Checkout:**
   - Install the extension
   - Try to use it (should show upgrade prompt)
   - Click "Subscribe Now"
   - Should open Stripe checkout page

2. **Test License Key:**
   - After payment, Stripe will give you a subscription ID
   - Enter it in the extension's license key field
   - Should activate immediately

### Step 5: Set Up Webhook (Optional - for auto-activation)

1. In Stripe dashboard: **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://nimbus-api-ten.vercel.app/api/stripe-webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the **Signing secret** (starts with `whsec_`)
6. Add to Vercel environment variables:
   - `STRIPE_WEBHOOK_SECRET = whsec_...`
7. Redeploy Vercel

## 📋 How It Works

1. **User clicks "Subscribe":**
   - Extension calls `/api/create-checkout`
   - Opens Stripe checkout page in new tab
   - User completes payment

2. **After Payment:**
   - Stripe provides subscription ID
   - User enters subscription ID as license key in extension
   - Extension verifies via `/api/verify-license`
   - License is saved locally
   - Extension unlocks

3. **Ongoing Verification:**
   - Extension checks license on every use
   - Verifies with server (with local cache fallback)
   - Blocks access if expired or invalid

## 💰 Pricing

- **Price:** £4.99/year (set in `create-checkout.js` line 35)
- **Stripe Fee:** ~2.9% + £0.20 per transaction
- **You Receive:** ~£4.65 per subscription

## 🔧 Files Changed

**Extension:**
- `contentScript.js` - Updated subscription check to use license keys
- `popup.js` - Added Stripe checkout and license key input

**API:**
- `vercel-api/api/create-checkout.js` - Creates Stripe sessions
- `vercel-api/api/verify-license.js` - Verifies licenses
- `vercel-api/api/stripe-webhook.js` - Handles webhooks

## ⚠️ Important Notes

1. **License Key Format:** Users enter their Stripe subscription ID (e.g., `sub_1234567890`)
2. **Testing:** Use Stripe test mode first (keys start with `pk_test_` and `sk_test_`)
3. **Production:** Switch to live keys when ready (`pk_live_` and `sk_live_`)
4. **Email Receipts:** Stripe automatically sends receipts to customers

## 🎯 Next Steps

1. ✅ Set up Stripe account
2. ✅ Add keys to Vercel
3. ✅ Deploy API files
4. ✅ Test checkout flow
5. ✅ Update extension version and submit to Chrome Web Store

The extension is **fully blocking** without payment and ready to accept payments immediately once Stripe is configured!



