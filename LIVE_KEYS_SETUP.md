# Live Stripe Keys Setup - Production Ready

## ✅ You've Added Live Keys - Good!

You've added your **live Stripe keys** to Vercel, which means:
- ✅ Ready for **real payments** from users
- ✅ Production-ready setup
- ⚠️ **Important**: Test thoroughly before going live!

## Testing with Live Keys

Even with live keys, you can test using Stripe's test card numbers:

### Test Cards (work with live keys):
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires 3D Secure**: `4000 0025 0000 3155`

**Test Details:**
- **Expiry**: Any future date (e.g., 12/25)
- **CVC**: Any 3 digits (e.g., 123)
- **ZIP**: Any 5 digits (e.g., 12345)

## Next Steps

1. **Test the Payment Flow:**
   - Install extension
   - Open hub → Sign in with Google
   - Enter test card: `4242 4242 4242 4242`
   - Complete payment
   - Verify extension unlocks

2. **Check Vercel Logs:**
   - Go to Vercel dashboard → Your project → Logs
   - Watch for any errors during payment

3. **Verify API Endpoints:**
   - `/api/create-payment-intent` - Should create payment session
   - `/api/verify-license` - Should verify subscription
   - `/api/confirm-subscription` - Should confirm after payment

## Important Notes

- **Live keys = Real money**: Be careful testing - use test cards only
- **Stripe Dashboard**: Check https://dashboard.stripe.com/test/payments to see test transactions
- **Switch to Test Mode**: If you want to test without any risk, you can temporarily switch to test keys in Vercel

## Ready to Deploy?

Once you've tested and everything works:
1. ✅ Extension blocks without payment
2. ✅ Google sign-in works
3. ✅ Payment form appears
4. ✅ Payment processes successfully
5. ✅ Extension unlocks after payment

You're ready to submit to Chrome Web Store!



