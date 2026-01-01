# Vercel Setup Fix - Stripe & Email

## Fix Stripe "Sandbox" Issue

The code now uses **production Stripe keys by default**. To fix the "Sandbox" issue:

### In Vercel Dashboard:

1. Go to your project → Settings → Environment Variables
2. **Remove or unset these test variables** (if they exist):
   - `TEST_STRIPE_SECRET_KEY`
   - `TEST_STRIPE_PUBLISHABLE_KEY`
   - `TEST_STRIPE_WEBHOOK_SECRET`

3. **Ensure these production variables are set:**
   - `STRIPE_SECRET_KEY` (your live secret key starting with `sk_live_...`)
   - `STRIPE_PUBLISHABLE_KEY` (your live publishable key starting with `pk_live_...`)
   - `STRIPE_WEBHOOK_SECRET` (your live webhook secret, if using webhooks)

4. **Optional:** If you want to force test mode later, add:
   - `FORCE_TEST_MODE` = `true` (only set this if you want to use test keys)

**Important:** The code now prioritizes production keys. Even if test keys exist in your environment, it will use production keys unless `FORCE_TEST_MODE=true` is set.

## Set Up Resend for Email

### 1. Get Resend API Key

1. Sign up at [resend.com](https://resend.com) (free tier available)
2. Go to API Keys section
3. Create a new API key
4. Copy the API key (starts with `re_`)

### 2. Add to Vercel

1. Go to Vercel project → Settings → Environment Variables
2. Add:
   - **Key:** `RESEND_API_KEY`
   - **Value:** Your Resend API key
   - **Environment:** Production, Preview, Development (select all)

### 3. Verify Domain (Optional but Recommended)

1. In Resend dashboard, go to Domains
2. Add your domain (e.g., `leveldesignagency.com`)
3. Add the DNS records Resend provides
4. Wait for verification
5. Update `from` field in `vercel-api/api/send-email.js`:
   ```javascript
   from: 'Nimbus <nimbus@leveldesignagency.com>',
   ```

**Note:** Without domain verification, Resend will use `nimbus@resend.dev` as the sender (works but less professional).

## Email Address

All emails are now sent to: **leveldesignagency@gmail.com**

This includes:
- Subscription cancellation requests
- Refund notifications
- Trial cancellations
- Contact form submissions
- Subscription reactivations

## After Making Changes

1. **Redeploy** your Vercel project (or wait for auto-deploy if connected to GitHub)
2. Test the checkout - it should no longer show "Sandbox"
3. Test email sending - check your inbox at leveldesignagency@gmail.com

## Troubleshooting

- **Still seeing "Sandbox"?** Make sure `TEST_STRIPE_SECRET_KEY` is removed from Vercel env vars
- **Emails not sending?** Check Vercel function logs for Resend API errors
- **Need to test?** Temporarily set `FORCE_TEST_MODE=true` in Vercel env vars

