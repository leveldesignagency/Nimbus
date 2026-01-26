# Final Setup Checklist - Live Keys Added ✅

## ✅ What You've Done:
- [x] Added `STRIPE_SECRET_KEY` (live) to Vercel
- [x] Added `STRIPE_PUBLISHABLE_KEY` (live) to Vercel
- [x] Selected "Contains in-app purchases" in Chrome Web Store

## ⚠️ Important: Did You Redeploy Vercel?

After adding environment variables, you **MUST** redeploy:

1. Go to Vercel dashboard
2. Your project → **Deployments** tab
3. Click **"..."** on the latest deployment
4. Click **"Redeploy"**

This ensures the new keys are loaded.

## 🧪 Testing with Live Keys

Even with live keys, you can test safely using Stripe's test cards:

**Test Card:**
- Number: `4242 4242 4242 4242`
- Expiry: Any future date (e.g., 12/25)
- CVC: Any 3 digits (e.g., 123)
- ZIP: Any 5 digits (e.g., 12345)

**Note:** Test cards won't charge real money, even with live keys.

## ✅ Test Checklist:

1. **Install extension** (unpacked or from store)
2. **Open hub** → Should show payment form
3. **Sign in with Google** → Email should appear
4. **Enter test card** → `4242 4242 4242 4242`
5. **Complete payment** → Should process successfully
6. **Extension unlocks** → All features should work

## 🚨 If Payment Fails:

Check Vercel logs:
1. Vercel dashboard → Your project → **Logs**
2. Look for errors in:
   - `/api/create-payment-intent`
   - `/api/confirm-subscription`
   - `/api/verify-license`

Common issues:
- Keys not loaded → **Redeploy Vercel**
- Wrong key format → Check keys start with `sk_live_` and `pk_live_`
- API errors → Check Stripe dashboard for details

## 🎯 Ready to Submit?

Once testing works:
1. ✅ Payment form appears
2. ✅ Google sign-in works
3. ✅ Payment processes
4. ✅ Extension unlocks after payment

You're ready to submit to Chrome Web Store!



