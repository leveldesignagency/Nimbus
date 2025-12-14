# How to Get Your OpenAI API Key

## Step 1: Create an OpenAI Account
1. Go to [https://platform.openai.com](https://platform.openai.com)
2. Click **"Sign up"** or **"Log in"** if you already have an account
3. Complete the registration process

## Step 2: Add Payment Method
1. Go to **Settings** → **Billing**
2. Click **"Add payment method"**
3. Add a credit card or PayPal account
4. OpenAI requires a payment method even for free tier usage

## Step 3: Get Your API Key
1. Go to **Settings** → **API keys**
2. Click **"Create new secret key"**
3. Give it a name (e.g., "Nimbus Extension")
4. **Copy the key immediately** - you won't be able to see it again!
5. The key will look like: `sk-proj-...` or `sk-...`

## Step 4: Set Usage Limits (Important!)
1. Go to **Settings** → **Limits**
2. Set **Hard limit** to prevent unexpected charges:
   - Recommended: $50/month for testing
   - Production: Based on expected usage
3. Set **Soft limit** for warnings:
   - Recommended: $40/month

## Step 5: Monitor Usage
1. Go to **Usage** dashboard
2. Monitor your API calls and costs
3. Set up alerts for high usage

## Pricing Information

### GPT-4o-mini (Recommended - Cheapest)
- **Input**: $0.15 per 1M tokens
- **Output**: $0.60 per 1M tokens
- **Average query**: ~$0.00005 (5 cents per 1,000 queries)

### GPT-4o (More Powerful)
- **Input**: $2.50 per 1M tokens
- **Output**: $10.00 per 1M tokens
- **Average query**: ~$0.0005 (50 cents per 1,000 queries)

**Recommendation**: Use `gpt-4o-mini` for cost efficiency - it's 10x cheaper and still very capable.

## Security Best Practices

1. **Never commit API keys to Git**
   - Add to `.gitignore`
   - Use environment variables
   - Use a secrets management service

2. **Rotate keys regularly**
   - Generate new keys every 3-6 months
   - Revoke old keys

3. **Use separate keys for different environments**
   - Development key
   - Production key
   - Testing key

4. **Set up IP restrictions** (if possible)
   - Limit API key usage to specific IPs
   - Reduces risk if key is leaked

## For Production (Backend Setup)

When you're ready to move to production:

1. **Set up a backend server** (Node.js, Python, etc.)
2. **Store API key on server** (environment variable)
3. **Create API endpoint** that proxies requests to OpenAI
4. **Add authentication** to your endpoint
5. **Implement rate limiting** per user
6. **Monitor and log** all API calls

## Cost Estimation

Based on your subscription model (£4.99/year):

- **Average user**: 10 queries/day = 3,650/year
- **30% use AI** = 1,095 AI queries/year
- **Cost**: 1,095 × $0.00005 = **$0.055/user/year**
- **Profit margin**: 99%+

Even with 1,000 users:
- **Total AI queries**: 1,095,000/year
- **Total cost**: ~$55/year
- **Revenue**: £4,990/year (~$6,300)
- **Profit**: $6,245/year

## Next Steps

1. Get your API key from OpenAI
2. Set up usage limits
3. Test with a few queries
4. Monitor costs for first month
5. Adjust limits as needed

