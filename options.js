/* options.js - Nimbus Settings */

const API_BASE_URL = 'https://nimbus-api-ten.vercel.app';

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const styleSelect = document.getElementById('style');
  const saveBtn = document.getElementById('save');
  const status = document.getElementById('status');
  const subscriptionSection = document.getElementById('subscription-section');
  const subscriptionInfo = document.getElementById('subscription-info');
  const cancelBtn = document.getElementById('cancel-btn');
  const resubscribeBtn = document.getElementById('resubscribe-btn');
  const refundBtn = document.getElementById('refund-btn');
  const subscriptionStatus = document.getElementById('subscription-status');
  const accountSection = document.getElementById('account-section');
  const accountInfo = document.getElementById('account-info');
  const signoutBtn = document.getElementById('signout-btn');

  const useFreeAPICheckbox = document.getElementById('useFreeAPI');
  
  chrome.storage.local.get(['openaiKey','style','useFreeAPI', 'subscriptionId', 'subscriptionExpiry', 'userEmail'], (res) => {
    apiKeyInput.value = res.openaiKey || '';
    styleSelect.value = res.style || 'plain';
    useFreeAPICheckbox.checked = res.useFreeAPI !== false; // Default to true
    
    // Load subscription info if available
    if (res.subscriptionId || res.userEmail) {
      loadSubscriptionInfo(res.subscriptionId, res.userEmail, res.subscriptionExpiry);
    }
    
    // Load account info
    if (res.userEmail) {
      accountInfo.innerHTML = `<strong>Signed in as:</strong> ${res.userEmail}`;
    } else {
      accountInfo.innerHTML = '<strong>Not signed in</strong>';
    }
  });
  
  // Handle sign out
  signoutBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to sign out? You will need to sign in again to use the extension.')) {
      chrome.storage.local.remove(['userEmail', 'subscriptionId', 'subscriptionExpiry', 'subscriptionActive'], () => {
        accountInfo.innerHTML = '<strong>Signed out</strong>';
        status.innerText = '✅ Signed out successfully';
        status.style.color = '#10b981';
        setTimeout(() => {
          location.reload();
        }, 1000);
      });
    }
  });

  saveBtn.addEventListener('click', () => {
    const openaiKey = apiKeyInput.value.trim();
    const style = styleSelect.value;
    const useFreeAPI = useFreeAPICheckbox.checked;
    chrome.storage.local.set({ openaiKey, style, useFreeAPI }, () => {
      status.innerText = '✅ Settings saved!';
      status.style.color = '#10b981';
      setTimeout(() => {
        status.innerText = '';
      }, 3000);
    });
  });

  // Load subscription information
  async function loadSubscriptionInfo(subscriptionId, email, expiryDate) {
    if (!subscriptionId && !email) {
      subscriptionSection.style.display = 'none';
      return;
    }

    subscriptionSection.style.display = 'block';

    try {
      // Verify subscription status
      const response = await fetch(`${API_BASE_URL}/api/verify-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: subscriptionId || email }),
      });

      const data = await response.json();

      if (data.valid) {
        const expiry = new Date(data.expiryDate);
        const now = new Date();
        const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        
        // Check if subscription is cancelled (will end at period end)
        const isCancelled = data.status === 'active' && data.cancelAtPeriodEnd === true;
        
        subscriptionInfo.innerHTML = `
          <strong>Status:</strong> ${isCancelled ? 'Active (Cancelling at period end)' : 'Active'}<br>
          <strong>Expires:</strong> ${expiry.toLocaleDateString()} (${daysRemaining} days remaining)<br>
          <strong>Subscription ID:</strong> ${data.subscriptionId.substring(0, 20)}...
        `;
        subscriptionInfo.style.color = isCancelled ? '#f59e0b' : '#10b981';

        // Show appropriate buttons
        if (isCancelled) {
          cancelBtn.style.display = 'none';
          resubscribeBtn.style.display = 'inline-block';
          refundBtn.style.display = 'none';
        } else {
          cancelBtn.style.display = 'inline-block';
          resubscribeBtn.style.display = 'none';
          // Show refund button if within 7 days
          checkRefundEligibility(data.subscriptionId, email);
        }
      } else {
        subscriptionInfo.innerHTML = `<strong>Status:</strong> ${data.error || 'Inactive'}`;
        subscriptionInfo.style.color = '#dc2626';
        cancelBtn.style.display = 'none';
        resubscribeBtn.style.display = 'none';
        refundBtn.style.display = 'none';
      }
    } catch (error) {
      console.error('Error loading subscription:', error);
      subscriptionInfo.innerHTML = '<strong>Status:</strong> Error loading subscription';
      subscriptionInfo.style.color = '#dc2626';
      cancelBtn.style.display = 'none';
      resubscribeBtn.style.display = 'none';
      refundBtn.style.display = 'none';
    }
  }

  // Check if user is eligible for refund (within 7 days)
  async function checkRefundEligibility(subscriptionId, email) {
    try {
      // Show refund button - API will validate the 7-day window
      refundBtn.style.display = 'inline-block';
    } catch (error) {
      console.error('Error checking refund eligibility:', error);
    }
  }

  // Handle cancel subscription
  cancelBtn.addEventListener('click', async () => {
    const reason = prompt('Please provide a reason for cancelling (optional):');
    
    if (!confirm('Your subscription will be cancelled at the end of the current billing period. You will retain access until then. Continue?')) {
      return;
    }

    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling...';
    subscriptionStatus.innerHTML = '';
    subscriptionStatus.style.color = '';

    try {
      chrome.storage.local.get(['subscriptionId', 'userEmail'], async (res) => {
        const response = await fetch(`${API_BASE_URL}/api/cancel-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: res.subscriptionId,
            email: res.userEmail,
            reason: reason || 'Not provided',
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          subscriptionStatus.innerHTML = `✅ Subscription will be cancelled at period end. You'll retain access until ${new Date(data.currentPeriodEnd * 1000).toLocaleDateString()}.`;
          subscriptionStatus.style.color = '#10b981';
          
          // Reload subscription info
          setTimeout(() => {
            loadSubscriptionInfo(res.subscriptionId, res.userEmail, null);
          }, 2000);
        } else {
          subscriptionStatus.innerHTML = `❌ ${data.error || 'Failed to cancel subscription'}`;
          subscriptionStatus.style.color = '#dc2626';
          cancelBtn.disabled = false;
          cancelBtn.textContent = 'Cancel Subscription';
        }
      });
    } catch (error) {
      console.error('Cancel error:', error);
      subscriptionStatus.innerHTML = '❌ Error cancelling subscription. Please try again.';
      subscriptionStatus.style.color = '#dc2626';
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel Subscription';
    }
  });

  // Handle resubscribe
  resubscribeBtn.addEventListener('click', async () => {
    if (!confirm('This will reactivate your subscription. Continue?')) {
      return;
    }

    resubscribeBtn.disabled = true;
    resubscribeBtn.textContent = 'Reactivating...';
    subscriptionStatus.innerHTML = '';
    subscriptionStatus.style.color = '';

    try {
      chrome.storage.local.get(['subscriptionId', 'userEmail'], async (res) => {
        // Reactivate by removing cancel_at_period_end
        const response = await fetch(`${API_BASE_URL}/api/cancel-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: res.subscriptionId,
            email: res.userEmail,
            action: 'reactivate', // Special action to reactivate
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          subscriptionStatus.innerHTML = '✅ Subscription reactivated successfully!';
          subscriptionStatus.style.color = '#10b981';
          
          // Reload subscription info
          setTimeout(() => {
            loadSubscriptionInfo(res.subscriptionId, res.userEmail, null);
          }, 2000);
        } else {
          subscriptionStatus.innerHTML = `❌ ${data.error || 'Failed to reactivate subscription'}`;
          subscriptionStatus.style.color = '#dc2626';
          resubscribeBtn.disabled = false;
          resubscribeBtn.textContent = 'Resubscribe';
        }
      });
    } catch (error) {
      console.error('Resubscribe error:', error);
      subscriptionStatus.innerHTML = '❌ Error reactivating subscription. Please try again.';
      subscriptionStatus.style.color = '#dc2626';
      resubscribeBtn.disabled = false;
      resubscribeBtn.textContent = 'Resubscribe';
    }
  });

  // Handle refund request
  refundBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to request a refund? Your subscription will be cancelled and you will lose access immediately. This action cannot be undone.')) {
      return;
    }

    refundBtn.disabled = true;
    refundBtn.textContent = 'Processing refund...';
    subscriptionStatus.innerHTML = '';
    subscriptionStatus.style.color = '';

    try {
      chrome.storage.local.get(['subscriptionId', 'userEmail'], async (res) => {
        const response = await fetch(`${API_BASE_URL}/api/process-refund`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: res.subscriptionId,
            email: res.userEmail,
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Clear subscription from storage
          chrome.storage.local.remove(['subscriptionId', 'subscriptionExpiry', 'subscriptionActive'], () => {
            subscriptionStatus.innerHTML = `✅ Refund processed successfully! £${data.amount || 4.99} will be refunded to your original payment method.`;
            subscriptionStatus.style.color = '#10b981';
            
            // Update UI
            subscriptionInfo.innerHTML = '<strong>Status:</strong> Refunded & Cancelled';
            subscriptionInfo.style.color = '#dc2626';
            cancelBtn.style.display = 'none';
            resubscribeBtn.style.display = 'none';
            refundBtn.style.display = 'none';
            
            // Reload page after 3 seconds
            setTimeout(() => {
              location.reload();
            }, 3000);
          });
        } else {
          subscriptionStatus.innerHTML = `❌ ${data.error || 'Failed to process refund'}. ${data.details || ''}`;
          subscriptionStatus.style.color = '#dc2626';
          refundBtn.disabled = false;
          refundBtn.textContent = 'Request Refund (7-day window)';
        }
      });
    } catch (error) {
      console.error('Refund error:', error);
      subscriptionStatus.innerHTML = '❌ Error processing refund. Please try again.';
      subscriptionStatus.style.color = '#dc2626';
      refundBtn.disabled = false;
      refundBtn.textContent = 'Request Refund (7-day window)';
    }
  });
});

