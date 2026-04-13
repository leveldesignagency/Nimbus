// Vercel serverless function to create Stripe checkout session
// Currency is chosen by user location (Vercel X-Vercel-IP-Country). Price 2.49 in local currency.

import { getCurrencyFromRequest } from '../lib/currency.js';

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
    // Get Stripe keys from environment variables
    // Use production keys by default, only use test if FORCE_TEST_MODE is explicitly set
    // This ensures production keys are used even if test keys exist in environment
    const forceTestMode = process.env.FORCE_TEST_MODE === 'true';
    const stripeSecretKey = forceTestMode 
      ? process.env.TEST_STRIPE_SECRET_KEY 
      : process.env.STRIPE_SECRET_KEY;
    const stripePublishableKey = forceTestMode
      ? process.env.TEST_STRIPE_PUBLISHABLE_KEY
      : process.env.STRIPE_PUBLISHABLE_KEY;
    
    if (!stripeSecretKey || !stripePublishableKey) {
      console.error('Stripe keys not configured', {
        hasSecretKey: !!stripeSecretKey,
        hasPublishableKey: !!stripePublishableKey,
        forceTestMode: forceTestMode,
        envKeys: Object.keys(process.env).filter(k => k.includes('STRIPE'))
      });
      return res.status(500).json({ 
        error: 'Server configuration error',
        details: forceTestMode 
          ? 'TEST_STRIPE_SECRET_KEY or TEST_STRIPE_PUBLISHABLE_KEY not set in Vercel environment variables'
          : 'STRIPE_SECRET_KEY or STRIPE_PUBLISHABLE_KEY not set in Vercel environment variables'
      });
    }
    
    console.log('Using Stripe keys:', {
      secretKeyPrefix: stripeSecretKey.substring(0, 7) + '...',
      publishableKeyPrefix: stripePublishableKey.substring(0, 7) + '...',
      forceTestMode: forceTestMode
    });

    // Import Stripe
    const stripe = (await import('stripe')).default(stripeSecretKey);

    // Currency from visitor location (US→USD, GB→GBP, EU→EUR, etc.)
    const { currency, unitAmount, productLabel, country } = getCurrencyFromRequest(req);

    // Get the return URL and email from request
    const { returnUrl, email } = req.body;
    // Use extension popup URL - background script will handle closing the tab
    // returnUrl should be the extension popup URL (chrome-extension://.../popup.html)
    const successUrl = returnUrl ? `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&success=true` : 'chrome-extension://invalid/popup.html?session_id={CHECKOUT_SESSION_ID}&success=true';
    const cancelUrl = returnUrl ? `${returnUrl}?cancelled=true` : 'chrome-extension://invalid/popup.html?cancelled=true';

    // Create or get customer by email if provided
    let customerId;
    if (email) {
      try {
        const customers = await stripe.customers.list({
          email: email,
          limit: 1,
        });
        
        if (customers.data.length > 0) {
          customerId = customers.data[0].id;
          console.log('Found existing customer:', customerId);
        } else {
          const customer = await stripe.customers.create({
            email: email,
            metadata: {
              extension: 'nimbus',
            },
          });
          customerId = customer.id;
          console.log('Created new customer:', customerId);
        }
      } catch (customerError) {
        console.error('Error handling customer:', customerError);
        // Continue without customer ID - will use customer_email instead
      }
    }

    // Create Stripe checkout session
    // Only use customer OR customer_email, not both
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Nimbus Yearly Subscription (${productLabel})`,
              description: 'Unlock unlimited word definitions, AI explanations, and context for one year.',
            },
            unit_amount: unitAmount,
            recurring: {
              interval: 'year',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: cancelUrl,
      subscription_data: {
        trial_period_days: 3, // 3-day free trial
      },
      metadata: {
        extension: 'nimbus',
        version: '1.0.27',
        userEmail: email || '',
      },
    };
    
    // Only set customer if we have customerId, otherwise use customer_email
    if (customerId) {
      sessionConfig.customer = customerId;
    } else if (email) {
      sessionConfig.customer_email = email;
    }
    
    console.log('Creating checkout session with config:', {
      hasCustomer: !!customerId,
      hasCustomerEmail: !!email,
      currency,
      country,
      mode: sessionConfig.mode,
      trialDays: sessionConfig.subscription_data.trial_period_days
    });
    
    const session = await stripe.checkout.sessions.create(sessionConfig);
    
    console.log('Checkout session created successfully:', session.id);

    return res.status(200).json({
      sessionId: session.id,
      url: session.url,
      publishableKey: stripePublishableKey,
    });

  } catch (error) {
    console.error('Error creating checkout session:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      type: error.name || 'UnknownError'
    });
  }
}

