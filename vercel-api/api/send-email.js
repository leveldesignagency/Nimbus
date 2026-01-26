// Vercel serverless function to send emails using Resend
// Requires RESEND_API_KEY environment variable in Vercel

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
    const { to, subject, html, text } = req.body;

    if (!to || !subject) {
      return res.status(400).json({ error: 'To and subject required' });
    }

    // Get Resend API key from environment variable
    const resendApiKey = process.env.RESEND_API_KEY;
    
    if (!resendApiKey) {
      console.error('RESEND_API_KEY environment variable not set');
      // Log email for debugging but don't fail
      console.log('='.repeat(80));
      console.log('📧 EMAIL NOTIFICATION (Resend not configured)');
      console.log('='.repeat(80));
      console.log('To:', to);
      console.log('Subject:', subject);
      console.log('Timestamp:', new Date().toISOString());
      console.log('---');
      console.log('HTML Content:');
      console.log(html || text);
      console.log('='.repeat(80));
      return res.status(200).json({
        success: true,
        message: 'Email logged (RESEND_API_KEY not configured - add to Vercel env vars)',
      });
    }

    // Use Resend API to send email
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Nimbus <nimbus@resend.dev>', // Using Resend's default domain (update after domain verification)
        to: [to],
        subject: subject,
        html: html || text,
        text: text || html?.replace(/<[^>]*>/g, ''), // Strip HTML if no text provided
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Resend API error:', response.status, errorData);
      throw new Error(`Resend API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('Email sent via Resend:', result.id);

    return res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      emailId: result.id,
    });

  } catch (error) {
    console.error('Error sending email:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
}

