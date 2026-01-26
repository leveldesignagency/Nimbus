// Vercel serverless function to retrieve Stripe checkout session
// Used to get subscription details after successful payment

export default async function handler(req, res) {
  // Set CORS headers to allow Chrome extension requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    // Use production keys by default, only use test if FORCE_TEST_MODE is explicitly set
    const forceTestMode = process.env.FORCE_TEST_MODE === 'true';
    const stripeSecretKey = forceTestMode 
      ? process.env.TEST_STRIPE_SECRET_KEY 
      : process.env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
      console.error('Stripe secret key not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const stripe = (await import('stripe')).default(stripeSecretKey);

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get subscription ID from session
    const subscriptionId = session.subscription;
    
    if (!subscriptionId) {
      return res.status(400).json({ error: 'No subscription found in session' });
    }

    // Retrieve the subscription to get full details
    const subscription = typeof subscriptionId === 'string' 
      ? await stripe.subscriptions.retrieve(subscriptionId)
      : subscriptionId;

    // Check subscription status
    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      return res.status(200).json({
        valid: false,
        error: `Subscription is not active. Status: ${subscription.status}`,
        subscriptionId: subscription.id,
        status: subscription.status,
      });
    }

    // Calculate expiry date
    const expiryDate = new Date(subscription.current_period_end * 1000);

    return res.status(200).json({
      valid: true,
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      status: subscription.status,
      expiryDate: expiryDate.toISOString(),
      currentPeriodEnd: subscription.current_period_end,
      email: session.customer_email || session.customer_details?.email,
    });

  } catch (error) {
    console.error('Error retrieving session:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
}

