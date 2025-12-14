# Setting Up £1.49/Year Subscription

## Step 1: In Chrome Web Store Dashboard

1. **Distribution Page:**
   - Select **"Contains in-app purchases"**
   - Click "Save draft"

2. **Store Listing Page:**
   - Scroll to **"In-app products"** section
   - Click **"Add in-app product"**
   - **Product ID:** `nimbus_yearly_subscription`
   - **Type:** Subscription
   - **Price:** £1.49
   - **Billing period:** Yearly
   - **Title:** "Nimbus Yearly Subscription"
   - **Description:** "Unlock unlimited word definitions, synonyms, and examples for one year"
   - Save the product

## Step 2: Code Changes

The extension code has been updated to:
- Check subscription status before allowing word lookups
- Show upgrade prompt if subscription is inactive
- Block functionality until user subscribes

## Step 3: Testing

After submission, you can test subscriptions using Chrome's test accounts:
- Go to Chrome Web Store Developer Dashboard
- Use test accounts to verify subscription flow

## Important Notes

- **Chrome takes ~30% cut** of subscription revenue
- You'll receive ~£1.04 per subscription after fees
- Subscriptions auto-renew unless cancelled
- Users can cancel anytime from Chrome settings

---

**Next:** Select "Contains in-app purchases" in Distribution, then we'll finish the code updates.


