// Vercel serverless function to confirm subscription after payment
// This verifies the payment and returns subscription details

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ error: 'Subscription ID required' });
    }

    // Use production keys by default, only use test if FORCE_TEST_MODE is explicitly set
    const forceTestMode = process.env.FORCE_TEST_MODE === 'true';
    const stripeSecretKey = forceTestMode 
      ? process.env.TEST_STRIPE_SECRET_KEY 
      : process.env.STRIPE_SECRET_KEY;
    
    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const stripe = (await import('stripe')).default(stripeSecretKey);

    // Retrieve the subscription
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Check if subscription is active
    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      return res.status(200).json({
        valid: false,
        error: 'Subscription is not active',
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
    });

  } catch (error) {
    console.error('Error confirming subscription:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

