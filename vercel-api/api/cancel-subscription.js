// Vercel serverless function to cancel a subscription
// Sends email notification to admin

export default async function handler(req, res) {
  // Set CORS headers
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
    const { subscriptionId, email, reason } = req.body;

    if (!subscriptionId && !email) {
      return res.status(400).json({ error: 'Subscription ID or email required' });
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

    // Find the subscription
    let subscription;
    if (subscriptionId) {
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (e) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
    } else {
      const customers = await stripe.customers.list({
        email: email,
        limit: 1,
      });

      if (customers.data.length === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      const subscriptions = await stripe.subscriptions.list({
        customer: customers.data[0].id,
        limit: 1,
      });

      if (subscriptions.data.length === 0) {
        return res.status(404).json({ error: 'No subscription found' });
      }

      subscription = subscriptions.data[0];
    }

    // Check if this is a reactivation request
    const { action, autoRefund } = req.body;
    
    // Check if within 7 days and auto-refund is requested
    let refunded = false;
    let refundAmount = null;
    
    if (autoRefund && action !== 'reactivate') {
      const subscriptionStartDate = new Date(subscription.created * 1000);
      const now = new Date();
      const daysSincePurchase = (now - subscriptionStartDate) / (1000 * 60 * 60 * 24);
      
      if (daysSincePurchase <= 7) {
        // Within 7 days - process refund
        try {
          // Get the latest invoice
          const invoices = await stripe.invoices.list({
            subscription: subscription.id,
            limit: 1,
            status: 'paid',
          });
          
          if (invoices.data.length > 0 && invoices.data[0].charge) {
            const refund = await stripe.refunds.create({
              charge: invoices.data[0].charge,
              reason: 'requested_by_customer',
            });
            
            refunded = true;
            refundAmount = refund.amount / 100; // Convert to pounds
            
            // Cancel immediately since refunded
            await stripe.subscriptions.cancel(subscription.id);
            
            // Send email notification (non-blocking)
            fetch('https://nimbus-api-ten.vercel.app/api/send-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: 'leveldesignagency@gmail.com',
                subject: `[Nimbus] Subscription Cancelled & Refunded - £${refundAmount}`,
                html: `
                  <h2>Subscription Cancelled & Refunded</h2>
                  <p><strong>Customer Email:</strong> ${email || subscription.customer}</p>
                  <p><strong>Subscription ID:</strong> ${subscription.id}</p>
                  <p><strong>Refund Amount:</strong> £${refundAmount}</p>
                  <p><strong>Refund ID:</strong> ${refund.id}</p>
                  <p><strong>Days Since Purchase:</strong> ${Math.floor(daysSincePurchase)}</p>
                  <p><strong>Cancelled:</strong> ${new Date().toLocaleString()}</p>
                `,
              }),
            }).catch((emailError) => {
              console.error('Failed to send refund email (non-blocking):', emailError);
            });
            
            return res.status(200).json({
              success: true,
              refunded: true,
              refundAmount: refundAmount,
              message: 'Subscription cancelled and refunded successfully',
              subscriptionId: subscription.id,
            });
          }
        } catch (refundError) {
          console.error('Error processing auto-refund:', refundError);
          // Continue with normal cancellation if refund fails
        }
      }
    }
    
    let cancelledSubscription;
    if (action === 'reactivate') {
      // Reactivate by removing cancel_at_period_end
      cancelledSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
      });
    } else {
      // Cancel at period end to allow access until expiry
      cancelledSubscription = await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
      });
    }

    // Send email notification to admin (non-blocking)
    // Don't wait for email to complete - just fire and forget
    fetch('https://nimbus-api-ten.vercel.app/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'leveldesignagency@gmail.com',
        subject: action === 'reactivate' 
          ? `[Nimbus] Subscription Reactivated`
          : `[Nimbus] Subscription Cancellation Request`,
        html: action === 'reactivate'
          ? `
            <h2>Subscription Reactivated</h2>
            <p><strong>Customer Email:</strong> ${email || subscription.customer}</p>
            <p><strong>Subscription ID:</strong> ${subscription.id}</p>
            <p><strong>Status:</strong> Active (reactivated)</p>
            <p><strong>Current Period End:</strong> ${new Date(subscription.current_period_end * 1000).toLocaleString()}</p>
          `
          : `
            <h2>Subscription Cancellation Request</h2>
            <p><strong>Customer Email:</strong> ${email || subscription.customer}</p>
            <p><strong>Subscription ID:</strong> ${subscription.id}</p>
            <p><strong>Status:</strong> ${subscription.status}</p>
            <p><strong>Current Period End:</strong> ${new Date(subscription.current_period_end * 1000).toLocaleString()}</p>
            <p><strong>Reason:</strong> ${reason || 'Not provided'}</p>
            <p><strong>Cancellation Type:</strong> At period end (customer retains access until expiry)</p>
          `,
      }),
    }).catch((emailError) => {
      console.error('Failed to send email (non-blocking):', emailError);
      // Don't fail the operation if email fails
    });

    return res.status(200).json({
      success: true,
      message: action === 'reactivate'
        ? 'Subscription reactivated successfully'
        : 'Subscription will be cancelled at the end of the current period',
      subscriptionId: cancelledSubscription.id,
      cancelAtPeriodEnd: cancelledSubscription.cancel_at_period_end,
      currentPeriodEnd: cancelledSubscription.current_period_end,
    });

  } catch (error) {
    console.error('Error cancelling subscription:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
}

