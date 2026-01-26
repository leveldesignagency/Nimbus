// Vercel serverless function to handle Stripe webhooks
// This automatically saves license keys when payment succeeds

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Use production keys by default, only use test if FORCE_TEST_MODE is explicitly set
  const forceTestMode = process.env.FORCE_TEST_MODE === 'true';
  const stripeSecretKey = forceTestMode 
    ? process.env.TEST_STRIPE_SECRET_KEY 
    : process.env.STRIPE_SECRET_KEY;
  const webhookSecret = forceTestMode
    ? process.env.TEST_STRIPE_WEBHOOK_SECRET
    : process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    console.error('Stripe configuration missing');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const stripe = (await import('stripe')).default(stripeSecretKey);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      
      // Get the subscription
      if (session.mode === 'subscription' && session.subscription) {
        try {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          
          // Store subscription info (you might want to save this to a database)
          // For now, we'll just log it - the license key will be the subscription ID
          console.log('Subscription created:', {
            subscriptionId: subscription.id,
            customerId: subscription.customer,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
          });
          
          // The license key is the subscription ID
          // Users will enter this in the extension
        } catch (error) {
          console.error('Error retrieving subscription:', error);
        }
      }
      break;

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      const subscription = event.data.object;
      console.log('Subscription updated/deleted:', {
        subscriptionId: subscription.id,
        status: subscription.status,
      });
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  return res.status(200).json({ received: true });
}

