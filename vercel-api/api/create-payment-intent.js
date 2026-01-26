// Vercel serverless function to create Stripe payment intent
// This allows embedded payment in the extension

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get Stripe keys from environment variables
    // Use production keys by default, only use test if FORCE_TEST_MODE is explicitly set
    const forceTestMode = process.env.FORCE_TEST_MODE === 'true';
    const stripeSecretKey = forceTestMode 
      ? process.env.TEST_STRIPE_SECRET_KEY 
      : process.env.STRIPE_SECRET_KEY;
    const stripePublishableKey = forceTestMode
      ? process.env.TEST_STRIPE_PUBLISHABLE_KEY
      : process.env.STRIPE_PUBLISHABLE_KEY;
    
    if (!stripeSecretKey || !stripePublishableKey) {
      console.error('Stripe keys not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Import Stripe
    const stripe = (await import('stripe')).default(stripeSecretKey);

    // Create a customer first (we'll use email if provided, or create anonymous)
    const { email } = req.body;
    let customer;
    
    if (email) {
      // Check if customer exists
      const existingCustomers = await stripe.customers.list({
        email: email,
        limit: 1,
      });
      
      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
      } else {
        customer = await stripe.customers.create({ email });
      }
    } else {
      customer = await stripe.customers.create();
    }

    // Create a subscription with payment intent
    // First, create or get the price
    const priceId = process.env.STRIPE_PRICE_ID; // You'll set this in Vercel
    
    // If no price ID, create a price on the fly
    let price;
    if (priceId) {
      price = await stripe.prices.retrieve(priceId);
    } else {
      // Create a yearly subscription price
      price = await stripe.prices.create({
        currency: 'gbp',
        unit_amount: 299, // £2.99 in pence
        recurring: {
          interval: 'year',
        },
        product_data: {
          name: 'Nimbus Yearly Subscription',
          description: 'Unlock unlimited word definitions, AI explanations, and context for one year',
        },
      });
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });

    const clientSecret = subscription.latest_invoice.payment_intent.client_secret;

    return res.status(200).json({
      clientSecret: clientSecret,
      subscriptionId: subscription.id,
      customerId: customer.id,
      publishableKey: stripePublishableKey,
      priceId: price.id,
    });

  } catch (error) {
    console.error('Error creating payment intent:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

