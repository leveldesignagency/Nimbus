/* options.js - Nimbus Settings */

const API_BASE_URL = 'https://nimbus-api-ten.vercel.app';

const PROFILE_KEYS = [
  'userEmail', 'userName', 'userGivenName', 'userFamilyName', 'userPicture', 'userGoogleId',
  'subscriptionId', 'subscriptionExpiry', 'subscriptionActive',
  'tempSessionData', 'pendingCheckoutSessionId', 'pendingCheckoutEmail', 'checkoutInitiatedAt'
];

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateAuthButtons(signedIn) {
  const signinBtn = document.getElementById('signin-btn');
  const signoutBtn = document.getElementById('signout-btn');
  const simpleSignoutBtn = document.getElementById('simple-signout-btn');
  if (signinBtn) signinBtn.style.display = signedIn ? 'none' : 'inline-block';
  if (signoutBtn) signoutBtn.style.display = signedIn ? 'inline-block' : 'none';
  if (simpleSignoutBtn) simpleSignoutBtn.style.display = signedIn ? 'inline-block' : 'none';
}

function renderAccountInfo(profile) {
  const accountInfo = document.getElementById('account-info');
  if (!accountInfo) return;

  if (!profile || !profile.userEmail) {
    accountInfo.innerHTML = `
      <p class="profile-label">Google account</p>
      <strong>Not signed in</strong>
      <p class="hint" style="margin-top: 8px;">Click <em>Sign in with Google</em> below to link your account (needed for subscription + profile).</p>
    `;
    updateAuthButtons(false);
    return;
  }

  const name = profile.userName || [profile.userGivenName, profile.userFamilyName].filter(Boolean).join(' ') || 'Google account';
  const email = profile.userEmail;
  const picture = profile.userPicture;
  const initial = (name || email || '?').charAt(0).toUpperCase();

  const avatarHtml = picture
    ? `<img class="profile-avatar" src="${escapeHtml(picture)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="profile-avatar-fallback" style="display:none;">${escapeHtml(initial)}</div>`
    : `<div class="profile-avatar-fallback">${escapeHtml(initial)}</div>`;

  accountInfo.innerHTML = `
    <p class="profile-label">Signed in with Google</p>
    <div class="profile-card">
      ${avatarHtml}
      <div class="profile-meta">
        <p class="profile-name">${escapeHtml(name)}</p>
        <p class="profile-email">${escapeHtml(email)}</p>
      </div>
    </div>
  `;
  updateAuthButtons(true);
}

async function signInWithGoogleInteractive() {
  const signinBtn = document.getElementById('signin-btn');
  if (signinBtn) {
    signinBtn.disabled = true;
    signinBtn.textContent = 'Opening Google...';
  }
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({
      interactive: true,
      scopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ]
    }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        if (signinBtn) {
          signinBtn.disabled = false;
          signinBtn.textContent = 'Sign in with Google';
        }
        resolve({ ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'cancelled' });
        return;
      }
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          if (signinBtn) {
            signinBtn.disabled = false;
            signinBtn.textContent = 'Sign in with Google';
          }
          resolve({ ok: false, error: 'userinfo_failed' });
          return;
        }
        const userInfo = await res.json();
        if (!userInfo || !userInfo.email) {
          if (signinBtn) {
            signinBtn.disabled = false;
            signinBtn.textContent = 'Sign in with Google';
          }
          resolve({ ok: false, error: 'no_email' });
          return;
        }
        const profile = {
          userEmail: userInfo.email,
          userName: userInfo.name || '',
          userGivenName: userInfo.given_name || '',
          userFamilyName: userInfo.family_name || '',
          userPicture: userInfo.picture || '',
          userGoogleId: userInfo.id || '',
        };
        await chrome.storage.local.remove(['signedOut']);
        await chrome.storage.local.set(profile);
        if (signinBtn) {
          signinBtn.disabled = false;
          signinBtn.textContent = 'Sign in with Google';
        }
        resolve({ ok: true, profile });
      } catch (e) {
        if (signinBtn) {
          signinBtn.disabled = false;
          signinBtn.textContent = 'Sign in with Google';
        }
        resolve({ ok: false, error: e.message || 'network' });
      }
    });
  });
}

async function refreshGoogleProfileIfPossible() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({
      interactive: false,
      scopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ]
    }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        resolve(null);
        return;
      }
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          resolve(null);
          return;
        }
        const userInfo = await res.json();
        if (!userInfo || !userInfo.email) {
          resolve(null);
          return;
        }
        const profile = {
          userEmail: userInfo.email,
          userName: userInfo.name || '',
          userGivenName: userInfo.given_name || '',
          userFamilyName: userInfo.family_name || '',
          userPicture: userInfo.picture || '',
          userGoogleId: userInfo.id || '',
        };
        await chrome.storage.local.remove(['signedOut']);
        await chrome.storage.local.set(profile);
        resolve(profile);
      } catch (e) {
        resolve(null);
      }
    });
  });
}

async function clearAccountAndSignOut() {
  await chrome.storage.local.set({ signedOut: true });
  await chrome.storage.local.remove(PROFILE_KEYS);
  try {
    await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError || !token) {
          resolve();
          return;
        }
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      });
    });
  } catch (error) {
    console.log('No OAuth token to revoke');
  }
}

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
  const accountInfo = document.getElementById('account-info');
  const signoutBtn = document.getElementById('signout-btn');
  const useFreeAPICheckbox = document.getElementById('useFreeAPI');

  chrome.storage.local.get([
    'openaiKey', 'style', 'useFreeAPI',
    'subscriptionId', 'subscriptionExpiry', 'userEmail',
    'userName', 'userGivenName', 'userFamilyName', 'userPicture', 'userGoogleId', 'signedOut'
  ], async (res) => {
    apiKeyInput.value = res.openaiKey || '';
    styleSelect.value = res.style || 'plain';
    useFreeAPICheckbox.checked = res.useFreeAPI !== false;

    if (res.subscriptionId || res.userEmail) {
      loadSubscriptionInfo(res.subscriptionId, res.userEmail, res.subscriptionExpiry);
    }

    if (res.signedOut === true || !res.userEmail) {
      renderAccountInfo(null);
    } else {
      renderAccountInfo(res);
      // Refresh name/photo from Google when possible (covers older sign-ins that only stored email)
      const refreshed = await refreshGoogleProfileIfPossible();
      if (refreshed) renderAccountInfo(refreshed);
    }
  });

  const signinBtn = document.getElementById('signin-btn');
  if (signinBtn) {
    signinBtn.addEventListener('click', async () => {
      const result = await signInWithGoogleInteractive();
      if (result.ok) {
        renderAccountInfo(result.profile);
        status.innerText = '✅ Signed in successfully';
        status.style.color = '#10b981';
        if (result.profile.userEmail) {
          loadSubscriptionInfo(null, result.profile.userEmail, null);
        }
      } else if (result.error && !String(result.error).toLowerCase().includes('cancel')) {
        status.innerText = '❌ Sign-in failed. Please try again.';
        status.style.color = '#dc2626';
      }
    });
  }

  signoutBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to sign out? You will need to sign in again to use the extension.')) return;
    signoutBtn.disabled = true;
    signoutBtn.textContent = 'Signing out...';
    await clearAccountAndSignOut();
    renderAccountInfo(null);
    status.innerText = '✅ Signed out successfully';
    status.style.color = '#10b981';
    subscriptionSection.style.display = 'none';
    signoutBtn.disabled = false;
    signoutBtn.textContent = 'Sign Out';
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

  async function loadSubscriptionInfo(subscriptionId, email, expiryDate) {
    if (!subscriptionId && !email) {
      subscriptionSection.style.display = 'none';
      return;
    }

    subscriptionSection.style.display = 'block';

    try {
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
        const isCancelled = data.status === 'active' && data.cancelAtPeriodEnd === true;

        subscriptionInfo.innerHTML = `
          <strong>Status:</strong> ${isCancelled ? 'Active (Cancelling at period end)' : 'Active'}<br>
          <strong>Expires:</strong> ${expiry.toLocaleDateString()} (${daysRemaining} days remaining)<br>
          <strong>Subscription ID:</strong> ${data.subscriptionId.substring(0, 20)}...
        `;
        subscriptionInfo.style.color = isCancelled ? '#f59e0b' : '#10b981';

        if (isCancelled) {
          cancelBtn.style.display = 'none';
          resubscribeBtn.style.display = 'inline-block';
          refundBtn.style.display = 'none';
        } else {
          cancelBtn.style.display = 'inline-block';
          resubscribeBtn.style.display = 'none';
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

  async function checkRefundEligibility(subscriptionId, email) {
    try {
      refundBtn.style.display = 'inline-block';
    } catch (error) {
      console.error('Error checking refund eligibility:', error);
    }
  }

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
        const response = await fetch(`${API_BASE_URL}/api/cancel-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: res.subscriptionId,
            email: res.userEmail,
            action: 'reactivate',
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          subscriptionStatus.innerHTML = '✅ Subscription reactivated successfully!';
          subscriptionStatus.style.color = '#10b981';

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
          chrome.storage.local.remove(['subscriptionId', 'subscriptionExpiry', 'subscriptionActive'], () => {
            subscriptionStatus.innerHTML = `✅ Refund processed successfully! £${data.amount || 2.49} will be refunded to your original payment method.`;
            subscriptionStatus.style.color = '#10b981';

            subscriptionInfo.innerHTML = '<strong>Status:</strong> Refunded & Cancelled';
            subscriptionInfo.style.color = '#dc2626';
            cancelBtn.style.display = 'none';
            resubscribeBtn.style.display = 'none';
            refundBtn.style.display = 'none';

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

  const simpleSignoutBtn = document.getElementById('simple-signout-btn');
  if (simpleSignoutBtn) {
    simpleSignoutBtn.addEventListener('click', async () => {
      if (!confirm('Sign out? You will need to sign in again to use the extension.')) return;
      simpleSignoutBtn.disabled = true;
      simpleSignoutBtn.textContent = 'Signing out...';
      await clearAccountAndSignOut();
      status.innerText = '✅ Signed out successfully';
      status.style.color = '#10b981';
      setTimeout(() => location.reload(), 1000);
    });
  }
});
