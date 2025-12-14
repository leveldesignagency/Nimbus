# API Call Economics Analysis

## Subscription Model
- **Price**: £4.99/year per user
- **USD Equivalent**: ~$6.30/year (at current exchange rate)

## Cost Breakdown

### OpenAI API Costs
- **Model**: gpt-4o-mini (recommended for cost efficiency)
- **Input tokens**: ~$0.15 per 1M tokens
- **Output tokens**: ~$0.60 per 1M tokens
- **Average query**: 
  - Input: ~100 tokens (word + context)
  - Output: ~50 tokens (explanation)
  - **Cost per query**: ~$0.00005 (5 cents per 1,000 queries)

### Payment Processing
- **Stripe/Google**: ~3% + £0.20 per transaction
- **Per subscription**: ~£0.35 (~$0.44)
- **Net revenue per user**: ~£4.64 (~$5.86)

### Other Costs (Estimated)
- **Server/hosting**: ~$0.50/user/year (if using cloud functions)
- **Dictionary API**: FREE
- **Wikipedia API**: FREE
- **Total overhead**: ~$0.50/user/year

## Break-Even Analysis

### Per User Economics
- **Net revenue**: $5.86/year
- **Overhead**: $0.50/year
- **Available for AI costs**: $5.36/year
- **Cost per AI query**: $0.00005
- **Break-even queries**: $5.36 / $0.00005 = **107,200 queries/year**

### Conservative Estimates
Assuming:
- 30% of queries use AI (smart routing)
- 70% use free dictionary
- Average user makes 10 queries/day

**Per User:**
- Queries/year: 10 × 365 = 3,650 queries
- AI queries: 3,650 × 30% = 1,095 AI queries/year
- AI cost: 1,095 × $0.00005 = **$0.055/year**

**Profit margin**: $5.36 - $0.055 = **$5.31/user/year (99% margin)**

### Heavy User Scenario
**Power user**: 50 queries/day
- Queries/year: 50 × 365 = 18,250 queries
- AI queries: 18,250 × 30% = 5,475 AI queries/year
- AI cost: 5,475 × $0.00005 = **$0.27/year**

**Profit margin**: $5.36 - $0.27 = **$5.09/user/year (95% margin)**

### Extreme User Scenario
**Very heavy user**: 100 queries/day
- Queries/year: 100 × 365 = 36,500 queries
- AI queries: 36,500 × 30% = 10,950 AI queries/year
- AI cost: 10,950 × $0.00005 = **$0.55/year**

**Profit margin**: $5.36 - $0.55 = **$4.81/user/year (90% margin)**

## Loss Threshold

### When Do We Start Losing Money?
- **Break-even point**: 107,200 AI queries/year per user
- **At 30% AI usage**: 107,200 / 0.30 = **357,333 total queries/year**
- **Per day**: 357,333 / 365 = **979 queries/day**

**Conclusion**: A user would need to make **~1,000 queries per day** (all year) before we lose money. This is extremely unlikely.

### Realistic Limits
Even with 100% AI usage (no dictionary):
- **Break-even**: 107,200 queries/year
- **Per day**: 294 queries/day
- **Per hour**: ~12 queries/hour (if used 24/7)

## Safety Measures

### 1. Rate Limiting
- **Soft limit**: 500 queries/day per user
- **Hard limit**: 1,000 queries/day per user
- **Action**: After limit, show message: "Daily limit reached. Please try again tomorrow."

### 2. Caching
- Cache common word explanations
- Cache AI responses for same word+context
- **Reduction**: 60-80% fewer API calls
- **Effective break-even**: 500,000+ queries/year with caching

### 3. Smart Routing
- Use dictionary for 70% of queries (free)
- Use AI only for complex terms
- **Reduction**: 70% fewer AI calls
- **Effective break-even**: 350,000+ queries/year

### 4. Monitoring
- Track API usage per user
- Alert if user exceeds 10,000 queries/month
- Review and potentially limit extreme users

## Recommendations

### ✅ Safe to Proceed
- **99% profit margin** for average users
- **90% profit margin** even for extreme users
- **Very low risk** of losing money

### Implementation Strategy
1. **No hard limits needed** initially
2. **Monitor usage** for first 3 months
3. **Add soft limits** if needed (500 queries/day)
4. **Cache aggressively** to reduce costs further

### Cost Optimization
- Use `gpt-4o-mini` (10x cheaper than gpt-4o)
- Implement caching (60-80% cost reduction)
- Smart routing (70% fewer AI calls)
- **Combined effect**: 95%+ cost reduction

## Final Numbers

**Per User at £4.99/year:**
- **Average user** (10 queries/day): $0.055/year cost → **99% profit**
- **Heavy user** (50 queries/day): $0.27/year cost → **95% profit**
- **Extreme user** (100 queries/day): $0.55/year cost → **90% profit**
- **Break-even**: ~1,000 queries/day → **Extremely unlikely**

**Conclusion**: The subscription model is **highly profitable** and **very safe** even with unlimited AI usage.

