// Vercel serverless function to verify license keys
// This checks if a license key is valid and active.
// CORS: content scripts run in page context, so requests come from page origin (e.g. sportbible.com).

export default async function handler(req, res) {
  // CORS: allow any origin (extension content scripts run as the page origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { licenseKey } = req.body;

    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({ error: 'License key required' });
    }

    // Get Stripe secret key from environment variable
    // Use production keys by default, only use test if FORCE_TEST_MODE is explicitly set
    const forceTestMode = process.env.FORCE_TEST_MODE === 'true';
    const stripeSecretKey = forceTestMode 
      ? process.env.TEST_STRIPE_SECRET_KEY 
      : process.env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
      console.error(forceTestMode ? 'TEST_STRIPE_SECRET_KEY' : 'STRIPE_SECRET_KEY', 'environment variable not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Import Stripe (dynamic import for serverless)
    const stripe = (await import('stripe')).default(stripeSecretKey);

    // The license key format will be the Stripe customer ID or subscription ID
    // We'll search for the subscription by customer email or use the license key as subscription ID
    try {
      // Try to retrieve the subscription directly if licenseKey is a subscription ID
      let subscription;
      
      // First, try to get subscription by ID
      try {
        subscription = await stripe.subscriptions.retrieve(licenseKey);
        console.log('Found subscription by ID:', subscription.id, 'Status:', subscription.status);
      } catch (e) {
        // If that fails, search by customer email (licenseKey might be email)
        console.log('Subscription ID lookup failed, trying email:', licenseKey);
        const customers = await stripe.customers.list({
          email: licenseKey.toLowerCase().trim(), // Normalize email
          limit: 10, // Get more customers in case of duplicates
        });
        
        console.log('Found customers:', customers.data.length);
        
        // Try each customer to find an active subscription
        for (const customer of customers.data) {
          const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            limit: 10, // Get all subscriptions for this customer
          });
          
          console.log(`Found ${subscriptions.data.length} subscriptions for customer ${customer.id}`);
          
          // Look for active or trialing subscriptions
          const activeSub = subscriptions.data.find(sub => 
            sub.status === 'active' || sub.status === 'trialing'
          );
          
          if (activeSub) {
            subscription = activeSub;
            console.log('Found active subscription:', subscription.id, 'Status:', subscription.status);
            break;
          }
        }
      }

      if (!subscription) {
        // Return 200 with clear message so the extension can show "User not found" instead of "404"
        return res.status(200).json({
          valid: false,
          error: licenseKey && licenseKey.includes('@')
            ? 'No account or subscription found for this email.'
            : 'License key not found or subscription not active.',
        });
      }

      // Check if subscription is active or trialing
      if (subscription.status !== 'active' && subscription.status !== 'trialing') {
        // past_due/unpaid = payment failed (e.g. when trial ended). Tell user to update card.
        const isPaymentFailed = subscription.status === 'past_due' || subscription.status === 'unpaid';
        const errorMessage = isPaymentFailed
          ? 'Payment failed when your trial ended. Update your card in Billing to restore access.'
          : 'Subscription is not active';
        return res.status(200).json({
          valid: false,
          error: errorMessage,
          status: subscription.status,
          // Return subscriptionId so client can open Stripe portal to update payment
          ...(isPaymentFailed && { subscriptionId: subscription.id }),
        });
      }

      // Get customer email for response
      let customerEmail = null;
      try {
        const customer = await stripe.customers.retrieve(subscription.customer);
        customerEmail = customer.email || null;
      } catch (e) {
        console.log('Could not retrieve customer email:', e.message);
        // If licenseKey looks like an email, use it as fallback
        if (licenseKey.includes('@')) {
          customerEmail = licenseKey.toLowerCase().trim();
        }
      }

      // Calculate expiry date - use trial_end if in trial, otherwise current_period_end
      let expiryDate;
      if (subscription.status === 'trialing' && subscription.trial_end) {
        expiryDate = new Date(subscription.trial_end * 1000);
      } else {
        expiryDate = new Date(subscription.current_period_end * 1000);
      }
      const now = new Date();

      if (expiryDate < now) {
        return res.status(200).json({ 
          valid: false, 
          error: 'Subscription has expired',
          expiryDate: expiryDate.toISOString()
        });
      }

      // License is valid
      return res.status(200).json({
        valid: true,
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        status: subscription.status,
        expiryDate: expiryDate.toISOString(),
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
        email: customerEmail || (licenseKey.includes('@') ? licenseKey.toLowerCase().trim() : null),
        created: subscription.created, // Subscription creation timestamp
        trialEnd: subscription.trial_end || null, // Trial end timestamp (null if no trial)
      });

    } catch (stripeError) {
      console.error('Stripe error:', stripeError);
      return res.status(500).json({ 
        valid: false, 
        error: 'Error verifying license key' 
      });
    }

  } catch (error) {
    console.error('Error verifying license:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

