# How to Get Stripe API Keys

## Step 1: Create Stripe Account

1. Go to https://stripe.com
2. Click **"Start now"** or **"Sign up"**
3. Enter your email and create a password
4. Verify your email address

## Step 2: Complete Account Setup

1. Fill in your business details:
   - Business name
   - Business type
   - Country
   - Address
2. Add payment information (bank account for payouts)

## Step 3: Get Your API Keys

1. Once logged in, go to **Developers** → **API keys** (in the left sidebar)
2. You'll see two keys:

### Test Mode Keys (for testing):
- **Publishable key**: Starts with `pk_test_...`
- **Secret key**: Starts with `sk_test_...` (click "Reveal test key" to see it)

### Live Mode Keys (for production):
- **Publishable key**: Starts with `pk_live_...`
- **Secret key**: Starts with `sk_live_...` (click "Reveal live key" to see it)

## Step 4: Add Keys to Vercel

1. Go to your Vercel dashboard: https://vercel.com
2. Select your project: `nimbus-api`
3. Go to **Settings** → **Environment Variables**
4. Add these variables:

**For Testing (use test keys):**
```
STRIPE_SECRET_KEY = sk_test_...
STRIPE_PUBLISHABLE_KEY = pk_test_...
```

**For Production (use live keys):**
```
STRIPE_SECRET_KEY = sk_live_...
STRIPE_PUBLISHABLE_KEY = pk_live_...
```

5. Click **Save**
6. **Redeploy** your project (go to Deployments → click "..." → Redeploy)

## Step 5: Test Payment

Use Stripe's test card numbers:
- **Card number**: `4242 4242 4242 4242`
- **Expiry**: Any future date (e.g., 12/25)
- **CVC**: Any 3 digits (e.g., 123)
- **ZIP**: Any 5 digits (e.g., 12345)

## Important Notes

- **Test mode** is free - no real charges
- **Live mode** requires account verification and bank details
- Start with test mode to verify everything works
- Switch to live mode when ready to accept real payments



