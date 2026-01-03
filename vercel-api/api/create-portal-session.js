// Vercel serverless function to create Stripe customer portal session
// This allows users to manage their subscription through Stripe's hosted portal

export default async function handler(req, res) {
  // Set CORS headers to allow Chrome extension requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get Stripe keys from environment variables
    const forceTestMode = process.env.FORCE_TEST_MODE === 'true';
    const stripeSecretKey = forceTestMode 
      ? process.env.TEST_STRIPE_SECRET_KEY 
      : process.env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
      console.error('Stripe keys not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Import Stripe
    const stripe = (await import('stripe')).default(stripeSecretKey);

    const { email, subscriptionId, returnUrl } = req.body;

    if (!email && !subscriptionId) {
      return res.status(400).json({ error: 'Email or subscription ID required' });
    }

    // Find customer by email or subscription
    let customerId;
    
    if (subscriptionId) {
      // Get subscription to find customer
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        customerId = subscription.customer;
      } catch (err) {
        console.error('Error retrieving subscription:', err);
        // Fall back to finding by email
        if (email) {
          const customers = await stripe.customers.list({
            email: email,
            limit: 1,
          });
          if (customers.data.length > 0) {
            customerId = customers.data[0].id;
          }
        }
      }
    } else if (email) {
      // Find customer by email
      const customers = await stripe.customers.list({
        email: email,
        limit: 1,
      });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
      } else {
        return res.status(404).json({ error: 'Customer not found' });
      }
    }

    if (!customerId) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Create customer portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || 'chrome-extension://invalid/popup.html',
    });

    return res.status(200).json({
      url: portalSession.url,
    });
  } catch (error) {
    console.error('Error creating portal session:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create portal session',
    });
  }
}

