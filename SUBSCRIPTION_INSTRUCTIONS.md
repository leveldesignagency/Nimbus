# Subscription Setup Instructions

## ✅ Code Changes Complete

The extension code has been updated to:
- Check for active subscription before allowing word lookups
- Show upgrade prompt if subscription is inactive
- Block functionality until user subscribes

## 📋 Next Steps in Chrome Web Store Dashboard

### Step 1: Distribution Page
1. Select **"Contains in-app purchases"** (NOT "Free of charge")
2. Click **"Save draft"**

### Step 2: Store Listing Page
1. Scroll down to find **"In-app products"** section
2. Click **"Add in-app product"** or **"Create in-app product"**
3. Fill in:
   - **Product ID:** `nimbus_yearly_subscription`
   - **Type:** Subscription
   - **Price:** £1.49
   - **Billing period:** Yearly (12 months)
   - **Title:** "Nimbus Yearly Subscription"
   - **Description:** "Unlock unlimited word definitions, synonyms, and examples for one year"
4. Save the product

### Step 3: Test Before Submission
- Chrome Web Store allows you to test subscriptions before going live
- Use test accounts to verify the purchase flow works

## 💰 Revenue Details

- **Your Price:** £1.49/year
- **Chrome's Cut:** ~30% (~£0.45)
- **You Receive:** ~£1.04 per subscription
- **Auto-renewal:** Yes (users can cancel anytime)

## 🔧 Technical Details

- **Product ID:** `nimbus_yearly_subscription` (must match exactly in code)
- **Permission Added:** `"identity"` (required for payments API)
- **Subscription Check:** Runs before every word lookup
- **Upgrade Prompt:** Shows if subscription inactive

## ⚠️ Important Notes

1. **You MUST create the in-app product in the Store Listing before submission**
2. The extension will block all functionality until a subscription is active
3. Users will see an upgrade prompt when they try to use the extension
4. After purchase, functionality unlocks automatically

---

**Once you've added the in-app product, you can submit for review!**


