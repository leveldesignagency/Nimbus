# Email Setup with Resend

## What Emails Are Sent

The extension sends email notifications to **charles@leveldesignagency.com** for:

1. **Subscription Cancellation Requests** - When a user cancels their subscription (at period end)
2. **Subscription Cancelled & Refunded** - When a user cancels within 7 days and receives an auto-refund
3. **Trial Cancellation** - When a user cancels during the trial period
4. **Refund Request Processed** - When a user manually requests a refund (within 7 days)
5. **Subscription Reactivated** - When a user resubscribes after cancelling

## Setup Instructions

### 1. Get Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Go to API Keys section
3. Create a new API key
4. Copy the API key

### 2. Add to Vercel Environment Variables

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add a new variable:
   - **Key:** `RESEND_API_KEY`
   - **Value:** Your Resend API key (starts with `re_`)
   - **Environment:** Production, Preview, Development (select all)

### 3. Verify Your Domain (Optional but Recommended)

1. In Resend dashboard, go to Domains
2. Add your domain (e.g., `leveldesignagency.com`)
3. Add the DNS records Resend provides to your domain
4. Wait for verification
5. Update the `from` field in `vercel-api/api/send-email.js`:
   ```javascript
   from: 'Nimbus <nimbus@leveldesignagency.com>',
   ```

### 4. Test Email

After setting up, test by:
1. Cancelling a subscription in the extension
2. Check Vercel function logs for any errors
3. Check your email inbox

## Current Email Address

All emails are sent to: **charles@leveldesignagency.com**

To change this, update the `to` field in:
- `vercel-api/api/cancel-subscription.js`
- `vercel-api/api/process-refund.js`

## Troubleshooting

- If emails aren't sending, check Vercel function logs
- Make sure `RESEND_API_KEY` is set in Vercel environment variables
- Verify your domain if using a custom domain
- Check Resend dashboard for delivery status

