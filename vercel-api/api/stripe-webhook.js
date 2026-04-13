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
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        try {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          console.log('Subscription created (checkout completed):', {
            subscriptionId: subscription.id,
            customerId: subscription.customer,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            trialEnd: subscription.trial_end || null,
          });
        } catch (error) {
          console.error('Error retrieving subscription:', error);
        }
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const isRenewal = invoice.billing_reason === 'subscription_cycle';
      console.log('Invoice paid:', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscription,
        billingReason: invoice.billing_reason,
        isRenewal,
        amountPaid: invoice.amount_paid,
      });
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log('Invoice payment failed:', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscription,
        attemptCount: invoice.attempt_count,
        nextPaymentAttempt: invoice.next_payment_attempt,
        lastPaymentError: invoice.last_payment_error?.message || null,
      });
      // Subscription will move to past_due/unpaid. User must update card in portal.
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const prev = event.data.previous_attributes || {};
      console.log('Subscription updated:', {
        subscriptionId: sub.id,
        status: sub.status,
        previousStatus: prev.status,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      console.log('Subscription deleted:', {
        subscriptionId: subscription.id,
        status: subscription.status,
      });
      break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  return res.status(200).json({ received: true });
}

