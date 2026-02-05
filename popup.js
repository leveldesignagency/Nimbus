/* popup.js - Nimbus Hub functionality */

(() => {
  const searchInput = document.getElementById('searchInput');
  const favoritesDiv = document.getElementById('favorites');
  const recentDiv = document.getElementById('recent');
  const savedDiv = document.getElementById('saved');
  const wordOfDayDiv = document.getElementById('wordOfDay');
  const nimbusTitle = document.getElementById('nimbusTitle');
  let navigationHistory = []; // Stack for back button
  let currentView = 'hub'; // 'hub' or 'word'
  
  // Notification system
  // Usage limits configuration
  const USAGE_LIMITS = {
    CODE_REQUESTS_PER_YEAR: 15,
    IMAGE_REQUESTS_PER_YEAR: 0 // Blocked
  };

  // Subscription checking - Using Stripe (Chrome Web Store doesn't manage products)
  const API_BASE_URL = 'https://nimbus-api-ten.vercel.app/api';
  let subscriptionActive = false;
  let userEmail = null;

  async function performPopupSignOut(confirmMessage) {
    if (confirmMessage && !confirm(confirmMessage)) return;
    await chrome.storage.local.remove([
      'userEmail', 'subscriptionId', 'subscriptionExpiry', 'subscriptionActive',
      'tempSessionData', 'pendingCheckoutSessionId', 'pendingCheckoutEmail', 'checkoutInitiatedAt'
    ]);
    try {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (chrome.runtime.lastError) return;
        if (token) {
          chrome.identity.removeCachedAuthToken({ token }, () => {
            if (chrome.runtime.lastError) return;
          });
        }
      });
    } catch (e) {}
    if (typeof showNotification === 'function') {
      showNotification('Signed out. Reloading...', 'success');
    }
    setTimeout(() => { location.reload(); }, confirmMessage ? 500 : 300);
  }

  // Get user email via Google Identity
  async function getUserEmail() {
    return new Promise((resolve) => {
      // Try to get email from storage first (cached)
      chrome.storage.local.get(['userEmail'], (result) => {
        if (result.userEmail) {
          userEmail = result.userEmail;
          resolve(result.userEmail);
          return;
        }
        
        // Try to get from Chrome identity (works in production Chrome Web Store)
        chrome.identity.getProfileUserInfo((userInfo) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          if (userInfo && userInfo.email) {
            userEmail = userInfo.email;
            // Cache it
            chrome.storage.local.set({ userEmail: userInfo.email });
            resolve(userInfo.email);
          } else {
            // If getProfileUserInfo doesn't work, try getAuthToken (non-interactive first)
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
              if (chrome.runtime.lastError || !token) {
                resolve(null);
                return;
              }
              if (token) {
                // Get user info from token
                fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                  headers: { 'Authorization': `Bearer ${token}` }
                })
                .then(res => res.json())
                .then(data => {
                  if (data.email) {
                    userEmail = data.email;
                    chrome.storage.local.set({ userEmail: data.email });
                    resolve(data.email);
                  } else {
                    resolve(null);
                  }
                })
                .catch(() => resolve(null));
              } else {
                resolve(null);
              }
            });
          }
        });
      });
    });
  }

  // Poll for payment completion
  let paymentPollInterval = null;
  function startPaymentPolling(sessionId, email) {
    // Clear any existing polling
    if (paymentPollInterval) {
      clearInterval(paymentPollInterval);
    }
    
    if (!email) {
      return;
    }
    
    let attempts = 0;
    const maxAttempts = 60; // Poll for up to 5 minutes (5 second intervals)
    
    
    paymentPollInterval = setInterval(async () => {
      attempts++;
      
      if (attempts > maxAttempts) {
        clearInterval(paymentPollInterval);
        paymentPollInterval = null;
        return;
      }
      
      try {
        
        // First try by session ID if available
        if (sessionId && attempts <= 10) {
          try {
            const sessionResponse = await fetch(`${API_BASE_URL}/get-session`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId }),
            });
            
            if (sessionResponse.ok) {
              const sessionData = await sessionResponse.json();
              if (sessionData.valid) {
                // Save subscription
                await chrome.storage.local.set({
                  subscriptionId: sessionData.subscriptionId,
                  subscriptionExpiry: sessionData.expiryDate,
                  subscriptionActive: true,
                  userEmail: sessionData.email || email,
                });
                
                // Clear pending checkout
                await chrome.storage.local.remove(['pendingCheckoutSessionId', 'pendingCheckoutEmail', 'checkoutInitiatedAt']);
                
                clearInterval(paymentPollInterval);
                paymentPollInterval = null;
                location.reload();
                return;
              }
            }
          } catch (e) {
          }
        }
        
        // Check if subscription was created by email
        const verifyResponse = await fetch(`${API_BASE_URL}/verify-license`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey: email }),
        });
        
        const verifyData = await verifyResponse.json();
        if (verifyData.valid) {
          // Payment completed!
          clearInterval(paymentPollInterval);
          paymentPollInterval = null;
          
          // Clear pending checkout
          chrome.storage.local.remove(['pendingCheckoutSessionId', 'pendingCheckoutEmail']);
          
          // Save subscription
          chrome.storage.local.set({
            subscriptionId: verifyData.subscriptionId,
            subscriptionExpiry: verifyData.expiryDate,
            subscriptionActive: true,
            userEmail: email,
          });
          
          showNotification('Payment successful! Subscription activated.', 'success');
          setTimeout(() => location.reload(), 1000);
        }
      } catch (e) {
      }
    }, 5000); // Poll every 5 seconds
  }

  // Load unpacked = different extension ID; treat as subscribed so devs can test without paying
  const STORE_EXTENSION_ID = 'abmihilkdbamlelkmpfegjfimcjpcihh';
  function isDeveloperMode() {
    try {
      return chrome.runtime.id !== STORE_EXTENSION_ID;
    } catch (e) {
      return false;
    }
  }

  // Check subscription status via our API (Stripe backend)
  async function checkSubscription() {
    if (isDeveloperMode()) {
      subscriptionActive = true;
      return true;
    }
    try {
      // Get subscription ID and email from storage
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['subscriptionId', 'subscriptionExpiry', 'userEmail', 'subscriptionActive'], resolve);
      });

      const subscriptionId = result.subscriptionId;
      const expiry = result.subscriptionExpiry;
      const userEmail = result.userEmail;
      const cachedActive = result.subscriptionActive;


      // CRITICAL FIX: Check cached active status FIRST - if it's true and expiry is valid, return immediately
      // This ensures the popup shows the hub immediately after payment verification
      if (cachedActive === true) {
        // Verify expiry is still valid
        if (expiry && new Date(expiry) > new Date()) {
          subscriptionActive = true;
          return true;
        } else if (!expiry) {
          // If no expiry but cached is active, still trust it (might be a new subscription)
          subscriptionActive = true;
          return true;
        }
      }

      // If no subscription ID, check by email as fallback
      if (!subscriptionId && userEmail) {
        // Try to verify by email
        try {
          const response = await fetch(`${API_BASE_URL}/verify-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: userEmail }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.valid) {
              // Save subscription ID for future checks
              await chrome.storage.local.set({
                subscriptionId: data.subscriptionId,
                subscriptionExpiry: data.expiryDate,
                subscriptionActive: true,
              });
              subscriptionActive = true;
              return true;
            }
          }
        } catch (e) {
        }
      }

      if (!subscriptionId) {
        subscriptionActive = false;
        chrome.storage.local.set({ subscriptionActive: false });
        return false;
      }

      // Check if expired locally
      if (expiry && new Date(expiry) < new Date()) {
        subscriptionActive = false;
        chrome.storage.local.set({ subscriptionActive: false });
        // Only remove if truly expired - but keep subscriptionId/userEmail for manage subscription
        return false;
      }

      // Verify with API
      try {
        const response = await fetch(`${API_BASE_URL}/verify-license`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey: subscriptionId }),
        });

        if (!response.ok) {
          subscriptionActive = false;
          chrome.storage.local.set({ subscriptionActive: false });
          return false;
        }

        const data = await response.json();
        
        if (data.valid) {
          subscriptionActive = true;
          // Update storage with latest info
          await chrome.storage.local.set({
            subscriptionExpiry: data.expiryDate,
            subscriptionId: subscriptionId,
            subscriptionActive: true,
            userEmail: userEmail || data.email || undefined,
          });
          return true;
        } else {
          subscriptionActive = false;
          chrome.storage.local.set({ subscriptionActive: false });
          return false;
        }
      } catch (apiError) {
        // If API fails but expiry is still valid and we have cached active status, allow access
        if (expiry && new Date(expiry) > new Date() && cachedActive === true) {
          subscriptionActive = true;
          return true;
        }
        // Don't remove data on network/API errors - only set status to false
        subscriptionActive = false;
        chrome.storage.local.set({ subscriptionActive: false });
        // DO NOT REMOVE subscriptionId or userEmail - keep them for manage subscription
        return false;
      }
    } catch (e) {
      subscriptionActive = false;
      chrome.storage.local.set({ subscriptionActive: false });
      return false;
    }
  }

  // Show upgrade prompt in popup - Stripe payment with Google sign-in
  async function showUpgradePromptInPopup() {
    const mainContent = document.getElementById('mainContent');
    const wordOfDay = document.getElementById('wordOfDay');
    const headerContent = document.querySelector('.header-content');
    const wordOfDayTop = document.querySelector('.word-of-day-top');
    
    if (!mainContent) return;
    
    // Hide Word of the Day section entirely on sign-in/subscription page (only show in hub when subscribed)
    if (wordOfDayTop) {
      wordOfDayTop.style.display = 'none';
    }
    
    // Hide header and search when showing payment screen
    if (headerContent) {
      headerContent.style.display = 'none';
    }
    
    // Get user email
    const email = await getUserEmail();
    
    // Clear all loading states first - hide everything
    mainContent.innerHTML = '';
    if (wordOfDay) wordOfDay.innerHTML = '';
    
    // Hide all sections and loading elements
    document.querySelectorAll('.section').forEach(section => {
      section.style.display = 'none';
    });
    document.querySelectorAll('.loading').forEach(loading => {
      loading.style.display = 'none';
    });
    
    // Also hide the search input if visible
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.style.display = 'none';
    }
    
    const upgradeHtml = `
      <div style="text-align: center; padding: 20px 30px; background: linear-gradient(135deg, #05007f 0%, #0a0a9e 30%, #1f7fff 60%, #4d9aff 100%); border-radius: 16px; margin: 5px 20px; max-width: 500px; margin-left: auto; margin-right: auto; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);">
        <img src="${chrome.runtime.getURL('NimbusLogo.svg')}" alt="Nimbus" style="height: 40px; margin-bottom: 15px; filter: brightness(0) invert(1);" onerror="this.onerror=null; this.src='${chrome.runtime.getURL('Nimbus Logo-02.svg')}'; this.onerror=function(){this.onerror=null; this.src='${chrome.runtime.getURL('Nimbus Logo-01.svg')}'; this.onerror=function(){this.style.display='none';};};">
        <h2 style="margin: 0 0 10px 0; color: #ffffff; font-size: 28px; font-weight: 700;">Subscribe to Nimbus</h2>
        <p style="margin: 0 0 12px 0; color: #e2e8f0; font-size: 16px; line-height: 1.5;">Unlock unlimited word definitions, AI explanations, and context</p>
        <div style="background: rgba(255,255,255,0.2); padding: 10px 16px; border-radius: 8px; margin: 0 auto 25px auto; display: inline-block;">
          <span style="color: #ffffff; font-size: 15px; font-weight: 600;">✨ Start with a 3-Day Free Trial</span>
        </div>
        <div style="background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); padding: 25px; border-radius: 12px; margin-bottom: 25px; border: 1px solid rgba(255,255,255,0.2);">
          <div style="font-size: 42px; font-weight: 700; color: #ffffff; margin-bottom: 5px;">£2.99</div>
          <div style="font-size: 16px; color: #cbd5e1;">per year • Then £2.99/year</div>
        </div>
        
        ${email ? `<p style="margin: 0 0 25px 0; color: #cbd5e1; font-size: 14px;">Signed in as: <strong style="color: #ffffff;">${email}</strong></p>` : ''}
        
        ${!email ? `
        <p style="margin: 0 0 12px 0; color: #e2e8f0; font-size: 14px; font-weight: 600;">Already have an account?</p>
        <button id="signin-btn" style="width: 100%; background: #ffffff; color: #05007f; border: none; padding: 14px; border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 600; margin-bottom: 20px; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); display: flex; align-items: center; justify-content: center; gap: 8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
        ` : ''}
        
        <button id="subscribe-btn" style="width: 100%; background: #ffffff; color: #05007f; border: none; padding: 14px; border-radius: 10px; cursor: pointer; font-size: 16px; font-weight: 600; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); ${!email ? 'opacity: 0.5; cursor: not-allowed;' : ''}" ${!email ? 'disabled' : ''}>
          ${email ? 'Start Free Trial - 3 Days Free' : 'Sign in to Subscribe'}
        </button>

        ${email ? `
          <button id="verify-subscription-btn" style="width: 100%; background: rgba(255,255,255,0.2); color: #ffffff; border: 1px solid rgba(255,255,255,0.3); padding: 10px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; margin-top: 15px; transition: all 0.2s;">
            Already paid? Verify Subscription
          </button>
          <button id="signout-btn" style="width: 100%; background: transparent; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.2); padding: 8px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 400; margin-top: 10px; transition: all 0.2s;">
            Sign Out
          </button>
        ` : ''}
        
        <p style="margin: 25px 0 0 0; color: #94a3b8; font-size: 12px;">All features are locked until you subscribe</p>
      </div>
    `;
    
    mainContent.innerHTML = upgradeHtml;
    
    // Set up button handlers
    setTimeout(() => {
      const subscribeBtn = document.getElementById('subscribe-btn');
      const signinBtn = document.getElementById('signin-btn');
      
      if (subscribeBtn && email) {
        subscribeBtn.addEventListener('click', async () => {
          subscribeBtn.disabled = true;
          subscribeBtn.textContent = 'Opening checkout...';
          
          try {
            
            // Create Stripe checkout session
            const response = await fetch(`${API_BASE_URL}/create-checkout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                email: email,
                returnUrl: chrome.runtime.getURL('popup.html')
              }),
            });


            if (!response.ok) {
              // Try to get error details from response (read body only once)
              let errorMessage = 'Failed to create checkout session';
              let errorDetails = null;
              
              // Read response as text first (can always parse text)
              const responseText = await response.text();
              
              // Try to parse as JSON
              try {
                errorDetails = JSON.parse(responseText);
                if (errorDetails && errorDetails.error) {
                  errorMessage = errorDetails.error;
                  // Include details if available
                  if (errorDetails.details) {
                    errorMessage += `: ${errorDetails.details}`;
                  }
                }
              } catch (e) {
                // Not JSON, use text as error message
                errorMessage = responseText || `HTTP ${response.status}: ${response.statusText}`;
              }
              
              // Show detailed error to user
              const fullError = `${errorMessage} (Status: ${response.status})`;
              throw new Error(fullError);
            }

            const data = await response.json();
            
            if (!data.url || !data.sessionId) {
              throw new Error('No checkout URL received from server');
            }
            
            // Store session ID and email for later verification
            await chrome.storage.local.set({
              pendingCheckoutSessionId: data.sessionId,
              pendingCheckoutEmail: email,
              checkoutInitiatedAt: Date.now()
            });
            
            // Open Stripe checkout in new tab
            chrome.tabs.create({ url: data.url });
            showNotification('Complete your payment in the new tab. The extension will activate automatically.', 'success');
            
            // Start polling for subscription activation
            startPaymentPolling(email, data.sessionId);
            
            // Listen for tab updates to detect when user returns
            chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo, tab) {
              if (changeInfo.status === 'complete' && tab.url && tab.url.includes('popup.html')) {
                chrome.tabs.onUpdated.removeListener(listener);
                // Check if payment was successful by verifying subscription
                setTimeout(async () => {
                  const email = await getUserEmail();
                  if (email) {
                    // Try to verify subscription by email
                    try {
                      const verifyResponse = await fetch(`${API_BASE_URL}/verify-license`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ licenseKey: email }),
                      });
                      
                      const verifyData = await verifyResponse.json();
                      if (verifyData.valid) {
                        chrome.storage.local.set({
                          subscriptionId: verifyData.subscriptionId,
                          subscriptionExpiry: verifyData.expiryDate,
                          userEmail: email,
                        });
                        showNotification('Payment successful! Activating subscription...', 'success');
                        setTimeout(() => location.reload(), 1000);
                      }
                    } catch (e) {
                    }
                  }
                }, 500);
              }
            });
            
            // Listen for tab updates to detect when user returns
            chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo, tab) {
              if (changeInfo.status === 'complete' && tab.url && tab.url.includes('popup.html')) {
                chrome.tabs.onUpdated.removeListener(listener);
                // Check if payment was successful by verifying subscription
                setTimeout(async () => {
                  const email = await getUserEmail();
                  if (email) {
                    // Try to verify subscription by email
                    try {
                      const verifyResponse = await fetch(`${API_BASE_URL}/verify-license`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ licenseKey: email }),
                      });
                      
                      const verifyData = await verifyResponse.json();
                      if (verifyData.valid) {
                        chrome.storage.local.set({
                          subscriptionId: verifyData.subscriptionId,
                          subscriptionExpiry: verifyData.expiryDate,
                          userEmail: email,
                        });
                        showNotification('Payment successful! Activating subscription...', 'success');
                        setTimeout(() => location.reload(), 1000);
                      }
                    } catch (e) {
                    }
                  }
                }, 500);
              }
            });
          } catch (error) {
            // Show more detailed error message
            let errorMsg = error.message || 'Failed to open checkout. Please try again.';
            
            // Extract details from error message if available
            if (errorMsg.includes('details:')) {
              // Keep the full error message with details
            } else if (errorMsg.includes('Status: 500')) {
              errorMsg = 'Server error. Check Vercel function logs for details.';
            }
            
            showNotification(errorMsg, 'error');
            subscribeBtn.disabled = false;
            subscribeBtn.textContent = 'Subscribe Now - £2.99/year';
          }
        });
      }
      
      if (signinBtn) {
        signinBtn.onclick = async function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          signinBtn.disabled = true;
          signinBtn.innerHTML = 'Opening Google sign-in...';
          
          signinBtn.innerHTML = 'Opening Google sign-in...';
          
            chrome.identity.getAuthToken({ 
              interactive: true,
              scopes: ['https://www.googleapis.com/auth/userinfo.email']
            }, async (token) => {
              if (chrome.runtime.lastError) {
                const error = chrome.runtime.lastError.message;
              
              signinBtn.disabled = false;
              signinBtn.innerHTML = 'Sign in with Google';
              
              // Show user-friendly error message
              let errorMsg = 'Sign-in failed. Please try again.';
              if (error.includes('canceled') || error.includes('user_cancelled') || error.includes('cancel')) {
                errorMsg = 'Sign-in was cancelled. Please try again.';
              }
              
              showNotification(errorMsg, 'error');
              
                return;
              }
              
              if (!token) {
                signinBtn.disabled = false;
                signinBtn.innerHTML = 'Sign in with Google';
              showNotification('Sign-in failed. Please try again.', 'error');
                return;
              }
            
            signinBtn.innerHTML = 'Verifying...';
              
              // Get email from Google
              try {
                const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (response.ok) {
                  const userInfo = await response.json();
                  if (userInfo.email) {
                    // Save email and reload
                    await chrome.storage.local.set({ userEmail: userInfo.email });
                  showNotification('Signed in successfully!', 'success');
                  setTimeout(() => {
                    location.reload();
                  }, 500);
                } else {
                  signinBtn.disabled = false;
                  signinBtn.innerHTML = 'Sign in with Google';
                  showNotification('Sign-in failed. No email found in account.', 'error');
                  }
              } else {
                signinBtn.disabled = false;
                signinBtn.innerHTML = 'Sign in with Google';
                showNotification('Sign-in failed. Please try again.', 'error');
                }
              } catch (error) {
                signinBtn.disabled = false;
                signinBtn.innerHTML = 'Sign in with Google';
              showNotification('Sign-in failed. Please check your internet connection.', 'error');
              }
          });
        };
      }
      
      // Verify subscription button handler
      const verifyBtn = document.getElementById('verify-subscription-btn');
      if (verifyBtn && email) {
        verifyBtn.addEventListener('click', async () => {
          verifyBtn.disabled = true;
          verifyBtn.textContent = 'Checking...';
          
          try {
            
            // First try by session ID if we have one
            const pendingData = await new Promise((resolve) => {
              chrome.storage.local.get(['pendingCheckoutSessionId'], resolve);
            });
            
            if (pendingData.pendingCheckoutSessionId) {
              try {
                const sessionResponse = await fetch(`${API_BASE_URL}/get-session`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: pendingData.pendingCheckoutSessionId }),
                });
                
                if (sessionResponse.ok) {
                  const sessionData = await sessionResponse.json();
                  
                  if (sessionData.valid) {
                    // Save subscription
                    await chrome.storage.local.set({
                      subscriptionId: sessionData.subscriptionId,
                      subscriptionExpiry: sessionData.expiryDate,
                      subscriptionActive: true,
                      userEmail: sessionData.email || email,
                    });
                    
                    // Clear pending checkout
                    await chrome.storage.local.remove(['pendingCheckoutSessionId', 'pendingCheckoutEmail', 'checkoutInitiatedAt']);
                    
                    showNotification('Subscription verified! Reloading...', 'success');
                    setTimeout(() => {
                      location.reload();
                    }, 1000);
                    return;
                  } else {
                  }
                } else {
                  const errorText = await sessionResponse.text();
                }
              } catch (e) {
              }
            }
            
            // Fallback: Check subscription by email
            
            const response = await fetch(`${API_BASE_URL}/verify-license`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ licenseKey: email }),
            });
            
            
            if (!response.ok) {
              const errorText = await response.text();
              verifyBtn.disabled = false;
              verifyBtn.textContent = 'Already paid? Verify Subscription';
              showNotification(`Verification failed (${response.status}). Check Stripe dashboard to confirm payment.`, 'error');
              return;
            }
            
            const data = await response.json();
            if (data.valid) {
              // Save subscription
              await chrome.storage.local.set({
                subscriptionId: data.subscriptionId,
                subscriptionExpiry: data.expiryDate,
                subscriptionActive: true,
                userEmail: email,
              });
              
              
              // Clear pending checkout
              await chrome.storage.local.remove(['pendingCheckoutSessionId', 'pendingCheckoutEmail', 'checkoutInitiatedAt']);
              
              showNotification('Subscription verified! Reloading...', 'success');
              setTimeout(() => {
                location.reload();
              }, 1000);
            } else {
              verifyBtn.disabled = false;
              verifyBtn.textContent = 'Already paid? Verify Subscription';
              const errorMsg = data.error || 'No active subscription found for this email.';
              showNotification(`${errorMsg} Check Stripe dashboard to confirm payment.`, 'error');
            }
          } catch (error) {
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'Already paid? Verify Subscription';
            showNotification('Verification failed. Please try again.', 'error');
          }
        });
      }
      
      // Sign out button handler (payment view)
      const signoutBtn = document.getElementById('signout-btn');
      if (signoutBtn && email) {
        signoutBtn.addEventListener('click', () => {
          performPopupSignOut('Sign out? You will need to sign in again to subscribe.');
        });
      }
      
    }, 100);
  }
  
  // Legacy payment handlers (kept for backwards compatibility but not used in new flow)
  // Add click handler for upgrade button
  setTimeout(() => {
      const upgradeBtn = document.getElementById('popup-upgrade-btn');
      const verifyBtn = document.getElementById('verify-license-btn');
      const licenseInput = document.getElementById('license-key-input');
      const licenseStatus = document.getElementById('license-status');
      
      if (upgradeBtn) {
        upgradeBtn.addEventListener('click', async () => {
          // Open Stripe checkout
          try {
            const response = await fetch(`${API_BASE_URL}/create-checkout`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                returnUrl: chrome.runtime.getURL('popup.html'),
              }),
            });

            if (!response.ok) {
              throw new Error('Failed to create checkout session');
            }

            const data = await response.json();
            
            // Open Stripe checkout in new tab
            if (data.url) {
              chrome.tabs.create({ url: data.url });
              showNotification('Opening payment page... Complete your purchase and return here.', 'success');
            } else {
              throw new Error('No checkout URL received');
            }
          } catch (error) {
            showNotification('Failed to open payment page. Please try again or contact support.', 'error');
          }
        });
        
        // Hover effect
        upgradeBtn.addEventListener('mouseenter', () => {
          upgradeBtn.style.background = '#1f7fff';
        });
        upgradeBtn.addEventListener('mouseleave', () => {
          upgradeBtn.style.background = '#05007f';
        });
      }
      
      // License key verification handler
      if (verifyBtn && licenseInput) {
        const verifyLicense = async () => {
          const licenseKey = licenseInput.value.trim();
          if (!licenseKey) {
            licenseStatus.textContent = 'Please enter a license key';
            licenseStatus.style.color = '#dc2626';
            return;
          }
          
          verifyBtn.disabled = true;
          verifyBtn.textContent = 'Verifying...';
          licenseStatus.textContent = '';
          
          try {
            const response = await fetch(`${API_BASE_URL}/verify-license`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ licenseKey }),
            });
            
            if (!response.ok) {
              throw new Error('Verification failed');
            }
            
            const data = await response.json();
            
            if (data.valid) {
              // Save license key
              chrome.storage.local.set({
                licenseKey: licenseKey,
                licenseExpiry: data.expiryDate,
              });
              
              licenseStatus.textContent = 'License verified! Reloading...';
              licenseStatus.style.color = '#059669';
              
              // Reload popup to activate subscription
              setTimeout(() => {
                location.reload();
              }, 1000);
            } else {
              licenseStatus.textContent = data.error || 'Invalid license key';
              licenseStatus.style.color = '#dc2626';
              verifyBtn.disabled = false;
              verifyBtn.textContent = 'Verify';
            }
          } catch (error) {
            licenseStatus.textContent = 'Error verifying license. Please try again.';
            licenseStatus.style.color = '#dc2626';
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'Verify';
          }
        };
        
        verifyBtn.addEventListener('click', verifyLicense);
        licenseInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            verifyLicense();
          }
        });
      }
    }, 100);

  // Format message with proper code block handling
  function formatMessage(content) {
    if (!content) return '';
    
    // Escape HTML first
    let escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Handle code blocks (```language\ncode\n```)
    escaped = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || 'text';
      return `<div class="code-block-container" style="margin: 8px 0; border-radius: 8px; overflow: hidden; background: #0d1045; border: 1px solid #252a65;">
        <div style="padding: 8px 12px; background: #0d0d3a; border-bottom: 1px solid #252a65; font-size: 11px; color: #94a3b8; font-weight: 600; display: flex; justify-content: space-between; align-items: center;">
          <span>${language}</span>
          <button class="copy-code-btn" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 10px; padding: 2px 6px; border-radius: 4px; transition: all 0.2s;" onmouseover="this.style.background='#252a65'; this.style.color='#fff';" onmouseout="this.style.background='transparent'; this.style.color='#94a3b8';">Copy</button>
        </div>
        <pre style="margin: 0; padding: 12px; overflow-x: auto; max-height: 300px; overflow-y: auto; color: #e2e8f0; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 12px; line-height: 1.5; white-space: pre; word-wrap: normal;"><code>${code.trim()}</code></pre>
      </div>`;
    });
    
    // Handle inline code (`code`)
    escaped = escaped.replace(/`([^`]+)`/g, '<code style="background: #0d1045; color: #4d9aff; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px;">$1</code>');
    
    // Convert line breaks to <br>
    escaped = escaped.replace(/\n/g, '<br>');
    
    return escaped;
  }

  // Check if request is for image generation
  function isImageRequest(message) {
    const imageKeywords = ['generate image', 'create image', 'draw', 'picture', 'photo', 'illustration', 'dalle', 'midjourney', 'stable diffusion', 'image generation'];
    const lowerMessage = message.toLowerCase();
    return imageKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  // Check if request is for code
  function isCodeRequest(message) {
    const codeKeywords = ['write code', 'create code', 'generate code', 'code snippet', 'program', 'function', 'script', 'hello world', 'example code'];
    const lowerMessage = message.toLowerCase();
    return codeKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  // Check if request is for document creation
  function isDocumentRequest(message) {
    const docKeywords = ['word document', 'pdf', 'create document', 'generate document', 'docx', 'export to'];
    const lowerMessage = message.toLowerCase();
    return docKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  // Get usage stats
  async function getUsageStats() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['usageStats', 'subscriptionStartDate'], (result) => {
        const stats = result.usageStats || { codeRequests: 0, imageRequests: 0 };
        const startDate = result.subscriptionStartDate || Date.now();
        const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
        
        // Reset stats if subscription is older than a year
        if (startDate < oneYearAgo) {
          stats.codeRequests = 0;
          stats.imageRequests = 0;
          chrome.storage.local.set({ 
            usageStats: stats,
            subscriptionStartDate: Date.now()
          });
        }
        
        resolve(stats);
      });
    });
  }

  // Check if user can make request
  async function canMakeRequest(message) {
    const stats = await getUsageStats();
    
    // Block image requests
    if (isImageRequest(message)) {
      return { allowed: false, reason: 'Image generation is not available in this subscription plan.' };
    }
    
    // Check code request limit
    if (isCodeRequest(message)) {
      if (stats.codeRequests >= USAGE_LIMITS.CODE_REQUESTS_PER_YEAR) {
        return { allowed: false, reason: `You've reached your annual limit of ${USAGE_LIMITS.CODE_REQUESTS_PER_YEAR} code requests. Please upgrade your subscription for more requests.` };
      }
    }
    
    return { allowed: true };
  }

  // Increment usage stats
  async function incrementUsage(message) {
    if (isCodeRequest(message)) {
      const stats = await getUsageStats();
      stats.codeRequests = (stats.codeRequests || 0) + 1;
      chrome.storage.local.set({ usageStats: stats });
    }
  }

  function showNotification(message, type = 'success') {
    const toast = document.getElementById('notificationToast');
    const messageEl = document.getElementById('notificationMessage');
    
    if (!toast || !messageEl) return;
    
    messageEl.textContent = message;
    toast.className = `notification-toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
  
  function showConfirmDialog(message, title = 'Confirm Action', onConfirm, onCancel) {
    return new Promise((resolve) => {
      const dialog = document.getElementById('confirmDialog');
      const titleEl = document.getElementById('confirmDialogTitle');
      const messageEl = document.getElementById('confirmDialogMessage');
      const confirmBtn = document.getElementById('confirmDialogConfirm');
      const cancelBtn = document.getElementById('confirmDialogCancel');
      
      if (!dialog || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
        // Fallback to native confirm if dialog elements don't exist
        const confirmed = confirm(message);
        if (confirmed && onConfirm) {
          onConfirm();
        } else if (!confirmed && onCancel) {
          onCancel();
        }
        resolve(confirmed);
        return;
      }
      
      // Clean up any existing handlers first
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      dialog.onclick = null;
      
      titleEl.textContent = title;
      messageEl.textContent = message;
      dialog.style.display = 'flex';
      dialog.style.zIndex = '2147483647'; // Ensure it's on top
      
      const cleanup = () => {
        dialog.style.display = 'none';
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        dialog.onclick = null;
      };
      
      const handleConfirm = () => {
        cleanup();
        resolve(true);
        if (onConfirm) onConfirm();
      };
      
      const handleCancel = () => {
        cleanup();
        resolve(false);
        if (onCancel) onCancel();
      };
      
      confirmBtn.onclick = handleConfirm;
      cancelBtn.onclick = handleCancel;
      
      // Close on overlay click
      dialog.onclick = (e) => {
        if (e.target === dialog) {
          handleCancel();
        }
      };
    });
  }

  // Set favicon dynamically (Chrome extension popups need this)
  try {
    const link = document.querySelector("link[rel='icon']") || document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = chrome.runtime.getURL('favicon_nimbus.png');
    if (!document.querySelector("link[rel='icon']")) {
      document.getElementsByTagName('head')[0].appendChild(link);
    }
  } catch (e) {
    // Favicon setting failed, continue silently
  }

  // Set logo dynamically (Chrome extension popups need this)
  function setLogo() {
    try {
      // Check if chrome.runtime is available
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
        return false;
      }
      
      const logoImg = document.getElementById('nimbusTitle');
      if (!logoImg) {
        return false;
      }
      
      // Ensure logo element is visible
      logoImg.style.display = '';
      logoImg.style.visibility = 'visible';
      logoImg.style.opacity = '1';
      
      // List of logo files to try in order (with fallbacks)
      const logoFiles = [
        'NimbusLogo.svg',
        'Nimbus Logo-02.svg',
        'Nimbus Logo-01.svg'
      ];
      
      // Hosted fallback URLs - try these if local files fail
      // You can host the logo on GitHub, Vercel, or any CDN and update these URLs
      const hostedFallbacks = [
        'https://leveldesignagency.github.io/Nimbus/NimbusLogo.svg', // GitHub Pages
        'https://raw.githubusercontent.com/leveldesignagency/Nimbus/main/NimbusLogo.svg', // GitHub raw
        'https://cdn.jsdelivr.net/gh/leveldesignagency/Nimbus@main/NimbusLogo.svg', // jsDelivr CDN
        // Add more fallback URLs here if needed
      ];
      
      let currentIndex = 0;
      let hostedIndex = 0;
      let loaded = false;
      let tryingHosted = false;
      
      const tryNextLogo = () => {
        if (loaded) return; // Already loaded successfully
        
        // First try all local files
        if (currentIndex < logoFiles.length) {
          const logoFile = logoFiles[currentIndex];
          try {
            const logoUrl = chrome.runtime.getURL(logoFile);
            
            // Verify the URL is valid
            if (!logoUrl || logoUrl.includes('undefined') || !logoUrl.startsWith('chrome-extension://')) {
              currentIndex++;
              tryNextLogo();
              return;
            }
            
            // Verify chrome.runtime.id exists
            try {
              const runtimeId = chrome.runtime.id;
              if (!runtimeId) {
                currentIndex++;
                tryNextLogo();
                return;
              }
            } catch (e) {
              currentIndex++;
              tryNextLogo();
              return;
            }
            
            // Clear any previous error handlers
            logoImg.onerror = null;
            logoImg.onload = null;
            
            // Ensure the image element is properly styled and visible
            logoImg.style.display = 'block';
            logoImg.style.visibility = 'visible';
            logoImg.style.opacity = '1';
            logoImg.style.width = 'auto';
            logoImg.style.height = '24px';
            logoImg.style.maxWidth = '120px';
            
            // Preload the image to verify it exists before setting on element
            const testImg = new Image();
            testImg.onload = () => {
              // Image exists and loaded, set it on the actual element
              logoImg.src = logoUrl;
              logoImg.style.display = 'block';
              logoImg.style.visibility = 'visible';
              logoImg.style.opacity = '1';
            };
            testImg.onerror = () => {
              // Image failed, try next
              if (!loaded) {
                currentIndex++;
                tryNextLogo();
              }
            };
            testImg.src = logoUrl;
            
            // Also set directly as immediate fallback
            logoImg.src = logoUrl;
            
            // Set timeout to move to next if this one doesn't load (increased to 3s)
            const timeout = setTimeout(() => {
              if (!loaded) {
                currentIndex++;
                tryNextLogo();
              }
            }, 3000);
            
            logoImg.onerror = (e) => {
              clearTimeout(timeout);
              if (!loaded) {
                currentIndex++;
                tryNextLogo();
              }
            };
            
            // If image loads successfully, hide text fallback if it exists
            logoImg.onload = () => {
              clearTimeout(timeout);
              if (!loaded) {
                loaded = true;
                const textFallback = logoImg.parentElement?.querySelector('.logo-text-fallback');
                if (textFallback) {
                  textFallback.style.display = 'none';
                }
                logoImg.style.display = '';
                logoImg.style.visibility = 'visible';
                logoImg.style.opacity = '1';
              }
            };
            return;
          } catch (e) {
            currentIndex++;
            tryNextLogo();
            return;
          }
        }
        
        // If all local files failed, try hosted fallbacks
        if (!tryingHosted && hostedFallbacks.length > 0 && hostedIndex < hostedFallbacks.length) {
          tryingHosted = true;
          const hostedUrl = hostedFallbacks[hostedIndex];
          
          // Clear any previous error handlers
          logoImg.onerror = null;
          logoImg.onload = null;
          
          // Set the src to hosted URL
          logoImg.src = hostedUrl;
          logoImg.style.display = '';
          logoImg.style.visibility = 'visible';
          logoImg.style.opacity = '1';
          
          // Set timeout to move to next hosted URL if this one doesn't load
          const timeout = setTimeout(() => {
            if (!loaded) {
              hostedIndex++;
              tryingHosted = false;
              tryNextLogo();
            }
          }, 2000);
          
          logoImg.onerror = (e) => {
            clearTimeout(timeout);
            if (!loaded) {
              hostedIndex++;
              tryingHosted = false;
              tryNextLogo();
            }
          };
          
          // If hosted image loads successfully
          logoImg.onload = () => {
            clearTimeout(timeout);
            if (!loaded) {
              loaded = true;
              const textFallback = logoImg.parentElement?.querySelector('.logo-text-fallback');
              if (textFallback) {
                textFallback.style.display = 'none';
              }
              logoImg.style.display = '';
              logoImg.style.visibility = 'visible';
              logoImg.style.opacity = '1';
            }
          };
          return;
        }
        
        // All local and hosted logos failed - show text fallback
        if (currentIndex >= logoFiles.length && (hostedIndex >= hostedFallbacks.length || hostedFallbacks.length === 0)) {
          if (logoImg.tagName === 'IMG') {
            const parent = logoImg.parentElement;
            if (parent) {
              logoImg.style.display = 'none';
              // Create text fallback if it doesn't exist
              let textFallback = parent.querySelector('.logo-text-fallback');
              if (!textFallback) {
                textFallback = document.createElement('span');
                textFallback.className = 'logo-text-fallback';
                textFallback.textContent = 'Nimbus';
                textFallback.style.cssText = 'font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: 0.5px;';
                parent.insertBefore(textFallback, logoImg);
              }
              textFallback.style.display = 'block';
            }
          }
          return;
        }
      };
      
      tryNextLogo();
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // Set logo immediately - run as early as possible with multiple retries
  function initLogo() {
    // Check if chrome.runtime is available
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
      setTimeout(initLogo, 50);
      return;
    }
    
    const logoImg = document.getElementById('nimbusTitle');
    if (!logoImg) {
      setTimeout(initLogo, 50);
      return;
    }
    
    const success = setLogo();
    if (!success) {
      setTimeout(initLogo, 100);
    }
  }
  
  // Start logo loading immediately - multiple attempts
  initLogo();
  
  // Also use the setLogo function as backup at various points
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => setLogo(), 50);
      setTimeout(() => setLogo(), 200);
      setTimeout(() => setLogo(), 500);
    });
  } else {
    setTimeout(() => setLogo(), 50);
    setTimeout(() => setLogo(), 200);
    setTimeout(() => setLogo(), 500);
  }
  
  // Also try after short delays in case the element isn't ready yet
  setTimeout(() => setLogo(), 1000);
  setTimeout(() => setLogo(), 2000);
  setTimeout(() => setLogo(), 3000);

  // Load all data on popup open
  // Load settings and translate UI on initial load (after translations object is defined)
  // Note: translateUI will be called after translations object is defined (see line ~428)
  chrome.storage.local.get(['settings'], (result) => {
    try {
      const settings = result.settings || {};
      const initialLang = settings.dictionaryLanguage || detectBrowserLanguage();
      window.currentUILanguage = initialLang;
      // Delay translateUI call to ensure translations object exists
      setTimeout(() => {
        if (typeof translations !== 'undefined') {
          translateUI(initialLang);
        }
      }, 0);
    } catch (e) {
      // Continue loading even if translation fails
    }
  });
  
  // Check for pending search (e.g., person data from content script)
  // Function to handle pending search
  function handlePendingSearch() {
    // Ensure wordOfDayDiv exists before proceeding
    const wdDiv = wordOfDayDiv || document.getElementById('wordOfDay');
    if (!wdDiv && document.readyState === 'loading') {
      setTimeout(handlePendingSearch, 200);
      return;
    }
    
    chrome.storage.local.get(['pendingSearch'], (result) => {
      if (result.pendingSearch) {
        const pending = result.pendingSearch;
        
        // Handle search type (from icon-only modal)
        if (pending.type === 'search' && pending.term) {
          if (searchInput) {
            searchInput.value = pending.term;
            executeSearch(pending.term);
          }
          chrome.storage.local.remove(['pendingSearch']);
          return;
        }
        // Person / place / org: use pending.data when available so the hub actually shows content.
        // (Re-fetch was causing empty hub when the second explain failed or returned non-entity.)
        if (pending.type === 'person' && pending.data) {
        chrome.storage.local.remove(['pendingSearch']);
          displayPersonResult(pending.term, pending.data);
          return;
        }
        if (pending.type === 'place') {
          chrome.storage.local.remove(['pendingSearch']);
          if (pending.data) {
          displayPlaceResult(pending.term, pending.data);
          } else {
            executeSearch(pending.term);
          }
          return;
        }
        if (pending.type === 'organization' && pending.data) {
          chrome.storage.local.remove(['pendingSearch']);
          displayOrganizationResult(pending.term, pending.data);
          return;
        }
        if (pending.type === 'partialName' && pending.data) {
          chrome.storage.local.remove(['pendingSearch']);
          // AI failed or timed out - show news articles in hub
          displayPartialNameResult(pending.term, pending.data, false);
          return;
        }
        if ((pending.type === 'person' || pending.type === 'place' || pending.type === 'organization') && pending.term) {
          chrome.storage.local.remove(['pendingSearch']);
          executeSearch(pending.term);
          return;
        }
        if (pending.type === 'location') {
          chrome.storage.local.remove(['pendingSearch']);
          displayLocationResult(pending.term, pending.canMap);
        } else if (pending.term) {
          chrome.storage.local.remove(['pendingSearch']);
          showWordDetails(pending.term);
        }
      }
    });
  }
  
  // Check for pending search on load (with multiple attempts to ensure we catch it)
  // Function to check pending search
  function checkPendingSearch() {
    handlePendingSearch();
  }
  
  // Check immediately
  checkPendingSearch();
  
  // Check after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkPendingSearch();
    });
  }
  
  // Check after delays (storage might not be ready immediately)
  setTimeout(checkPendingSearch, 200);
  setTimeout(checkPendingSearch, 500);
  setTimeout(checkPendingSearch, 1000);
  
  // Also listen for storage changes (in case popup is already open)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.pendingSearch) {
      setTimeout(() => {
        handlePendingSearch();
      }, 100); // Small delay to ensure storage is updated
    }
    // Listen for subscription activation
    if (areaName === 'local' && (changes.subscriptionId || changes.subscriptionActive)) {
      // Reload popup when subscription is activated
      setTimeout(() => {
        location.reload();
      }, 500);
    }
  });
  
  // Listen for subscription activation and applyPendingSearch (person/org/place from content script)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'subscriptionActivated') {
      setTimeout(() => location.reload(), 500);
    } else if (msg && msg.action === 'applyPendingSearch') {
      const run = () => {
        handlePendingSearch();
        setTimeout(handlePendingSearch, 150);
        setTimeout(handlePendingSearch, 400);
        setTimeout(handlePendingSearch, 800);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { setTimeout(run, 50); });
      } else {
        run();
      }
    }
    return false; // we never call sendResponse; avoids "message port closed" on sender
  });
  
  // Also poll for subscription activation after a checkout (in case message/storage change missed)
  chrome.storage.local.get(['tempSessionData'], async (result) => {
    if (result.tempSessionData && result.tempSessionData.checkoutInitiated) {
      const timeSinceCheckout = Date.now() - result.tempSessionData.timestamp;
      // If checkout was initiated less than 5 minutes ago, poll for activation
      if (timeSinceCheckout < 5 * 60 * 1000) {
        const pollInterval = setInterval(async () => {
          const subData = await new Promise((resolve) => {
            chrome.storage.local.get(['subscriptionActive', 'subscriptionId'], resolve);
          });
          if (subData.subscriptionActive) {
            clearInterval(pollInterval);
            chrome.storage.local.remove(['tempSessionData']);
            location.reload();
          }
        }, 2000); // Poll every 2 seconds
        
        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
        }, 5 * 60 * 1000);
      }
    }
  });
  
  // Load word of day - skip when pendingSearch has entity to show so handlePendingSearch can render it
  // Load word of day asynchronously - don't block UI
  (function loadWordOfDayImmediately() {
    const el = document.getElementById('wordOfDay');
    if (!el) {
      setTimeout(loadWordOfDayImmediately, 50);
      return;
    }
    chrome.storage.local.get(['pendingSearch'], (r) => {
      if (r.pendingSearch && r.pendingSearch.term) return;
      // Load asynchronously - don't block
      setTimeout(() => {
        loadWordOfDay().catch(err => {
          // Don't let word of day errors break the hub
        });
      }, 100);
    });
  })();
  
  // Check subscription FIRST - show payment screen immediately if not subscribed
  // This runs AFTER word of day starts loading
  (async () => {
    // Clear any URL params immediately (background script handles verification)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('session_id') || urlParams.has('success') || urlParams.has('cancelled')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // If there's a pending checkout, verify subscription first
    const pendingData = await new Promise((resolve) => {
      chrome.storage.local.get(['pendingCheckoutSessionId', 'pendingCheckoutEmail', 'checkoutInitiatedAt'], resolve);
    });
    
    if (pendingData.pendingCheckoutSessionId || pendingData.pendingCheckoutEmail) {
      const email = pendingData.pendingCheckoutEmail || await getUserEmail();
      const sessionId = pendingData.pendingCheckoutSessionId;
      
      
      // Try to verify by session ID first
      if (sessionId) {
        try {
          const sessionResponse = await fetch(`${API_BASE_URL}/get-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          
          if (sessionResponse.ok) {
            const sessionData = await sessionResponse.json();
            if (sessionData.valid) {
              // Save subscription
              await chrome.storage.local.set({
                subscriptionId: sessionData.subscriptionId,
                subscriptionExpiry: sessionData.expiryDate,
                subscriptionActive: true,
                userEmail: sessionData.email || email,
              });
              
              // Clear pending checkout
              await chrome.storage.local.remove(['pendingCheckoutSessionId', 'pendingCheckoutEmail', 'checkoutInitiatedAt']);
              
              // Small delay to ensure storage is fully written
              await new Promise(resolve => setTimeout(resolve, 100));
              location.reload();
              return;
            }
          }
        } catch (e) {
          // Error verifying by session, continue to email check
        }
      }
      
      // Fallback: verify by email
      if (email) {
        try {
          const verifyResponse = await fetch(`${API_BASE_URL}/verify-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: email }),
          });
          
          const verifyData = await verifyResponse.json();
          if (verifyData.valid) {
            // Save subscription
            await chrome.storage.local.set({
              subscriptionId: verifyData.subscriptionId,
              subscriptionExpiry: verifyData.expiryDate,
              subscriptionActive: true,
              userEmail: email,
            });
            
            // Clear pending checkout
            await chrome.storage.local.remove(['pendingCheckoutSessionId', 'pendingCheckoutEmail', 'checkoutInitiatedAt']);
            
            // Small delay to ensure storage is fully written
            await new Promise(resolve => setTimeout(resolve, 100));
            location.reload();
            return;
          }
        } catch (e) {
          // Error verifying by email, continue to subscription check
        }
      }
    }
    
    // Clear any invalid/mock subscription data from dev mode FIRST
    const storageData = await new Promise((resolve) => {
      chrome.storage.local.get(['subscriptionId', 'subscriptionActive', 'subscriptionExpiry', 'userEmail'], resolve);
    });

    // If no account data at all, show login/subscribe page (unless load unpacked)
    if (!storageData.subscriptionId && !storageData.userEmail && !isDeveloperMode()) {
      showUpgradePromptInPopup();
      return;
    }
    
    // Check subscription status
    let isActive = await checkSubscription();
    
    const currentStatus = await new Promise((resolve) => {
      chrome.storage.local.get(['subscriptionActive'], resolve);
    });
    
    if (!isDeveloperMode() && (!isActive || currentStatus.subscriptionActive !== true)) {
    // If not active, try checking by email as fallback (in case subscription was just activated)
      const email = await getUserEmail();
      if (email) {
        try {
          const verifyResponse = await fetch(`${API_BASE_URL}/verify-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: email }),
          });
          
          if (verifyResponse.ok) {
            const verifyData = await verifyResponse.json();
            if (verifyData.valid) {
              // Save subscription data
              await chrome.storage.local.set({
                subscriptionId: verifyData.subscriptionId,
                subscriptionExpiry: verifyData.expiryDate,
                subscriptionActive: true,
                userEmail: email,
              });
              await new Promise(resolve => setTimeout(resolve, 100));
              location.reload();
              return;
            }
          }
        } catch (e) {
          // Error checking by email, continue to show payment screen
        }
      }
      
      // FORCE show payment screen - no valid subscription found
      showUpgradePromptInPopup();
      return; // Stop here - don't load anything else
    }
    
    // Subscription active - load content normally
    try {
      // Ensure header is visible
      const headerContent = document.querySelector('.header-content');
      if (headerContent) {
        headerContent.style.display = '';
        headerContent.style.visibility = 'visible';
      }
      
      // Ensure all sections are visible
      document.querySelectorAll('.section').forEach(section => {
        section.style.display = 'block';
      });
      
      // Load word of day FIRST and immediately (don't wait for other content)
      // Use setTimeout to ensure DOM is fully ready - wrap in catch to prevent blocking
      setTimeout(() => {
        loadWordOfDay().catch(err => {
        });
      }, 100);
      
      // Also try loading after a short delay in case first attempt fails
      setTimeout(() => {
        const wordOfDayDiv = document.getElementById('wordOfDay');
        if (wordOfDayDiv && wordOfDayDiv.innerHTML.includes('Loading')) {
          loadWordOfDay().catch(err => {
          });
        }
      }, 2000);
      
      // Load other content in parallel
      loadConversations();
      loadFavorites();
      loadRecent();
      loadSaved();
      
      // Expand/collapse for all hub sections (auto-collapsed by default)
      const collapseConfig = [
        { header: 'wordOfDayHeader', content: 'wordOfDay', arrow: 'wordOfDayArrow', onExpand: null },
        { header: 'conversationsHeader', content: 'conversations', arrow: 'conversationsArrow', onExpand: () => loadConversations() },
        { header: 'favoritesHeader', content: 'favorites', arrow: 'favoritesArrow', onExpand: null },
        { header: 'savedHeader', content: 'saved', arrow: 'savedArrow', onExpand: null },
        { header: 'recentHeader', content: 'recent', arrow: 'recentArrow', onExpand: null }
      ];
      collapseConfig.forEach(({ header, content, arrow, onExpand }) => {
        const h = document.getElementById(header);
        const c = document.getElementById(content);
        const a = document.getElementById(arrow);
        if (!h || !c) return;
        h.style.cursor = 'pointer';
        h.addEventListener('click', (e) => {
          e.stopPropagation();
          const isHidden = c.style.display === 'none' || c.style.display === '';
          c.style.display = isHidden ? 'block' : 'none';
          if (a) a.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
          if (isHidden && onExpand) onExpand();
        });
      });
    } catch (e) {
    }
  })();

  // Nimbus title click handler - return to hub
  nimbusTitle.addEventListener('click', () => {
    returnToHub();
  });

  // Custom Dropdown Functionality
  function initCustomDropdowns() {
    const dropdowns = document.querySelectorAll('.custom-dropdown');
    
    dropdowns.forEach(dropdown => {
      // Use full-screen modal for language; skip normal dropdown behavior
      if (dropdown.id === 'languageDropdown') return;
      // Skip if already initialized
      if (dropdown.dataset.initialized === 'true') {
        return;
      }
      
      const selected = dropdown.querySelector('.custom-dropdown-selected');
      const options = dropdown.querySelectorAll('.custom-dropdown-option');
      const hiddenInput = dropdown.querySelector('input[type="hidden"]');
      const textSpan = dropdown.querySelector('.custom-dropdown-text');
      
      if (!selected || !hiddenInput || !textSpan) {
        return;
      }
      
      // Get initial value
      const initialValue = hiddenInput.value;
      const initialOption = Array.from(options).find(opt => opt.dataset.value === initialValue);
      if (initialOption && textSpan) {
        textSpan.textContent = initialOption.textContent.trim();
        options.forEach(opt => opt.classList.remove('selected'));
        initialOption.classList.add('selected');
      }
      
      // Toggle dropdown
      selected.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const isActive = dropdown.classList.contains('active');
        
        // Close all other dropdowns
        document.querySelectorAll('.custom-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.remove('active');
        });
        
        dropdown.classList.toggle('active', !isActive);
      });
      
      // Select option
      options.forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const value = option.dataset.value;
          
          // Update hidden input
          hiddenInput.value = value;
          
          // Update display text (use flag if available, otherwise text)
          if (textSpan) {
            const flag = option.dataset.flag || option.textContent.trim();
            textSpan.textContent = flag;
          }
          
          // Update selected state
          options.forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
          
          // Close dropdown
          dropdown.classList.remove('active');
          
          // Trigger change event
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
      
      // Mark as initialized
      dropdown.dataset.initialized = 'true';
    });
    
    // Close dropdowns when clicking outside (only one listener)
    if (!window._dropdownClickHandler) {
      window._dropdownClickHandler = (e) => {
        if (!e.target.closest('.custom-dropdown')) {
          document.querySelectorAll('.custom-dropdown').forEach(d => {
            d.classList.remove('active');
          });
        }
      };
      document.addEventListener('click', window._dropdownClickHandler);
    }
  }

  function initLanguageModal() {
    if (window._languageModalInited) return;
    window._languageModalInited = true;
    const languageDropdown = document.getElementById('languageDropdown');
    const languageModal = document.getElementById('languageModal');
    const languageModalBackdrop = document.getElementById('languageModalBackdrop');
    const languageModalClose = document.getElementById('languageModalClose');
    const dictionaryLanguage = document.getElementById('dictionaryLanguage');
    const textSpan = languageDropdown?.querySelector('.custom-dropdown-text');
    if (!languageDropdown || !languageModal || !dictionaryLanguage || !textSpan) return;

    function openModal() {
      const current = dictionaryLanguage.value || 'en';
      languageModal.querySelectorAll('.language-modal-option').forEach((btn) => {
        const isSelected = btn.dataset.value === current;
        btn.classList.toggle('selected', isSelected);
        btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      });
      languageModal.classList.add('open');
      languageModal.setAttribute('aria-hidden', 'false');
    }
    function closeModal() {
      languageModal.classList.remove('open');
      languageModal.setAttribute('aria-hidden', 'true');
    }

    const selected = languageDropdown.querySelector('.custom-dropdown-selected');
    if (selected) {
      selected.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal();
      });
    }
    if (languageModalBackdrop) languageModalBackdrop.addEventListener('click', closeModal);
    if (languageModalClose) languageModalClose.addEventListener('click', closeModal);

    languageModal.querySelectorAll('.language-modal-option').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const value = btn.dataset.value;
        const flag = btn.dataset.flag || value;
        dictionaryLanguage.value = value;
        textSpan.textContent = flag;
        closeModal();
        dictionaryLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPage = document.getElementById('settingsPage');
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  const mainContent = document.getElementById('mainContent');
  const refreshBtn = document.getElementById('refreshBtn');
  const savePageBtn = document.getElementById('savePageBtn');
  
  // Save this page - add current tab to Saved
  if (savePageBtn) {
    savePageBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0] || !tabs[0].url) return;
        const tab = tabs[0];
        const item = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2),
          type: 'url',
          url: tab.url,
          title: (tab.title || tab.url || 'Untitled').trim(),
          createdAt: Date.now()
        };
        getStorage('savedForLater').then(arr => {
          arr = arr || [];
          arr.unshift(item);
          if (arr.length > 80) arr = arr.slice(0, 80);
          return setStorage({ savedForLater: arr });
        }).then(() => {
          loadSaved();
          const t = translations[window.currentUILanguage || 'en'] || translations.en;
          showNotification(t.saved || 'Saved', 'success');
        }).catch(e => {
          showNotification('Could not save.', 'error');
        });
      });
    });
  }
  
  // Refresh button - reload all hub content
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      // Add rotation animation
      refreshBtn.style.transform = 'rotate(360deg)';
      refreshBtn.style.transition = 'transform 0.5s ease';
      
      // Reload all content - don't await word of day to prevent blocking
      await Promise.all([
        loadFavorites(),
        loadRecent()
      ]);
      // Load word of day separately - don't block refresh
      loadWordOfDay().catch(err => {
      });
      
      // Reset rotation after animation
      setTimeout(() => {
        refreshBtn.style.transform = 'rotate(0deg)';
      }, 500);
      
      // Show notification
      const currentLang = window.currentUILanguage || 'en';
      const t = translations[currentLang] || translations.en;
      showNotification(t.refreshComplete || 'Hub refreshed!', 'success');
    });
  }
  
  // Floating toolbar toggle button
  const toolbarToggleBtn = document.getElementById('toolbarToggleBtn');
  const toolbarToggleIcon = document.getElementById('toolbarToggleIcon');
  
  // Load toolbar visibility state
  chrome.storage.local.get(['floatToolbarHidden'], (result) => {
    const isHidden = result.floatToolbarHidden || false;
    if (toolbarToggleBtn) {
      if (isHidden) {
        toolbarToggleBtn.classList.add('hidden');
        toolbarToggleIcon.innerHTML = '<path d="M3 3h18v18H3z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>';
      } else {
        toolbarToggleBtn.classList.remove('hidden');
        toolbarToggleIcon.innerHTML = '<path d="M3 3h18v18H3z"/><path d="M9 9h6v6H9z"/>';
      }
    }
  });
  
  if (toolbarToggleBtn) {
    toolbarToggleBtn.addEventListener('click', () => {
      chrome.storage.local.get(['floatToolbarHidden'], (result) => {
        const isHidden = result.floatToolbarHidden || false;
        const newState = !isHidden;
        
        // Save new state
        chrome.storage.local.set({ floatToolbarHidden: newState }, () => {
          // Update button appearance
          if (newState) {
            toolbarToggleBtn.classList.add('hidden');
            toolbarToggleIcon.innerHTML = '<path d="M3 3h18v18H3z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>';
          } else {
            toolbarToggleBtn.classList.remove('hidden');
            toolbarToggleIcon.innerHTML = '<path d="M3 3h18v18H3z"/><path d="M9 9h6v6H9z"/>';
          }
          
          // Send message to all tabs to update toolbar visibility
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
              chrome.tabs.sendMessage(tab.id, { 
                action: 'toggleFloatingToolbar', 
                hidden: newState 
              }).catch(() => {
                // Ignore errors (tab might not have content script)
              });
            });
          });
        });
      });
    });
  }
  
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      document.body.classList.add('settings-open');
      settingsPage.style.display = 'flex';
      loadSettings();
      // Set logo in settings footer
      const settingsLogo = document.getElementById('settingsLogo');
      if (settingsLogo) {
        const logoUrl = chrome.runtime.getURL('NimbusLogo.svg');
        settingsLogo.src = logoUrl;
        settingsLogo.onerror = function() {
          this.onerror = null;
          this.src = chrome.runtime.getURL('Nimbus Logo-02.svg');
          this.onerror = function() {
            this.onerror = null;
            this.src = chrome.runtime.getURL('Nimbus Logo-01.svg');
            this.onerror = function() {
              this.style.display = 'none';
            };
          };
        };
      }
      // Initialize custom dropdowns and language modal after a brief delay to ensure DOM is ready
      setTimeout(() => {
        initCustomDropdowns();
        initLanguageModal();
      }, 50);
    });
  }
  
  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', () => {
      document.body.classList.remove('settings-open');
      settingsPage.style.display = 'none';
    });
  }
  
  // Safety: Ensure settings page is closed on initialization
  if (settingsPage) {
    settingsPage.style.display = 'none';
    document.body.classList.remove('settings-open');
  }
  
  // Safety: Ensure language modal is closed on initialization
  const languageModal = document.getElementById('languageModal');
  if (languageModal) {
    languageModal.classList.remove('open');
    languageModal.setAttribute('aria-hidden', 'true');
  }
  
  // Escape key handler to close any stuck modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close settings if open
      if (settingsPage && settingsPage.style.display !== 'none') {
        document.body.classList.remove('settings-open');
        settingsPage.style.display = 'none';
      }
      // Close language modal if open
      if (languageModal && languageModal.classList.contains('open')) {
        languageModal.classList.remove('open');
        languageModal.setAttribute('aria-hidden', 'true');
      }
    }
  });
  
  // Settings tab expand/collapse
  const settingsTabHeaders = document.querySelectorAll('.settings-tab-header');
  settingsTabHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const tabName = header.getAttribute('data-tab');
      const tabContent = document.getElementById(`tab-${tabName}`);
      
      if (tabContent) {
        const isExpanded = tabContent.classList.contains('expanded');
        
        // Close all tabs
        document.querySelectorAll('.settings-tab-content').forEach(content => {
          content.classList.remove('expanded');
        });
        document.querySelectorAll('.settings-tab-header').forEach(h => {
          h.classList.remove('active');
        });
        
        // Toggle clicked tab
        if (!isExpanded) {
          tabContent.classList.add('expanded');
          header.classList.add('active');
        }
        
        // Initialize custom dropdowns after tab expansion
        setTimeout(() => {
          initCustomDropdowns();
        }, 100);
      }
    });
  });
  
  // Load settings
  // Translation system
  const translations = {
    en: {
      settings: 'Settings',
      chooseLanguage: 'Choose Language',
      favorites: 'Favorites',
      recentSearches: 'Recent Searches',
      saved: 'Saved',
      saveForLater: 'Save for later',
      noSaved: 'No saved items yet.',
      savePage: 'Save this page',
      open: 'Open',
      remove: 'Remove',
      wordOfDay: 'Word of the Day',
      noFavorites: 'No favorites yet. Click the heart icon in tooltips to add words!',
      noRecentSearches: 'No recent searches yet. Select words on web pages to see them here!',
      subscription: 'Subscription',
      modalPlacement: 'Modal Placement',
      apiSettings: 'API Settings',
      general: 'General',
      contact: 'Contact',
      loadMore: 'Load More',
      showLess: 'Show Less',
      clearAll: 'Clear All',
      clearAllRecent: 'Clear All Recent Searches',
      clearAllRecentConfirm: 'Are you sure you want to clear all recent searches? This cannot be undone.',
      recentSearchesCleared: 'All recent searches cleared!',
      allRecentSearches: 'All Recent Searches',
      back: 'Back',
      search: 'Search',
      copy: 'Copy',
      addToFavorites: 'Add to favorites',
      removeFromFavorites: 'Remove from favorites',
      manageSubscription: 'Manage Subscription',
      signOut: 'Sign out',
      sendMessage: 'Send Message',
      name: 'Name',
      email: 'Email',
      subject: 'Subject',
      message: 'Message',
      yourMessage: 'Your message...',
      weWillGetBack: "We'll get back to you as soon as possible",
      clearAllData: 'Clear All Data',
      removeAllData: 'Remove all favorites, recent searches, and settings',
      loadingFavorites: 'Loading favorites...',
      loadingRecent: 'Loading recent searches...',
      loadingWordOfDay: 'Loading word of the day...',
      errorLoadingWordOfDay: 'Error loading word of the day.',
      searchPlaceholder: 'Search',
      searchButton: 'Search',
      settingsButton: 'Settings',
      autoRenewDesc: 'Automatically renew your subscription when it expires',
      modalPlacementDesc: 'Choose where the word explanation modal appears when you select text. Custom allows you to drag the modal to your preferred position.',
      modalDraggableDesc: 'Allow dragging the modal to reposition it (grabber handle will appear)',
      openaiKeyDesc: 'Add your OpenAI API key for enhanced explanations. Leave empty to use free dictionary API.',
      saveApiSettings: 'Save API Settings',
      incognitoDesc: 'By default, searches are not saved in incognito mode',
      removeAllDataDesc: 'Remove all favorites, recent searches, and settings',
      contactNamePlaceholder: 'Your name',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: 'Subject',
      autoRenewLabel: 'Auto-renew subscription',
      statusLabel: 'Status:',
      expiresLabel: 'Expires:',
      modalPositionLabel: 'Modal Position:',
      enableDragLabel: 'Enable drag to reposition',
      openaiKeyLabel: 'OpenAI API Key (Optional):',
      explanationStyleLabel: 'Explanation Style:',
      saveInIncognitoLabel: 'Save searches in incognito mode',
      showPhoneticLabel: 'Show phonetic pronunciation',
      showExamplesLabel: 'Show example sentences',
      examplesLabel: 'Examples',
      synonymsLabel: 'Synonyms',
      copyWord: 'Copy word',
      speakWord: 'Speak word',
      addToFavorites: 'Add to favorites',
      removeFromFavorites: 'Remove from favorites',
      search: 'Search',
      refresh: 'Refresh',
      refreshComplete: 'Hub refreshed!',
      active: 'Active',
      inactive: 'Inactive',
      notAvailable: 'N/A',
      issueTypeLabel: 'Issue Type:',
      more: 'more',
      // Modal placement options
      modalIntuitive: 'Intuitive (Default)',
      modalTop: 'Top of Selection',
      modalBottom: 'Bottom of Selection',
      modalLeft: 'Left of Selection',
      modalRight: 'Right of Selection',
      modalCenter: 'Center of Screen',
      modalCustom: 'Custom (Drag to Position)',
      // Explanation style options
      stylePlain: 'Plain English',
      styleTechnical: 'Technical',
      styleSimple: 'Simple (ELI12)',
      // Issue type options
      issueGeneral: 'General Inquiry',
      issueModalNotWorking: 'Modal Not Working on Page',
      issueWordNotFound: 'Word Not Found/Incorrect',
      issueSubscription: 'Subscription Issue',
      issueBug: 'Bug Report',
      issueFeature: 'Feature Request',
      issueOther: 'Other',
      // Placeholders
      contactNamePlaceholder: 'Your name',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'Your message...',
      recentNews: 'Recent News'
    },
    es: {
      settings: 'Configuración',
      favorites: 'Favoritos',
      recentSearches: 'Búsquedas Recientes',
      wordOfDay: 'Palabra del Día',
      noFavorites: 'Aún no hay favoritos. ¡Haz clic en el icono de corazón en las ventanas para agregar palabras!',
      noRecentSearches: 'Aún no hay búsquedas recientes. ¡Selecciona palabras en páginas web para verlas aquí!',
      subscription: 'Suscripción',
      modalPlacement: 'Posición del Modal',
      apiSettings: 'Configuración de API',
      general: 'General',
      contact: 'Contacto',
      loadMore: 'Cargar Más',
      showLess: 'Mostrar Menos',
      clearAll: 'Limpiar Todo',
      allRecentSearches: 'Todas las Búsquedas Recientes',
      back: 'Atrás',
      search: 'Buscar',
      copy: 'Copiar',
      addToFavorites: 'Agregar a favoritos',
      removeFromFavorites: 'Quitar de favoritos',
      manageSubscription: 'Gestionar Suscripción',
      signOut: 'Cerrar sesión',
      sendMessage: 'Enviar Mensaje',
      name: 'Nombre',
      email: 'Correo',
      subject: 'Asunto',
      message: 'Mensaje',
      yourMessage: 'Tu mensaje...',
      weWillGetBack: 'Te responderemos lo antes posible',
      clearAllData: 'Limpiar Todos los Datos',
      removeAllData: 'Eliminar todos los favoritos, búsquedas recientes y configuraciones',
      loadingFavorites: 'Cargando favoritos...',
      loadingRecent: 'Cargando búsquedas recientes...',
      loadingWordOfDay: 'Cargando palabra del día...',
      errorLoadingWordOfDay: 'Error al cargar la palabra del día.',
      searchPlaceholder: 'Buscar',
      searchButton: 'Buscar',
      settingsButton: 'Configuración',
      autoRenewDesc: 'Renovar automáticamente tu suscripción cuando expire',
      modalPlacementDesc: 'Elige dónde aparece el modal de explicación de palabras cuando seleccionas texto. Personalizado te permite arrastrar el modal a tu posición preferida.',
      modalDraggableDesc: 'Permitir arrastrar el modal para reposicionarlo (aparecerá un control de agarre)',
      openaiKeyDesc: 'Agrega tu clave API de OpenAI para explicaciones mejoradas. Déjalo vacío para usar la API de diccionario gratuita.',
      saveApiSettings: 'Guardar Configuración de API',
      incognitoDesc: 'Por defecto, las búsquedas no se guardan en modo incógnito',
      removeAllDataDesc: 'Eliminar todos los favoritos, búsquedas recientes y configuraciones',
      contactNamePlaceholder: 'Tu nombre',
      contactEmailPlaceholder: 'tu.email@ejemplo.com',
      contactSubjectPlaceholder: 'Asunto',
      autoRenewLabel: 'Renovar suscripción automáticamente',
      statusLabel: 'Estado:',
      expiresLabel: 'Expira:',
      modalPositionLabel: 'Posición del Modal:',
      enableDragLabel: 'Habilitar arrastre para reposicionar',
      openaiKeyLabel: 'Clave API de OpenAI (Opcional):',
      explanationStyleLabel: 'Estilo de Explicación:',
      saveInIncognitoLabel: 'Guardar búsquedas en modo incógnito',
      showPhoneticLabel: 'Mostrar pronunciación fonética',
      showExamplesLabel: 'Mostrar oraciones de ejemplo',
      examplesLabel: 'Ejemplos',
      synonymsLabel: 'Sinónimos',
      copyWord: 'Copiar palabra',
      speakWord: 'Pronunciar palabra',
      addToFavorites: 'Agregar a favoritos',
      removeFromFavorites: 'Quitar de favoritos',
      search: 'Buscar',
      issueTypeLabel: 'Tipo de Problema:',
      more: 'más',
      modalIntuitive: 'Intuitivo (Predeterminado)',
      modalTop: 'Arriba de la Selección',
      modalBottom: 'Debajo de la Selección',
      modalLeft: 'Izquierda de la Selección',
      modalRight: 'Derecha de la Selección',
      modalCenter: 'Centro de la Pantalla',
      modalCustom: 'Personalizado (Arrastrar para Posicionar)',
      stylePlain: 'Inglés Simple',
      styleTechnical: 'Técnico',
      styleSimple: 'Simple (ELI12)',
      issueGeneral: 'Consulta General',
      issueModalNotWorking: 'Modal No Funciona en la Página',
      issueWordNotFound: 'Palabra No Encontrada/Incorrecta',
      issueSubscription: 'Problema de Suscripción',
      issueBug: 'Reporte de Error',
      issueFeature: 'Solicitud de Función',
      issueOther: 'Otro',
      contactNamePlaceholder: 'Tu nombre',
      contactEmailPlaceholder: 'tu.email@ejemplo.com',
      contactMessagePlaceholder: 'Tu mensaje...',
      recentNews: 'Noticias Recientes'
    },
    fr: {
      settings: 'Paramètres',
      favorites: 'Favoris',
      recentSearches: 'Recherches Récentes',
      wordOfDay: 'Mot du Jour',
      noFavorites: 'Aucun favori pour le moment. Cliquez sur l\'icône cœur dans les bulles pour ajouter des mots!',
      noRecentSearches: 'Aucune recherche récente pour le moment. Sélectionnez des mots sur les pages web pour les voir ici!',
      subscription: 'Abonnement',
      modalPlacement: 'Position du Modal',
      apiSettings: 'Paramètres API',
      general: 'Général',
      contact: 'Contact',
      loadMore: 'Charger Plus',
      showLess: 'Afficher Moins',
      clearAll: 'Tout Effacer',
      allRecentSearches: 'Toutes les Recherches Récentes',
      back: 'Retour',
      search: 'Rechercher',
      copy: 'Copier',
      addToFavorites: 'Ajouter aux favoris',
      removeFromFavorites: 'Retirer des favoris',
      manageSubscription: 'Gérer l\'Abonnement',
      signOut: 'Déconnexion',
      sendMessage: 'Envoyer le Message',
      name: 'Nom',
      email: 'Email',
      subject: 'Sujet',
      message: 'Message',
      yourMessage: 'Votre message...',
      weWillGetBack: 'Nous vous répondrons dès que possible',
      clearAllData: 'Effacer Toutes les Données',
      removeAllData: 'Supprimer tous les favoris, recherches récentes et paramètres',
      loadingFavorites: 'Chargement des favoris...',
      loadingRecent: 'Chargement des recherches récentes...',
      loadingWordOfDay: 'Chargement du mot du jour...',
      errorLoadingWordOfDay: 'Erreur lors du chargement du mot du jour.',
      searchPlaceholder: 'Rechercher',
      searchButton: 'Rechercher',
      settingsButton: 'Paramètres',
      autoRenewDesc: 'Renouveler automatiquement votre abonnement à l\'expiration',
      modalPlacementDesc: 'Choisissez où apparaît le modal d\'explication de mot lorsque vous sélectionnez du texte. Personnalisé vous permet de faire glisser le modal à votre position préférée.',
      modalDraggableDesc: 'Permettre de faire glisser le modal pour le repositionner (une poignée de préhension apparaîtra)',
      openaiKeyDesc: 'Ajoutez votre clé API OpenAI pour des explications améliorées. Laissez vide pour utiliser l\'API de dictionnaire gratuite.',
      saveApiSettings: 'Enregistrer les Paramètres API',
      incognitoDesc: 'Par défaut, les recherches ne sont pas enregistrées en mode navigation privée',
      removeAllDataDesc: 'Supprimer tous les favoris, recherches récentes et paramètres',
      contactNamePlaceholder: 'Votre nom',
      contactEmailPlaceholder: 'votre.email@exemple.com',
      contactSubjectPlaceholder: 'Sujet',
      autoRenewLabel: 'Renouveler automatiquement l\'abonnement',
      statusLabel: 'Statut:',
      expiresLabel: 'Expire:',
      modalPositionLabel: 'Position du Modal:',
      enableDragLabel: 'Activer le glisser pour repositionner',
      openaiKeyLabel: 'Clé API OpenAI (Optionnelle):',
      explanationStyleLabel: 'Style d\'Explication:',
      saveInIncognitoLabel: 'Enregistrer les recherches en mode navigation privée',
      showPhoneticLabel: 'Afficher la prononciation phonétique',
      showExamplesLabel: 'Afficher les phrases d\'exemple',
      examplesLabel: 'Exemples',
      synonymsLabel: 'Synonymes',
      copyWord: 'Copier le mot',
      speakWord: 'Prononcer le mot',
      addToFavorites: 'Ajouter aux favoris',
      removeFromFavorites: 'Retirer des favoris',
      search: 'Rechercher',
      refresh: 'Actualiser',
      refreshComplete: 'Hub actualisé !',
      active: 'Actif',
      inactive: 'Inactif',
      notAvailable: 'N/D',
      issueTypeLabel: 'Type de Problème:',
      more: 'plus',
      modalIntuitive: 'Intuitif (Par Défaut)',
      modalTop: 'Au-dessus de la Sélection',
      modalBottom: 'En-dessous de la Sélection',
      modalLeft: 'À Gauche de la Sélection',
      modalRight: 'À Droite de la Sélection',
      modalCenter: 'Centre de l\'Écran',
      modalCustom: 'Personnalisé (Glisser pour Positionner)',
      stylePlain: 'Anglais Simple',
      styleTechnical: 'Technique',
      styleSimple: 'Simple (ELI12)',
      issueGeneral: 'Demande Générale',
      issueModalNotWorking: 'Modal Ne Fonctionne Pas sur la Page',
      issueWordNotFound: 'Mot Non Trouvé/Incorrect',
      issueSubscription: 'Problème d\'Abonnement',
      issueBug: 'Rapport de Bug',
      issueFeature: 'Demande de Fonctionnalité',
      issueOther: 'Autre',
      contactNamePlaceholder: 'Votre nom',
      contactEmailPlaceholder: 'votre.email@exemple.com',
      contactMessagePlaceholder: 'Votre message...',
      recentNews: 'Actualités Récentes'
    },
    de: {
      settings: 'Einstellungen',
      favorites: 'Favoriten',
      recentSearches: 'Letzte Suchen',
      wordOfDay: 'Wort des Tages',
      noFavorites: 'Noch keine Favoriten. Klicken Sie auf das Herzsymbol in den Tooltips, um Wörter hinzuzufügen!',
      noRecentSearches: 'Noch keine letzten Suchen. Wählen Sie Wörter auf Webseiten aus, um sie hier zu sehen!',
      subscription: 'Abonnement',
      modalPlacement: 'Modal-Position',
      apiSettings: 'API-Einstellungen',
      general: 'Allgemein',
      contact: 'Kontakt',
      loadMore: 'Mehr Laden',
      showLess: 'Weniger Anzeigen',
      clearAll: 'Alles Löschen',
      allRecentSearches: 'Alle Letzten Suchen',
      back: 'Zurück',
      search: 'Suchen',
      copy: 'Kopieren',
      addToFavorites: 'Zu Favoriten hinzufügen',
      removeFromFavorites: 'Aus Favoriten entfernen',
      manageSubscription: 'Abonnement Verwalten',
      signOut: 'Abmelden',
      sendMessage: 'Nachricht Senden',
      name: 'Name',
      email: 'E-Mail',
      subject: 'Betreff',
      message: 'Nachricht',
      yourMessage: 'Ihre Nachricht...',
      weWillGetBack: 'Wir werden uns so schnell wie möglich bei Ihnen melden',
      clearAllData: 'Alle Daten Löschen',
      removeAllData: 'Alle Favoriten, letzten Suchen und Einstellungen entfernen',
      loadingFavorites: 'Favoriten werden geladen...',
      loadingRecent: 'Letzte Suchen werden geladen...',
      loadingWordOfDay: 'Wort des Tages wird geladen...',
      errorLoadingWordOfDay: 'Fehler beim Laden des Wortes des Tages.',
      searchPlaceholder: 'Suchen',
      searchButton: 'Suchen',
      settingsButton: 'Einstellungen',
      autoRenewDesc: 'Ihr Abonnement automatisch erneuern, wenn es abläuft',
      modalPlacementDesc: 'Wählen Sie, wo das Wort-Erklärungs-Modal erscheint, wenn Sie Text auswählen. Benutzerdefiniert ermöglicht es Ihnen, das Modal an Ihre bevorzugte Position zu ziehen.',
      modalDraggableDesc: 'Zulassen, dass das Modal zum Neupositionieren gezogen wird (ein Greifgriff erscheint)',
      openaiKeyDesc: 'Fügen Sie Ihren OpenAI API-Schlüssel für verbesserte Erklärungen hinzu. Leer lassen, um die kostenlose Wörterbuch-API zu verwenden.',
      saveApiSettings: 'API-Einstellungen Speichern',
      incognitoDesc: 'Standardmäßig werden Suchen im Inkognito-Modus nicht gespeichert',
      removeAllDataDesc: 'Alle Favoriten, letzten Suchen und Einstellungen entfernen',
      contactNamePlaceholder: 'Ihr Name',
      contactEmailPlaceholder: 'ihre.email@beispiel.com',
      contactSubjectPlaceholder: 'Betreff',
      autoRenewLabel: 'Abonnement automatisch erneuern',
      statusLabel: 'Status:',
      expiresLabel: 'Läuft ab:',
      modalPositionLabel: 'Modal-Position:',
      enableDragLabel: 'Ziehen zum Neupositionieren aktivieren',
      openaiKeyLabel: 'OpenAI API-Schlüssel (Optional):',
      explanationStyleLabel: 'Erklärungsstil:',
      saveInIncognitoLabel: 'Suchen im Inkognito-Modus speichern',
      showPhoneticLabel: 'Phonetische Aussprache anzeigen',
      showExamplesLabel: 'Beispielsätze anzeigen',
      examplesLabel: 'Beispiele',
      synonymsLabel: 'Synonyme',
      copyWord: 'Wort kopieren',
      speakWord: 'Wort aussprechen',
      addToFavorites: 'Zu Favoriten hinzufügen',
      removeFromFavorites: 'Aus Favoriten entfernen',
      search: 'Suchen',
      refresh: 'Aktualisieren',
      refreshComplete: 'Hub aktualisiert!',
      active: 'Aktiv',
      inactive: 'Inaktiv',
      notAvailable: 'N/V',
      issueTypeLabel: 'Problemtyp:',
      more: 'mehr',
      modalIntuitive: 'Intuitiv (Standard)',
      modalTop: 'Oberhalb der Auswahl',
      modalBottom: 'Unterhalb der Auswahl',
      modalLeft: 'Links von der Auswahl',
      modalRight: 'Rechts von der Auswahl',
      modalCenter: 'Bildschirmmitte',
      modalCustom: 'Benutzerdefiniert (Ziehen zum Positionieren)',
      stylePlain: 'Einfaches Englisch',
      styleTechnical: 'Technisch',
      styleSimple: 'Einfach (ELI12)',
      issueGeneral: 'Allgemeine Anfrage',
      issueModalNotWorking: 'Modal Funktioniert Nicht auf der Seite',
      issueWordNotFound: 'Wort Nicht Gefunden/Falsch',
      issueSubscription: 'Abonnement-Problem',
      issueBug: 'Fehlerbericht',
      issueFeature: 'Funktionsanfrage',
      issueOther: 'Andere',
      contactNamePlaceholder: 'Ihr Name',
      contactEmailPlaceholder: 'ihre.email@beispiel.com',
      contactMessagePlaceholder: 'Ihre Nachricht...',
      recentNews: 'Aktuelle Nachrichten'
    },
    it: {
      settings: 'Impostazioni',
      favorites: 'Preferiti',
      recentSearches: 'Ricerche Recenti',
      wordOfDay: 'Parola del Giorno',
      noFavorites: 'Nessun preferito ancora. Clicca sull\'icona del cuore nei tooltip per aggiungere parole!',
      noRecentSearches: 'Nessuna ricerca recente ancora. Seleziona parole sulle pagine web per vederle qui!',
      subscription: 'Abbonamento',
      modalPlacement: 'Posizione del Modale',
      apiSettings: 'Impostazioni API',
      general: 'Generale',
      contact: 'Contatto',
      loadMore: 'Carica Altro',
      showLess: 'Mostra Meno',
      clearAll: 'Cancella Tutto',
      allRecentSearches: 'Tutte le Ricerche Recenti',
      back: 'Indietro',
      search: 'Cerca',
      copy: 'Copia',
      addToFavorites: 'Aggiungi ai preferiti',
      removeFromFavorites: 'Rimuovi dai preferiti',
      manageSubscription: 'Gestisci Abbonamento',
      signOut: 'Esci',
      sendMessage: 'Invia Messaggio',
      name: 'Nome',
      email: 'Email',
      subject: 'Oggetto',
      message: 'Messaggio',
      yourMessage: 'Il tuo messaggio...',
      weWillGetBack: 'Ti risponderemo il prima possibile',
      clearAllData: 'Cancella Tutti i Dati',
      removeAllData: 'Rimuovi tutti i preferiti, ricerche recenti e impostazioni',
      loadingFavorites: 'Caricamento preferiti...',
      loadingRecent: 'Caricamento ricerche recenti...',
      loadingWordOfDay: 'Caricamento parola del giorno...',
      errorLoadingWordOfDay: 'Errore nel caricamento della parola del giorno.',
      searchPlaceholder: 'Cerca',
      searchButton: 'Cerca',
      settingsButton: 'Impostazioni',
      autoRenewDesc: 'Rinnova automaticamente il tuo abbonamento alla scadenza',
      modalPlacementDesc: 'Scegli dove appare il modale di spiegazione della parola quando selezioni il testo. Personalizzato ti consente di trascinare il modale nella posizione preferita.',
      modalDraggableDesc: 'Consenti di trascinare il modale per riposizionarlo (apparirà una maniglia di trascinamento)',
      openaiKeyDesc: 'Aggiungi la tua chiave API OpenAI per spiegazioni migliorate. Lascia vuoto per usare l\'API del dizionario gratuito.',
      saveApiSettings: 'Salva Impostazioni API',
      incognitoDesc: 'Per impostazione predefinita, le ricerche non vengono salvate in modalità incognito',
      removeAllDataDesc: 'Rimuovi tutti i preferiti, ricerche recenti e impostazioni',
      contactNamePlaceholder: 'Il tuo nome',
      contactEmailPlaceholder: 'tua.email@esempio.com',
      contactSubjectPlaceholder: 'Oggetto',
      autoRenewLabel: 'Rinnova abbonamento automaticamente',
      statusLabel: 'Stato:',
      expiresLabel: 'Scade:',
      modalPositionLabel: 'Posizione del Modale:',
      enableDragLabel: 'Abilita trascinamento per riposizionare',
      openaiKeyLabel: 'Chiave API OpenAI (Opzionale):',
      explanationStyleLabel: 'Stile di Spiegazione:',
      saveInIncognitoLabel: 'Salva ricerche in modalità incognito',
      showPhoneticLabel: 'Mostra pronuncia fonetica',
      showExamplesLabel: 'Mostra frasi di esempio',
      examplesLabel: 'Esempi',
      synonymsLabel: 'Sinonimi',
      copyWord: 'Copia parola',
      speakWord: 'Pronuncia parola',
      addToFavorites: 'Aggiungi ai preferiti',
      removeFromFavorites: 'Rimuovi dai preferiti',
      search: 'Cerca',
      refresh: 'Aggiorna',
      refreshComplete: 'Hub aggiornato!',
      active: 'Attivo',
      inactive: 'Inattivo',
      notAvailable: 'N/D',
      issueTypeLabel: 'Tipo di Problema:',
      more: 'di più',
      modalIntuitive: 'Intuitivo (Predefinito)',
      modalTop: 'Sopra la Selezione',
      modalBottom: 'Sotto la Selezione',
      modalLeft: 'A Sinistra della Selezione',
      modalRight: 'A Destra della Selezione',
      modalCenter: 'Centro dello Schermo',
      modalCustom: 'Personalizzato (Trascina per Posizionare)',
      stylePlain: 'Inglese Semplice',
      styleTechnical: 'Tecnico',
      styleSimple: 'Semplice (ELI12)',
      issueGeneral: 'Richiesta Generale',
      issueModalNotWorking: 'Modal Non Funziona sulla Pagina',
      issueWordNotFound: 'Parola Non Trovata/Incorretta',
      issueSubscription: 'Problema di Abbonamento',
      issueBug: 'Segnalazione Bug',
      issueFeature: 'Richiesta Funzionalità',
      issueOther: 'Altro',
      contactNamePlaceholder: 'Il tuo nome',
      contactEmailPlaceholder: 'tua.email@esempio.com',
      contactMessagePlaceholder: 'Il tuo messaggio...',
      recentNews: 'Notizie Recenti'
    },
    pt: {
      settings: 'Configurações',
      favorites: 'Favoritos',
      recentSearches: 'Pesquisas Recentes',
      wordOfDay: 'Palavra do Dia',
      noFavorites: 'Ainda não há favoritos. Clique no ícone de coração nas dicas para adicionar palavras!',
      noRecentSearches: 'Ainda não há pesquisas recentes. Selecione palavras em páginas da web para vê-las aqui!',
      subscription: 'Assinatura',
      modalPlacement: 'Posição do Modal',
      apiSettings: 'Configurações da API',
      general: 'Geral',
      contact: 'Contato',
      loadMore: 'Carregar Mais',
      showLess: 'Mostrar Menos',
      clearAll: 'Limpar Tudo',
      allRecentSearches: 'Todas as Pesquisas Recentes',
      back: 'Voltar',
      search: 'Pesquisar',
      copy: 'Copiar',
      addToFavorites: 'Adicionar aos favoritos',
      removeFromFavorites: 'Remover dos favoritos',
      manageSubscription: 'Gerenciar Assinatura',
      signOut: 'Sair',
      sendMessage: 'Enviar Mensagem',
      name: 'Nome',
      email: 'Email',
      subject: 'Assunto',
      message: 'Mensagem',
      yourMessage: 'Sua mensagem...',
      weWillGetBack: 'Entraremos em contato o mais rápido possível',
      clearAllData: 'Limpar Todos os Dados',
      removeAllData: 'Remover todos os favoritos, pesquisas recentes e configurações',
      loadingFavorites: 'Carregando favoritos...',
      loadingRecent: 'Carregando pesquisas recentes...',
      loadingWordOfDay: 'Carregando palavra do dia...',
      errorLoadingWordOfDay: 'Erro ao carregar a palavra do dia.',
      searchPlaceholder: 'Pesquisar',
      searchButton: 'Pesquisar',
      settingsButton: 'Configurações',
      autoRenewDesc: 'Renovar automaticamente sua assinatura quando expirar',
      modalPlacementDesc: 'Escolha onde o modal de explicação de palavra aparece quando você seleciona texto. Personalizado permite arrastar o modal para sua posição preferida.',
      modalDraggableDesc: 'Permitir arrastar o modal para reposicioná-lo (um controle de arraste aparecerá)',
      openaiKeyDesc: 'Adicione sua chave API OpenAI para explicações aprimoradas. Deixe vazio para usar a API de dicionário gratuito.',
      saveApiSettings: 'Salvar Configurações da API',
      incognitoDesc: 'Por padrão, as pesquisas não são salvas no modo anônimo',
      removeAllDataDesc: 'Remover todos os favoritos, pesquisas recentes e configurações',
      contactNamePlaceholder: 'Seu nome',
      contactEmailPlaceholder: 'seu.email@exemplo.com',
      contactSubjectPlaceholder: 'Assunto',
      autoRenewLabel: 'Renovar assinatura automaticamente',
      statusLabel: 'Status:',
      expiresLabel: 'Expira:',
      modalPositionLabel: 'Posição do Modal:',
      enableDragLabel: 'Habilitar arrastar para reposicionar',
      openaiKeyLabel: 'Chave API OpenAI (Opcional):',
      explanationStyleLabel: 'Estilo de Explicação:',
      saveInIncognitoLabel: 'Salvar pesquisas no modo anônimo',
      showPhoneticLabel: 'Mostrar pronúncia fonética',
      showExamplesLabel: 'Mostrar frases de exemplo',
      examplesLabel: 'Exemplos',
      synonymsLabel: 'Sinônimos',
      copyWord: 'Copiar palavra',
      speakWord: 'Pronunciar palavra',
      addToFavorites: 'Adicionar aos favoritos',
      removeFromFavorites: 'Remover dos favoritos',
      search: 'Pesquisar',
      refresh: 'Atualizar',
      refreshComplete: 'Hub atualizado!',
      active: 'Ativo',
      inactive: 'Inativo',
      notAvailable: 'N/D',
      issueTypeLabel: 'Tipo de Problema:',
      more: 'mais',
      modalIntuitive: 'Intuitivo (Padrão)',
      modalTop: 'Acima da Seleção',
      modalBottom: 'Abaixo da Seleção',
      modalLeft: 'À Esquerda da Seleção',
      modalRight: 'À Direita da Seleção',
      modalCenter: 'Centro da Tela',
      modalCustom: 'Personalizado (Arrastar para Posicionar)',
      stylePlain: 'Inglês Simples',
      styleTechnical: 'Técnico',
      styleSimple: 'Simples (ELI12)',
      issueGeneral: 'Consulta Geral',
      issueModalNotWorking: 'Modal Não Funciona na Página',
      issueWordNotFound: 'Palavra Não Encontrada/Incorreta',
      issueSubscription: 'Problema de Assinatura',
      issueBug: 'Relatório de Bug',
      issueFeature: 'Solicitação de Recurso',
      issueOther: 'Outro',
      contactNamePlaceholder: 'Seu nome',
      contactEmailPlaceholder: 'seu.email@exemplo.com',
      contactMessagePlaceholder: 'Sua mensagem...',
      recentNews: 'Notícias Recentes'
    },
    ru: {
      settings: 'Настройки',
      favorites: 'Избранное',
      recentSearches: 'Недавние Поиски',
      wordOfDay: 'Слово Дня',
      noFavorites: 'Пока нет избранного. Нажмите на иконку сердца во всплывающих подсказках, чтобы добавить слова!',
      noRecentSearches: 'Пока нет недавних поисков. Выберите слова на веб-страницах, чтобы увидеть их здесь!',
      subscription: 'Подписка',
      modalPlacement: 'Позиция Модального Окна',
      apiSettings: 'Настройки API',
      general: 'Общие',
      contact: 'Контакты',
      loadMore: 'Загрузить Больше',
      showLess: 'Показать Меньше',
      clearAll: 'Очистить Все',
      allRecentSearches: 'Все Недавние Поиски',
      back: 'Назад',
      search: 'Поиск',
      copy: 'Копировать',
      addToFavorites: 'Добавить в избранное',
      removeFromFavorites: 'Удалить из избранного',
      manageSubscription: 'Управление Подпиской',
      signOut: 'Выйти',
      sendMessage: 'Отправить Сообщение',
      name: 'Имя',
      email: 'Email',
      subject: 'Тема',
      message: 'Сообщение',
      yourMessage: 'Ваше сообщение...',
      weWillGetBack: 'Мы свяжемся с вами как можно скорее',
      clearAllData: 'Очистить Все Данные',
      removeAllData: 'Удалить все избранное, недавние поиски и настройки',
      loadingFavorites: 'Загрузка избранного...',
      loadingRecent: 'Загрузка недавних поисков...',
      loadingWordOfDay: 'Загрузка слова дня...',
      errorLoadingWordOfDay: 'Ошибка загрузки слова дня.',
      searchPlaceholder: 'Поиск',
      searchButton: 'Поиск',
      settingsButton: 'Настройки',
      autoRenewDesc: 'Автоматически продлевать подписку при истечении',
      modalPlacementDesc: 'Выберите, где появляется модальное окно объяснения слова при выборе текста. Пользовательский позволяет перетаскивать модальное окно в предпочтительное положение.',
      modalDraggableDesc: 'Разрешить перетаскивание модального окна для изменения его положения (появится ручка захвата)',
      openaiKeyDesc: 'Добавьте ваш ключ API OpenAI для улучшенных объяснений. Оставьте пустым, чтобы использовать бесплатный API словаря.',
      saveApiSettings: 'Сохранить Настройки API',
      incognitoDesc: 'По умолчанию поиски не сохраняются в режиме инкогнито',
      removeAllDataDesc: 'Удалить все избранное, недавние поиски и настройки',
      contactNamePlaceholder: 'Ваше имя',
      contactEmailPlaceholder: 'ваш.email@пример.com',
      contactSubjectPlaceholder: 'Тема',
      autoRenewLabel: 'Автоматически продлевать подписку',
      statusLabel: 'Статус:',
      expiresLabel: 'Истекает:',
      modalPositionLabel: 'Позиция Модального Окна:',
      enableDragLabel: 'Включить перетаскивание для изменения положения',
      openaiKeyLabel: 'Ключ API OpenAI (Необязательно):',
      explanationStyleLabel: 'Стиль Объяснения:',
      saveInIncognitoLabel: 'Сохранять поиски в режиме инкогнито',
      showPhoneticLabel: 'Показывать фонетическое произношение',
      showExamplesLabel: 'Показывать примеры предложений',
      examplesLabel: 'Примеры',
      synonymsLabel: 'Синонимы',
      copyWord: 'Копировать слово',
      speakWord: 'Произнести слово',
      addToFavorites: 'Добавить в избранное',
      removeFromFavorites: 'Удалить из избранного',
      search: 'Поиск',
      refresh: 'Обновить',
      refreshComplete: 'Хаб обновлен!',
      active: 'Активен',
      inactive: 'Неактивен',
      notAvailable: 'Н/Д',
      issueTypeLabel: 'Тип Проблемы:',
      more: 'больше',
      modalIntuitive: 'Интуитивно (По Умолчанию)',
      modalTop: 'Над Выделением',
      modalBottom: 'Под Выделением',
      modalLeft: 'Слева от Выделения',
      modalRight: 'Справа от Выделения',
      modalCenter: 'Центр Экрана',
      modalCustom: 'Пользовательский (Перетащить для Позиционирования)',
      stylePlain: 'Простой Английский',
      styleTechnical: 'Технический',
      styleSimple: 'Простой (ELI12)',
      issueGeneral: 'Общий Запрос',
      issueModalNotWorking: 'Модальное Окно Не Работает на Странице',
      issueWordNotFound: 'Слово Не Найдено/Неверно',
      issueSubscription: 'Проблема с Подпиской',
      issueBug: 'Сообщение об Ошибке',
      issueFeature: 'Запрос Функции',
      issueOther: 'Другое',
      contactNamePlaceholder: 'Ваше имя',
      contactEmailPlaceholder: 'ваш.email@пример.com',
      contactMessagePlaceholder: 'Ваше сообщение...',
      recentNews: 'Последние Новости'
    },
    ja: {
      settings: '設定',
      favorites: 'お気に入り',
      recentSearches: '最近の検索',
      wordOfDay: '今日の単語',
      noFavorites: 'まだお気に入りがありません。ツールチップのハートアイコンをクリックして単語を追加してください！',
      noRecentSearches: 'まだ最近の検索がありません。ウェブページで単語を選択すると、ここに表示されます！',
      subscription: 'サブスクリプション',
      modalPlacement: 'モーダルの位置',
      apiSettings: 'API設定',
      general: '一般',
      contact: 'お問い合わせ',
      loadMore: 'さらに読み込む',
      showLess: '表示を減らす',
      clearAll: 'すべてクリア',
      allRecentSearches: 'すべての最近の検索',
      back: '戻る',
      search: '検索',
      copy: 'コピー',
      addToFavorites: 'お気に入りに追加',
      removeFromFavorites: 'お気に入りから削除',
      manageSubscription: 'サブスクリプション管理',
      signOut: 'サインアウト',
      sendMessage: 'メッセージを送信',
      name: '名前',
      email: 'メール',
      subject: '件名',
      message: 'メッセージ',
      yourMessage: 'あなたのメッセージ...',
      weWillGetBack: 'できるだけ早くご連絡いたします',
      clearAllData: 'すべてのデータをクリア',
      removeAllData: 'すべてのお気に入り、最近の検索、設定を削除',
      loadingFavorites: 'お気に入りを読み込み中...',
      loadingRecent: '最近の検索を読み込み中...',
      loadingWordOfDay: '今日の単語を読み込み中...',
      errorLoadingWordOfDay: '今日の単語の読み込みエラー。',
      searchPlaceholder: '検索',
      searchButton: '検索',
      settingsButton: '設定',
      autoRenewDesc: '期限切れ時にサブスクリプションを自動的に更新',
      modalPlacementDesc: 'テキストを選択したときに単語説明モーダルが表示される場所を選択します。カスタムでは、モーダルを希望の位置にドラッグできます。',
      modalDraggableDesc: 'モーダルをドラッグして再配置できるようにする（グリッパーハンドルが表示されます）',
      openaiKeyDesc: '強化された説明のためにOpenAI APIキーを追加してください。空のままにすると、無料の辞書APIが使用されます。',
      saveApiSettings: 'API設定を保存',
      incognitoDesc: 'デフォルトでは、シークレットモードでは検索が保存されません',
      removeAllDataDesc: 'すべてのお気に入り、最近の検索、設定を削除',
      contactNamePlaceholder: 'お名前',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: '件名',
      autoRenewLabel: 'サブスクリプションを自動更新',
      statusLabel: 'ステータス:',
      expiresLabel: '有効期限:',
      modalPositionLabel: 'モーダルの位置:',
      enableDragLabel: 'ドラッグで再配置を有効にする',
      openaiKeyLabel: 'OpenAI APIキー（オプション）:',
      explanationStyleLabel: '説明スタイル:',
      saveInIncognitoLabel: 'シークレットモードで検索を保存',
      showPhoneticLabel: '音声発音を表示',
      showExamplesLabel: '例文を表示',
      examplesLabel: '例',
      synonymsLabel: '同義語',
      copyWord: '単語をコピー',
      speakWord: '単語を発音',
      addToFavorites: 'お気に入りに追加',
      removeFromFavorites: 'お気に入りから削除',
      search: '検索',
      refresh: '更新',
      refreshComplete: 'ハブを更新しました！',
      active: 'アクティブ',
      inactive: '非アクティブ',
      notAvailable: 'N/A',
      issueTypeLabel: '問題の種類:',
      more: 'もっと',
      modalIntuitive: '直感的（デフォルト）',
      modalTop: '選択の上',
      modalBottom: '選択の下',
      modalLeft: '選択の左',
      modalRight: '選択の右',
      modalCenter: '画面中央',
      modalCustom: 'カスタム（ドラッグして配置）',
      stylePlain: 'シンプルな英語',
      styleTechnical: '技術的',
      styleSimple: 'シンプル（ELI12）',
      issueGeneral: '一般的な問い合わせ',
      issueModalNotWorking: 'ページでモーダルが動作しない',
      issueWordNotFound: '単語が見つからない/不正',
      issueSubscription: 'サブスクリプションの問題',
      issueBug: 'バグレポート',
      issueFeature: '機能リクエスト',
      issueOther: 'その他',
      contactNamePlaceholder: 'お名前',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'メッセージ...',
      recentNews: '最近のニュース'
    },
    zh: {
      settings: '设置',
      favorites: '收藏',
      recentSearches: '最近搜索',
      wordOfDay: '每日一词',
      noFavorites: '还没有收藏。点击提示中的心形图标来添加单词！',
      noRecentSearches: '还没有最近搜索。在网页上选择单词以在此处查看！',
      subscription: '订阅',
      modalPlacement: '模态框位置',
      apiSettings: 'API设置',
      general: '常规',
      contact: '联系',
      loadMore: '加载更多',
      showLess: '显示更少',
      clearAll: '清除全部',
      allRecentSearches: '所有最近搜索',
      back: '返回',
      search: '搜索',
      copy: '复制',
      addToFavorites: '添加到收藏',
      removeFromFavorites: '从收藏中移除',
      manageSubscription: '管理订阅',
      signOut: '退出登录',
      sendMessage: '发送消息',
      name: '姓名',
      email: '邮箱',
      subject: '主题',
      message: '消息',
      yourMessage: '您的消息...',
      weWillGetBack: '我们会尽快回复您',
      clearAllData: '清除所有数据',
      removeAllData: '删除所有收藏、最近搜索和设置',
      loadingFavorites: '正在加载收藏...',
      loadingRecent: '正在加载最近搜索...',
      loadingWordOfDay: '正在加载每日一词...',
      errorLoadingWordOfDay: '加载每日一词时出错。',
      searchPlaceholder: '搜索',
      searchButton: '搜索',
      settingsButton: '设置',
      autoRenewDesc: '到期时自动续订您的订阅',
      modalPlacementDesc: '选择选择文本时单词解释模态框出现的位置。自定义允许您将模态框拖到首选位置。',
      modalDraggableDesc: '允许拖动模态框以重新定位（将出现抓取手柄）',
      openaiKeyDesc: '添加您的OpenAI API密钥以获得增强的解释。留空以使用免费字典API。',
      saveApiSettings: '保存API设置',
      incognitoDesc: '默认情况下，在隐身模式下不保存搜索',
      removeAllDataDesc: '删除所有收藏、最近搜索和设置',
      contactNamePlaceholder: '您的姓名',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: '主题',
      autoRenewLabel: '自动续订订阅',
      statusLabel: '状态:',
      expiresLabel: '到期:',
      modalPositionLabel: '模态框位置:',
      enableDragLabel: '启用拖动重新定位',
      openaiKeyLabel: 'OpenAI API密钥（可选）:',
      explanationStyleLabel: '解释风格:',
      saveInIncognitoLabel: '在隐身模式下保存搜索',
      showPhoneticLabel: '显示音标发音',
      showExamplesLabel: '显示例句',
      examplesLabel: '例子',
      synonymsLabel: '同义词',
      copyWord: '复制单词',
      speakWord: '朗读单词',
      addToFavorites: '添加到收藏',
      removeFromFavorites: '从收藏中移除',
      search: '搜索',
      refresh: '刷新',
      refreshComplete: '中心已刷新！',
      active: '活跃',
      inactive: '非活跃',
      notAvailable: '不适用',
      issueTypeLabel: '问题类型:',
      more: '更多',
      modalIntuitive: '直观（默认）',
      modalTop: '选择上方',
      modalBottom: '选择下方',
      modalLeft: '选择左侧',
      modalRight: '选择右侧',
      modalCenter: '屏幕中央',
      modalCustom: '自定义（拖拽定位）',
      stylePlain: '简单英语',
      styleTechnical: '技术性',
      styleSimple: '简单（ELI12）',
      issueGeneral: '一般咨询',
      issueModalNotWorking: '模态框在页面上不工作',
      issueWordNotFound: '未找到单词/不正确',
      issueSubscription: '订阅问题',
      issueBug: '错误报告',
      issueFeature: '功能请求',
      issueOther: '其他',
      contactNamePlaceholder: '您的姓名',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: '您的消息...',
      recentNews: '最近新闻'
    },
    ko: {
      settings: '설정',
      favorites: '즐겨찾기',
      recentSearches: '최근 검색',
      wordOfDay: '오늘의 단어',
      noFavorites: '아직 즐겨찾기가 없습니다. 툴팁의 하트 아이콘을 클릭하여 단어를 추가하세요!',
      noRecentSearches: '아직 최근 검색이 없습니다. 웹 페이지에서 단어를 선택하면 여기에 표시됩니다!',
      subscription: '구독',
      modalPlacement: '모달 위치',
      apiSettings: 'API 설정',
      general: '일반',
      contact: '연락처',
      loadMore: '더 로드',
      showLess: '덜 표시',
      clearAll: '모두 지우기',
      allRecentSearches: '모든 최근 검색',
      back: '뒤로',
      search: '검색',
      copy: '복사',
      addToFavorites: '즐겨찾기에 추가',
      removeFromFavorites: '즐겨찾기에서 제거',
      manageSubscription: '구독 관리',
      signOut: '로그아웃',
      sendMessage: '메시지 보내기',
      name: '이름',
      email: '이메일',
      subject: '제목',
      message: '메시지',
      yourMessage: '메시지를 입력하세요...',
      weWillGetBack: '가능한 한 빨리 연락드리겠습니다',
      clearAllData: '모든 데이터 지우기',
      removeAllData: '모든 즐겨찾기, 최근 검색 및 설정 제거',
      loadingFavorites: '즐겨찾기 로드 중...',
      loadingRecent: '최근 검색 로드 중...',
      loadingWordOfDay: '오늘의 단어 로드 중...',
      errorLoadingWordOfDay: '오늘의 단어 로드 오류.',
      searchPlaceholder: '검색',
      searchButton: '검색',
      settingsButton: '설정',
      autoRenewDesc: '만료 시 구독을 자동으로 갱신',
      modalPlacementDesc: '텍스트를 선택할 때 단어 설명 모달이 나타나는 위치를 선택합니다. 사용자 정의를 사용하면 모달을 원하는 위치로 드래그할 수 있습니다.',
      modalDraggableDesc: '모달을 드래그하여 재배치할 수 있도록 허용 (잡기 핸들이 나타남)',
      openaiKeyDesc: '향상된 설명을 위해 OpenAI API 키를 추가하세요. 비워두면 무료 사전 API를 사용합니다.',
      saveApiSettings: 'API 설정 저장',
      incognitoDesc: '기본적으로 시크릿 모드에서는 검색이 저장되지 않습니다',
      removeAllDataDesc: '모든 즐겨찾기, 최근 검색 및 설정 제거',
      contactNamePlaceholder: '이름',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: '제목',
      autoRenewLabel: '구독 자동 갱신',
      statusLabel: '상태:',
      expiresLabel: '만료:',
      modalPositionLabel: '모달 위치:',
      enableDragLabel: '드래그로 재배치 활성화',
      openaiKeyLabel: 'OpenAI API 키 (선택사항):',
      explanationStyleLabel: '설명 스타일:',
      saveInIncognitoLabel: '시크릿 모드에서 검색 저장',
      showPhoneticLabel: '음성 발음 표시',
      showExamplesLabel: '예문 표시',
      examplesLabel: '예',
      synonymsLabel: '동의어',
      copyWord: '단어 복사',
      speakWord: '단어 발음',
      addToFavorites: '즐겨찾기에 추가',
      removeFromFavorites: '즐겨찾기에서 제거',
      search: '검색',
      refresh: '새로고침',
      refreshComplete: '허브가 새로고침되었습니다!',
      active: '활성',
      inactive: '비활성',
      notAvailable: '해당 없음',
      issueTypeLabel: '문제 유형:',
      more: '더',
      modalIntuitive: '직관적 (기본값)',
      modalTop: '선택 위',
      modalBottom: '선택 아래',
      modalLeft: '선택 왼쪽',
      modalRight: '선택 오른쪽',
      modalCenter: '화면 중앙',
      modalCustom: '사용자 정의 (드래그하여 위치 지정)',
      stylePlain: '간단한 영어',
      styleTechnical: '기술적',
      styleSimple: '간단함 (ELI12)',
      issueGeneral: '일반 문의',
      issueModalNotWorking: '페이지에서 모달이 작동하지 않음',
      issueWordNotFound: '단어를 찾을 수 없음/잘못됨',
      issueSubscription: '구독 문제',
      issueBug: '버그 보고',
      issueFeature: '기능 요청',
      issueOther: '기타',
      contactNamePlaceholder: '이름',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: '메시지...',
      recentNews: '최근 뉴스'
    },
    ar: {
      settings: 'الإعدادات',
      favorites: 'المفضلة',
      recentSearches: 'البحث الأخير',
      wordOfDay: 'كلمة اليوم',
      noFavorites: 'لا توجد مفضلات بعد. انقر على أيقونة القلب في التلميحات لإضافة كلمات!',
      noRecentSearches: 'لا توجد عمليات بحث حديثة بعد. حدد الكلمات على صفحات الويب لرؤيتها هنا!',
      subscription: 'الاشتراك',
      modalPlacement: 'موضع النافذة',
      apiSettings: 'إعدادات API',
      general: 'عام',
      contact: 'اتصل',
      loadMore: 'تحميل المزيد',
      showLess: 'عرض أقل',
      clearAll: 'مسح الكل',
      allRecentSearches: 'جميع عمليات البحث الأخيرة',
      back: 'رجوع',
      search: 'بحث',
      copy: 'نسخ',
      addToFavorites: 'إضافة إلى المفضلة',
      removeFromFavorites: 'إزالة من المفضلة',
      manageSubscription: 'إدارة الاشتراك',
      signOut: 'تسجيل الخروج',
      sendMessage: 'إرسال رسالة',
      name: 'الاسم',
      email: 'البريد الإلكتروني',
      subject: 'الموضوع',
      message: 'الرسالة',
      yourMessage: 'رسالتك...',
      weWillGetBack: 'سنتواصل معك في أقرب وقت ممكن',
      clearAllData: 'مسح جميع البيانات',
      removeAllData: 'إزالة جميع المفضلات والبحث الأخير والإعدادات',
      loadingFavorites: 'جارٍ تحميل المفضلة...',
      loadingRecent: 'جارٍ تحميل البحث الأخير...',
      loadingWordOfDay: 'جارٍ تحميل كلمة اليوم...',
      errorLoadingWordOfDay: 'خطأ في تحميل كلمة اليوم.',
      searchPlaceholder: 'بحث',
      searchButton: 'بحث',
      settingsButton: 'الإعدادات',
      autoRenewDesc: 'تجديد اشتراكك تلقائياً عند انتهاء الصلاحية',
      modalPlacementDesc: 'اختر مكان ظهور نافذة شرح الكلمة عند تحديد النص. المخصص يسمح لك بسحب النافذة إلى الموضع المفضل لديك.',
      modalDraggableDesc: 'السماح بسحب النافذة لإعادة وضعها (ستظهر مقبض الإمساك)',
      openaiKeyDesc: 'أضف مفتاح OpenAI API الخاص بك للحصول على شرح محسّن. اتركه فارغاً لاستخدام واجهة برمجة تطبيقات القاموس المجانية.',
      saveApiSettings: 'حفظ إعدادات API',
      incognitoDesc: 'افتراضياً، لا يتم حفظ عمليات البحث في وضع التصفح المتخفي',
      removeAllDataDesc: 'إزالة جميع المفضلات والبحث الأخير والإعدادات',
      contactNamePlaceholder: 'اسمك',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: 'الموضوع',
      autoRenewLabel: 'تجديد الاشتراك تلقائياً',
      statusLabel: 'الحالة:',
      expiresLabel: 'ينتهي:',
      modalPositionLabel: 'موضع النافذة:',
      enableDragLabel: 'تفعيل السحب لإعادة الوضع',
      openaiKeyLabel: 'مفتاح OpenAI API (اختياري):',
      explanationStyleLabel: 'نمط الشرح:',
      saveInIncognitoLabel: 'حفظ عمليات البحث في وضع التصفح المتخفي',
      showPhoneticLabel: 'إظهار النطق الصوتي',
      showExamplesLabel: 'إظهار جمل المثال',
      examplesLabel: 'أمثلة',
      synonymsLabel: 'مرادفات',
      copyWord: 'نسخ الكلمة',
      speakWord: 'نطق الكلمة',
      addToFavorites: 'إضافة إلى المفضلة',
      removeFromFavorites: 'إزالة من المفضلة',
      search: 'بحث',
      refresh: 'تحديث',
      refreshComplete: 'تم تحديث المركز!',
      active: 'نشط',
      inactive: 'غير نشط',
      notAvailable: 'غير متاح',
      issueTypeLabel: 'نوع المشكلة:',
      more: 'المزيد',
      modalIntuitive: 'بديهي (افتراضي)',
      modalTop: 'أعلى التحديد',
      modalBottom: 'أسفل التحديد',
      modalLeft: 'يسار التحديد',
      modalRight: 'يمين التحديد',
      modalCenter: 'وسط الشاشة',
      modalCustom: 'مخصص (اسحب للوضع)',
      stylePlain: 'إنجليزي بسيط',
      styleTechnical: 'تقني',
      styleSimple: 'بسيط (ELI12)',
      issueGeneral: 'استفسار عام',
      issueModalNotWorking: 'النافذة المنبثقة لا تعمل على الصفحة',
      issueWordNotFound: 'الكلمة غير موجودة/غير صحيحة',
      issueSubscription: 'مشكلة الاشتراك',
      issueBug: 'تقرير خطأ',
      issueFeature: 'طلب ميزة',
      issueOther: 'أخرى',
      contactNamePlaceholder: 'اسمك',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'رسالتك...',
      recentNews: 'الأخبار الحديثة'
    },
    hi: {
      settings: 'सेटिंग्स',
      favorites: 'पसंदीदा',
      recentSearches: 'हाल की खोजें',
      wordOfDay: 'दिन का शब्द',
      noFavorites: 'अभी तक कोई पसंदीदा नहीं। शब्द जोड़ने के लिए टूलटिप में दिल आइकन पर क्लिक करें!',
      noRecentSearches: 'अभी तक कोई हाल की खोज नहीं। यहां देखने के लिए वेब पेज पर शब्द चुनें!',
      subscription: 'सदस्यता',
      modalPlacement: 'मोडल स्थान',
      apiSettings: 'API सेटिंग्स',
      general: 'सामान्य',
      contact: 'संपर्क',
      loadMore: 'और लोड करें',
      showLess: 'कम दिखाएं',
      clearAll: 'सभी साफ करें',
      allRecentSearches: 'सभी हाल की खोजें',
      back: 'वापस',
      search: 'खोजें',
      copy: 'कॉपी करें',
      addToFavorites: 'पसंदीदा में जोड़ें',
      removeFromFavorites: 'पसंदीदा से हटाएं',
      manageSubscription: 'सदस्यता प्रबंधन',
      signOut: 'साइन आउट',
      sendMessage: 'संदेश भेजें',
      name: 'नाम',
      email: 'ईमेल',
      subject: 'विषय',
      message: 'संदेश',
      yourMessage: 'आपका संदेश...',
      weWillGetBack: 'हम जल्द से जल्द आपसे संपर्क करेंगे',
      clearAllData: 'सभी डेटा साफ करें',
      removeAllData: 'सभी पसंदीदा, हाल की खोजें और सेटिंग्स हटाएं',
      loadingFavorites: 'पसंदीदा लोड हो रहे हैं...',
      loadingRecent: 'हाल की खोजें लोड हो रही हैं...',
      loadingWordOfDay: 'दिन का शब्द लोड हो रहा है...',
      errorLoadingWordOfDay: 'दिन का शब्द लोड करने में त्रुटि।',
      searchPlaceholder: 'खोज',
      searchButton: 'खोजें',
      settingsButton: 'सेटिंग्स',
      autoRenewDesc: 'समाप्ति पर अपनी सदस्यता को स्वचालित रूप से नवीनीकृत करें',
      modalPlacementDesc: 'चुनें कि पाठ चुनने पर शब्द स्पष्टीकरण मोडल कहाँ दिखाई देता है। कस्टम आपको मोडल को अपनी पसंदीदा स्थिति में खींचने की अनुमति देता है।',
      modalDraggableDesc: 'मोडल को पुनः स्थिति में लाने के लिए खींचने की अनुमति दें (ग्रैबर हैंडल दिखाई देगा)',
      openaiKeyDesc: 'बेहतर स्पष्टीकरण के लिए अपनी OpenAI API कुंजी जोड़ें। मुफ्त शब्दकोश API का उपयोग करने के लिए खाली छोड़ दें।',
      saveApiSettings: 'API सेटिंग्स सहेजें',
      incognitoDesc: 'डिफ़ॉल्ट रूप से, गुप्त मोड में खोज सहेजी नहीं जाती हैं',
      removeAllDataDesc: 'सभी पसंदीदा, हाल की खोजें और सेटिंग्स हटाएं',
      contactNamePlaceholder: 'आपका नाम',
      contactEmailPlaceholder: 'your.email@example.com',
      contactSubjectPlaceholder: 'विषय',
      autoRenewLabel: 'सदस्यता स्वचालित रूप से नवीनीकृत करें',
      statusLabel: 'स्थिति:',
      expiresLabel: 'समाप्त:',
      modalPositionLabel: 'मोडल स्थान:',
      enableDragLabel: 'पुनः स्थिति के लिए खींचना सक्षम करें',
      openaiKeyLabel: 'OpenAI API कुंजी (वैकल्पिक):',
      explanationStyleLabel: 'स्पष्टीकरण शैली:',
      saveInIncognitoLabel: 'गुप्त मोड में खोज सहेजें',
      showPhoneticLabel: 'ध्वन्यात्मक उच्चारण दिखाएं',
      showExamplesLabel: 'उदाहरण वाक्य दिखाएं',
      examplesLabel: 'उदाहरण',
      synonymsLabel: 'समानार्थी',
      copyWord: 'शब्द कॉपी करें',
      speakWord: 'शब्द बोलें',
      addToFavorites: 'पसंदीदा में जोड़ें',
      removeFromFavorites: 'पसंदीदा से हटाएं',
      search: 'खोजें',
      refresh: 'ताज़ा करें',
      refreshComplete: 'हब ताज़ा हो गया!',
      active: 'सक्रिय',
      inactive: 'निष्क्रिय',
      notAvailable: 'उपलब्ध नहीं',
      issueTypeLabel: 'समस्या का प्रकार:',
      more: 'अधिक',
      modalIntuitive: 'सहज (डिफ़ॉल्ट)',
      modalTop: 'चयन के ऊपर',
      modalBottom: 'चयन के नीचे',
      modalLeft: 'चयन के बाएं',
      modalRight: 'चयन के दाएं',
      modalCenter: 'स्क्रीन का केंद्र',
      modalCustom: 'कस्टम (स्थिति के लिए खींचें)',
      stylePlain: 'सरल अंग्रेजी',
      styleTechnical: 'तकनीकी',
      styleSimple: 'सरल (ELI12)',
      issueGeneral: 'सामान्य पूछताछ',
      issueModalNotWorking: 'पृष्ठ पर मोडल काम नहीं कर रहा',
      issueWordNotFound: 'शब्द नहीं मिला/गलत',
      issueSubscription: 'सदस्यता समस्या',
      issueBug: 'बग रिपोर्ट',
      issueFeature: 'फ़ीचर अनुरोध',
      issueOther: 'अन्य',
      contactNamePlaceholder: 'आपका नाम',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'आपका संदेश...',
      recentNews: 'हाल की खबरें'
    },
    nl: {
      settings: 'Instellingen',
      favorites: 'Favorieten',
      recentSearches: 'Recente Zoekopdrachten',
      wordOfDay: 'Woord van de Dag',
      noFavorites: 'Nog geen favorieten. Klik op het hartpictogram in de tooltips om woorden toe te voegen!',
      noRecentSearches: 'Nog geen recente zoekopdrachten. Selecteer woorden op webpagina\'s om ze hier te zien!',
      subscription: 'Abonnement',
      modalPlacement: 'Modal Positie',
      apiSettings: 'API Instellingen',
      general: 'Algemeen',
      contact: 'Contact',
      loadMore: 'Meer Laden',
      showLess: 'Minder Tonen',
      clearAll: 'Alles Wissen',
      allRecentSearches: 'Alle Recente Zoekopdrachten',
      back: 'Terug',
      search: 'Zoeken',
      copy: 'Kopiëren',
      addToFavorites: 'Toevoegen aan favorieten',
      removeFromFavorites: 'Verwijderen uit favorieten',
      manageSubscription: 'Abonnement Beheren',
      signOut: 'Uitloggen',
      sendMessage: 'Bericht Verzenden',
      name: 'Naam',
      email: 'E-mail',
      subject: 'Onderwerp',
      message: 'Bericht',
      yourMessage: 'Uw bericht...',
      weWillGetBack: 'We nemen zo spoedig mogelijk contact met u op',
      clearAllData: 'Alle Gegevens Wissen',
      removeAllData: 'Verwijder alle favorieten, recente zoekopdrachten en instellingen',
      loadingFavorites: 'Favorieten laden...',
      loadingRecent: 'Recente zoekopdrachten laden...',
      loadingWordOfDay: 'Woord van de dag laden...',
      errorLoadingWordOfDay: 'Fout bij het laden van het woord van de dag.',
      searchPlaceholder: 'Zoeken',
      searchButton: 'Zoeken',
      settingsButton: 'Instellingen',
      autoRenewDesc: 'Uw abonnement automatisch verlengen wanneer het verloopt',
      modalPlacementDesc: 'Kies waar het woordverklaring modal verschijnt wanneer u tekst selecteert. Aangepast stelt u in staat het modal naar uw voorkeurspositie te slepen.',
      modalDraggableDesc: 'Toestaan dat het modal wordt gesleept om het te herpositioneren (een greep verschijnt)',
      openaiKeyDesc: 'Voeg uw OpenAI API-sleutel toe voor verbeterde verklaringen. Laat leeg om de gratis woordenboek API te gebruiken.',
      saveApiSettings: 'API Instellingen Opslaan',
      incognitoDesc: 'Standaard worden zoekopdrachten niet opgeslagen in incognitomodus',
      removeAllDataDesc: 'Verwijder alle favorieten, recente zoekopdrachten en instellingen',
      contactNamePlaceholder: 'Uw naam',
      contactEmailPlaceholder: 'uw.email@voorbeeld.com',
      contactSubjectPlaceholder: 'Onderwerp',
      autoRenewLabel: 'Abonnement automatisch verlengen',
      statusLabel: 'Status:',
      expiresLabel: 'Verloopt:',
      modalPositionLabel: 'Modal Positie:',
      enableDragLabel: 'Slepen om te herpositioneren inschakelen',
      openaiKeyLabel: 'OpenAI API-sleutel (Optioneel):',
      explanationStyleLabel: 'Uitlegstijl:',
      saveInIncognitoLabel: 'Zoekopdrachten opslaan in incognitomodus',
      showPhoneticLabel: 'Fonetische uitspraak tonen',
      showExamplesLabel: 'Voorbeeldzinnen tonen',
      examplesLabel: 'Voorbeelden',
      synonymsLabel: 'Synoniemen',
      copyWord: 'Woord kopiëren',
      speakWord: 'Woord uitspreken',
      addToFavorites: 'Toevoegen aan favorieten',
      removeFromFavorites: 'Verwijderen uit favorieten',
      search: 'Zoeken',
      refresh: 'Vernieuwen',
      refreshComplete: 'Hub vernieuwd!',
      active: 'Actief',
      inactive: 'Inactief',
      notAvailable: 'N/B',
      issueTypeLabel: 'Probleemtype:',
      more: 'meer',
      modalIntuitive: 'Intuïtief (Standaard)',
      modalTop: 'Boven Selectie',
      modalBottom: 'Onder Selectie',
      modalLeft: 'Links van Selectie',
      modalRight: 'Rechts van Selectie',
      modalCenter: 'Midden van Scherm',
      modalCustom: 'Aangepast (Sleep om te Positioneren)',
      stylePlain: 'Eenvoudig Engels',
      styleTechnical: 'Technisch',
      styleSimple: 'Eenvoudig (ELI12)',
      issueGeneral: 'Algemene Vraag',
      issueModalNotWorking: 'Modal Werkt Niet op Pagina',
      issueWordNotFound: 'Woord Niet Gevonden/Onjuist',
      issueSubscription: 'Abonnement Probleem',
      issueBug: 'Bug Rapport',
      issueFeature: 'Functie Verzoek',
      issueOther: 'Anders',
      contactNamePlaceholder: 'Uw naam',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'Uw bericht...',
      recentNews: 'Recente Nieuws'
    },
    sv: {
      settings: 'Inställningar',
      favorites: 'Favoriter',
      recentSearches: 'Senaste Sökningar',
      wordOfDay: 'Dagens Ord',
      noFavorites: 'Inga favoriter ännu. Klicka på hjärtikonen i tooltips för att lägga till ord!',
      noRecentSearches: 'Inga senaste sökningar ännu. Välj ord på webbsidor för att se dem här!',
      subscription: 'Prenumeration',
      modalPlacement: 'Modal Position',
      apiSettings: 'API Inställningar',
      general: 'Allmänt',
      contact: 'Kontakt',
      loadMore: 'Ladda Mer',
      showLess: 'Visa Mindre',
      clearAll: 'Rensa Allt',
      allRecentSearches: 'Alla Senaste Sökningar',
      back: 'Tillbaka',
      search: 'Sök',
      copy: 'Kopiera',
      addToFavorites: 'Lägg till i favoriter',
      removeFromFavorites: 'Ta bort från favoriter',
      manageSubscription: 'Hantera Prenumeration',
      signOut: 'Logga ut',
      sendMessage: 'Skicka Meddelande',
      name: 'Namn',
      email: 'E-post',
      subject: 'Ämne',
      message: 'Meddelande',
      yourMessage: 'Ditt meddelande...',
      weWillGetBack: 'Vi återkommer så snart som möjligt',
      clearAllData: 'Rensa Alla Data',
      removeAllData: 'Ta bort alla favoriter, senaste sökningar och inställningar',
      loadingFavorites: 'Laddar favoriter...',
      loadingRecent: 'Laddar senaste sökningar...',
      loadingWordOfDay: 'Laddar dagens ord...',
      errorLoadingWordOfDay: 'Fel vid laddning av dagens ord.',
      autoRenewLabel: 'Förnya prenumeration automatiskt',
      statusLabel: 'Status:',
      expiresLabel: 'Upphör:',
      modalPositionLabel: 'Modal Position:',
      enableDragLabel: 'Aktivera dra för att flytta',
      openaiKeyLabel: 'OpenAI API-nyckel (Valfritt):',
      explanationStyleLabel: 'Förklaringsstil:',
      saveInIncognitoLabel: 'Spara sökningar i inkognitoläge',
      showPhoneticLabel: 'Visa fonetisk uttal',
      showExamplesLabel: 'Visa exempelmeningar',
      examplesLabel: 'Exempel',
      synonymsLabel: 'Synonymer',
      copyWord: 'Kopiera ord',
      speakWord: 'Uttala ord',
      addToFavorites: 'Lägg till i favoriter',
      removeFromFavorites: 'Ta bort från favoriter',
      search: 'Sök',
      refresh: 'Uppdatera',
      refreshComplete: 'Hub uppdaterad!',
      active: 'Aktiv',
      inactive: 'Inaktiv',
      notAvailable: 'Saknas',
      issueTypeLabel: 'Problemtyp:',
      more: 'mer',
      modalIntuitive: 'Intuitiv (Standard)',
      modalTop: 'Ovanför Markering',
      modalBottom: 'Under Markering',
      modalLeft: 'Vänster om Markering',
      modalRight: 'Höger om Markering',
      modalCenter: 'Skärmens Centrum',
      modalCustom: 'Anpassad (Dra för att Positionera)',
      stylePlain: 'Enkelt Engelska',
      styleTechnical: 'Teknisk',
      styleSimple: 'Enkel (ELI12)',
      issueGeneral: 'Allmän Förfrågan',
      issueModalNotWorking: 'Modal Fungerar Inte på Sidan',
      issueWordNotFound: 'Ord Hittades Inte/Felaktigt',
      issueSubscription: 'Prenumerationsproblem',
      issueBug: 'Felrapport',
      issueFeature: 'Funktionsförfrågan',
      issueOther: 'Annat',
      contactNamePlaceholder: 'Ditt namn',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'Ditt meddelande...',
      recentNews: 'Senaste Nyheter'
    },
    pl: {
      settings: 'Ustawienia',
      favorites: 'Ulubione',
      recentSearches: 'Ostatnie Wyszukiwania',
      wordOfDay: 'Słowo Dnia',
      noFavorites: 'Brak ulubionych. Kliknij ikonę serca w podpowiedziach, aby dodać słowa!',
      noRecentSearches: 'Brak ostatnich wyszukiwań. Wybierz słowa na stronach internetowych, aby je tutaj zobaczyć!',
      subscription: 'Subskrypcja',
      modalPlacement: 'Pozycja Modala',
      apiSettings: 'Ustawienia API',
      general: 'Ogólne',
      contact: 'Kontakt',
      loadMore: 'Załaduj Więcej',
      showLess: 'Pokaż Mniej',
      clearAll: 'Wyczyść Wszystko',
      allRecentSearches: 'Wszystkie Ostatnie Wyszukiwania',
      back: 'Wstecz',
      search: 'Szukaj',
      copy: 'Kopiuj',
      addToFavorites: 'Dodaj do ulubionych',
      removeFromFavorites: 'Usuń z ulubionych',
      manageSubscription: 'Zarządzaj Subskrypcją',
      signOut: 'Wyloguj',
      sendMessage: 'Wyślij Wiadomość',
      name: 'Imię',
      email: 'Email',
      subject: 'Temat',
      message: 'Wiadomość',
      yourMessage: 'Twoja wiadomość...',
      weWillGetBack: 'Skontaktujemy się z Tobą tak szybko, jak to możliwe',
      clearAllData: 'Wyczyść Wszystkie Dane',
      removeAllData: 'Usuń wszystkie ulubione, ostatnie wyszukiwania i ustawienia',
      loadingFavorites: 'Ładowanie ulubionych...',
      loadingRecent: 'Ładowanie ostatnich wyszukiwań...',
      loadingWordOfDay: 'Ładowanie słowa dnia...',
      errorLoadingWordOfDay: 'Błąd podczas ładowania słowa dnia.',
      searchPlaceholder: 'Szukaj',
      searchButton: 'Szukaj',
      settingsButton: 'Ustawienia',
      autoRenewDesc: 'Automatycznie odnawiaj subskrypcję po wygaśnięciu',
      modalPlacementDesc: 'Wybierz, gdzie pojawia się modal wyjaśnienia słowa po zaznaczeniu tekstu. Niestandardowy pozwala przeciągnąć modal do preferowanej pozycji.',
      modalDraggableDesc: 'Zezwól na przeciąganie modala w celu zmiany jego pozycji (pojawi się uchwyt)',
      openaiKeyDesc: 'Dodaj swój klucz API OpenAI, aby uzyskać ulepszone wyjaśnienia. Pozostaw puste, aby użyć bezpłatnego API słownika.',
      saveApiSettings: 'Zapisz Ustawienia API',
      incognitoDesc: 'Domyślnie wyszukiwania nie są zapisywane w trybie incognito',
      removeAllDataDesc: 'Usuń wszystkie ulubione, ostatnie wyszukiwania i ustawienia',
      contactNamePlaceholder: 'Twoje imię',
      contactEmailPlaceholder: 'twoj.email@przyklad.com',
      contactSubjectPlaceholder: 'Temat',
      autoRenewLabel: 'Automatycznie odnawiaj subskrypcję',
      statusLabel: 'Status:',
      expiresLabel: 'Wygasa:',
      modalPositionLabel: 'Pozycja Modala:',
      enableDragLabel: 'Włącz przeciąganie do zmiany pozycji',
      openaiKeyLabel: 'Klucz API OpenAI (Opcjonalny):',
      explanationStyleLabel: 'Styl Wyjaśnienia:',
      saveInIncognitoLabel: 'Zapisz wyszukiwania w trybie incognito',
      showPhoneticLabel: 'Pokaż wymowę fonetyczną',
      showExamplesLabel: 'Pokaż przykładowe zdania',
      examplesLabel: 'Przykłady',
      synonymsLabel: 'Synonimy',
      copyWord: 'Kopiuj słowo',
      speakWord: 'Wymów słowo',
      addToFavorites: 'Dodaj do ulubionych',
      removeFromFavorites: 'Usuń z ulubionych',
      search: 'Szukaj',
      refresh: 'Odśwież',
      refreshComplete: 'Hub odświeżony!',
      active: 'Aktywny',
      inactive: 'Nieaktywny',
      notAvailable: 'N/D',
      issueTypeLabel: 'Typ Problemu:',
      more: 'więcej',
      modalIntuitive: 'Intuicyjne (Domyślne)',
      modalTop: 'Nad Zaznaczeniem',
      modalBottom: 'Pod Zaznaczeniem',
      modalLeft: 'Na Lewo od Zaznaczenia',
      modalRight: 'Na Prawo od Zaznaczenia',
      modalCenter: 'Środek Ekranu',
      modalCustom: 'Niestandardowe (Przeciągnij, aby Ustawić)',
      stylePlain: 'Prosty Angielski',
      styleTechnical: 'Techniczny',
      styleSimple: 'Prosty (ELI12)',
      issueGeneral: 'Ogólne Zapytanie',
      issueModalNotWorking: 'Modal Nie Działa na Stronie',
      issueWordNotFound: 'Słowo Nie Znalezione/Nieprawidłowe',
      issueSubscription: 'Problem z Subskrypcją',
      issueBug: 'Raport Błędu',
      issueFeature: 'Prośba o Funkcję',
      issueOther: 'Inne',
      contactNamePlaceholder: 'Twoje imię',
      contactEmailPlaceholder: 'your.email@example.com',
      contactMessagePlaceholder: 'Twoja wiadomość...',
      recentNews: 'Najnowsze Wiadomości'
    },
    tr: {
      settings: 'Ayarlar',
      favorites: 'Favoriler',
      recentSearches: 'Son Aramalar',
      wordOfDay: 'Günün Kelimesi',
      noFavorites: 'Henüz favori yok. Kelime eklemek için ipuçlarındaki kalp simgesine tıklayın!',
      noRecentSearches: 'Henüz son arama yok. Burada görmek için web sayfalarında kelimeleri seçin!',
      subscription: 'Abonelik',
      modalPlacement: 'Modal Konumu',
      apiSettings: 'API Ayarları',
      general: 'Genel',
      contact: 'İletişim',
      loadMore: 'Daha Fazla Yükle',
      showLess: 'Daha Az Göster',
      clearAll: 'Tümünü Temizle',
      clearAllRecent: 'Tüm Son Aramaları Temizle',
      clearAllRecentConfirm: 'Tüm son aramaları temizlemek istediğinizden emin misiniz? Bu işlem geri alınamaz.',
      recentSearchesCleared: 'Tüm son aramalar temizlendi!',
      allRecentSearches: 'Tüm Son Aramalar',
      back: 'Geri',
      search: 'Ara',
      copy: 'Kopyala',
      addToFavorites: 'Favorilere ekle',
      removeFromFavorites: 'Favorilerden kaldır',
      manageSubscription: 'Aboneliği Yönet',
      signOut: 'Çıkış Yap',
      sendMessage: 'Mesaj Gönder',
      name: 'Ad',
      email: 'E-posta',
      subject: 'Konu',
      message: 'Mesaj',
      yourMessage: 'Mesajınız...',
      weWillGetBack: 'En kısa sürede size geri döneceğiz',
      clearAllData: 'Tüm Verileri Temizle',
      removeAllData: 'Tüm favorileri, son aramaları ve ayarları kaldır',
      loadingFavorites: 'Favoriler yükleniyor...',
      loadingRecent: 'Son aramalar yükleniyor...',
      loadingWordOfDay: 'Günün kelimesi yükleniyor...',
      errorLoadingWordOfDay: 'Günün kelimesi yüklenirken hata oluştu.',
      searchPlaceholder: 'Ara',
      searchButton: 'Ara',
      settingsButton: 'Ayarlar',
      autoRenewDesc: 'Aboneliğiniz süresi dolduğunda otomatik olarak yenileyin',
      modalPlacementDesc: 'Metin seçtiğinizde kelime açıklama modalının göründüğü yeri seçin. Özel, modalı tercih ettiğiniz konuma sürüklemenize olanak tanır.',
      modalDraggableDesc: 'Modalı yeniden konumlandırmak için sürüklemeye izin verin (tutma kolu görünecektir)',
      openaiKeyDesc: 'Gelişmiş açıklamalar için OpenAI API anahtarınızı ekleyin. Ücretsiz sözlük API\'sini kullanmak için boş bırakın.',
      saveApiSettings: 'API Ayarlarını Kaydet',
      incognitoDesc: 'Varsayılan olarak, gizli modda aramalar kaydedilmez',
      removeAllDataDesc: 'Tüm favorileri, son aramaları ve ayarları kaldır',
      contactNamePlaceholder: 'Adınız',
      contactEmailPlaceholder: 'sizin.email@ornek.com',
      contactSubjectPlaceholder: 'Konu',
      autoRenewLabel: 'Aboneliği otomatik yenile',
      statusLabel: 'Durum:',
      expiresLabel: 'Bitiş:',
      modalPositionLabel: 'Modal Konumu:',
      enableDragLabel: 'Yeniden konumlandırmak için sürüklemeyi etkinleştir',
      openaiKeyLabel: 'OpenAI API Anahtarı (İsteğe Bağlı):',
      explanationStyleLabel: 'Açıklama Stili:',
      saveInIncognitoLabel: 'Gizli modda aramaları kaydet',
      showPhoneticLabel: 'Fonetik telaffuz göster',
      showExamplesLabel: 'Örnek cümleler göster',
      examplesLabel: 'Örnekler',
      synonymsLabel: 'Eş Anlamlılar',
      copyWord: 'Kelimeyi kopyala',
      speakWord: 'Kelimeyi söyle',
      addToFavorites: 'Favorilere ekle',
      removeFromFavorites: 'Favorilerden kaldır',
      search: 'Ara',
      refresh: 'Yenile',
      refreshComplete: 'Hub yenilendi!',
      active: 'Aktif',
      inactive: 'Pasif',
      notAvailable: 'Mevcut Değil',
      issueTypeLabel: 'Sorun Türü:',
      more: 'daha fazla',
      modalIntuitive: 'Sezgisel (Varsayılan)',
      modalTop: 'Seçimin Üstü',
      modalBottom: 'Seçimin Altı',
      modalLeft: 'Seçimin Solu',
      modalRight: 'Seçimin Sağı',
      modalCenter: 'Ekranın Ortası',
      modalCustom: 'Özel (Konumlandırmak için Sürükle)',
      stylePlain: 'Sade İngilizce',
      styleTechnical: 'Teknik',
      styleSimple: 'Basit (ELI12)',
      issueGeneral: 'Genel Soru',
      issueModalNotWorking: 'Modal Sayfada Çalışmıyor',
      issueWordNotFound: 'Kelime Bulunamadı/Yanlış',
      issueSubscription: 'Abonelik Sorunu',
      issueBug: 'Hata Raporu',
      issueFeature: 'Özellik İsteği',
      issueOther: 'Diğer',
      contactNamePlaceholder: 'Adınız',
      contactEmailPlaceholder: 'sizin.email@ornek.com',
      contactMessagePlaceholder: 'Mesajınız...',
      recentNews: 'Son Haberler'
    }
  };
  
  // Detect browser language and map to dictionary language code
  function detectBrowserLanguage() {
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    const langCode = browserLang.split('-')[0].toLowerCase();
    
    // Map browser language to supported dictionary languages
    const supportedLanguages = {
      'en': 'en', 'es': 'es', 'fr': 'fr', 'de': 'de', 'it': 'it', 'pt': 'pt',
      'ru': 'ru', 'ja': 'ja', 'zh': 'zh', 'ko': 'ko', 'ar': 'ar', 'hi': 'hi',
      'nl': 'nl', 'sv': 'sv', 'pl': 'pl', 'tr': 'tr'
    };
    
    return supportedLanguages[langCode] || 'en';
  }
  
  // Get current UI language
  function getUILanguage() {
    return document.documentElement.lang || 'en';
  }
  
  // Translate UI text - comprehensive function
  function translateUI(lang = 'en') {
    try {
      // Safety check: ensure translations object exists
      if (typeof translations === 'undefined') {
        return;
      }
      const t = translations[lang] || translations.en;
      if (!t) {
        return;
      }
      window.currentUILanguage = lang;
      document.documentElement.lang = lang;
      
    
    // Translate by data-i18n attributes
    document.querySelectorAll('[data-i18n]').forEach(el => {
      try {
      const key = el.getAttribute('data-i18n');
        if (!key || !t[key]) return;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = t[key];
        } else {
          el.textContent = t[key];
        }
      } catch (err) {}
    });
    
    // Search input placeholder
    const searchInput = document.getElementById('searchInput');
    if (searchInput && t.searchPlaceholder) {
      searchInput.placeholder = t.searchPlaceholder;
    }
    
    // Search button title
    const searchBtn = document.getElementById('searchIconBtn');
    if (searchBtn && t.searchButton) {
      searchBtn.title = t.searchButton;
    }
    
    // Settings button title
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn && t.settingsButton) {
      settingsBtn.title = t.settingsButton;
    }
    
    const savePageBtnEl = document.getElementById('savePageBtn');
    if (savePageBtnEl && t.savePage) {
      savePageBtnEl.title = t.savePage;
    }
    
    // Translate specific elements by ID/class/selector
    const translationsMap = {
      '#settingsPage h2': t.settings,
      '[data-tab="subscription"] span': t.subscription,
      '[data-tab="modal"] span': t.modalPlacement,
      '[data-tab="general"] span': t.general,
      '[data-tab="contact"] span': t.contact,
      '#favorites .section-title span': t.favorites,
      '#recent .section-title span': t.recentSearches,
      '#saved .section-title span': t.saved,
      '#wordOfDayHeader span': t.wordOfDay,
      '#loadMoreBtn': t.loadMore,
      '#showLessBtn': t.showLess,
      '#clearAllBtn': t.clearAll,
      '#manageSubscriptionBtn': t.manageSubscription,
      '#sendContactBtn': t.sendMessage,
      '#clearAllDataBtn': t.clearAllData,
      'label[for="contactName"]': t.name,
      'label[for="contactEmail"]': t.email,
      'label[for="contactSubject"]': t.subject,
      'label[for="contactMessage"]': t.message
    };
    
    Object.keys(translationsMap).forEach(selector => {
      try {
      const elements = document.querySelectorAll(selector);
        const text = translationsMap[selector];
        if (!text) return;
      elements.forEach(el => {
          try {
        if (el.tagName === 'LABEL' && el.querySelector('span')) {
              el.querySelector('span').textContent = text;
        } else if (el.tagName === 'BUTTON' || el.tagName === 'H2' || el.tagName === 'SPAN' || el.tagName === 'DIV') {
          if (el.tagName === 'BUTTON' || !el.querySelector('span')) {
                el.textContent = text;
          } else if (el.querySelector('span')) {
                el.querySelector('span').textContent = text;
          }
        }
          } catch (err) {}
      });
      } catch (err) {}
    });
    
    // Translate placeholders
    const contactName = document.getElementById('contactName');
    if (contactName && t.contactNamePlaceholder) {
      contactName.placeholder = t.contactNamePlaceholder;
    }
    
    const contactEmail = document.getElementById('contactEmail');
    if (contactEmail && t.contactEmailPlaceholder) {
      contactEmail.placeholder = t.contactEmailPlaceholder;
    }
    
    const contactSubject = document.getElementById('contactSubject');
    if (contactSubject && t.contactSubjectPlaceholder) {
      contactSubject.placeholder = t.contactSubjectPlaceholder;
    }
    
    const contactMessage = document.getElementById('contactMessage');
    if (contactMessage && t.yourMessage) {
      contactMessage.placeholder = t.yourMessage;
    }
    
    // Translate descriptions - use multiple approaches to ensure we catch them all
    const descriptions = [
      { selector: '#autoRenewToggle + .settings-description', key: 'autoRenewDesc', fallback: 'Automatically renew your subscription when it expires' },
      { selector: '#modalPlacement + .settings-description', key: 'modalPlacementDesc', fallback: 'Choose where the word explanation modal appears' },
      { selector: '#modalPlacementDropdown + .settings-description', key: 'modalPlacementDesc', fallback: 'Choose where the word explanation modal appears' },
      { selector: '#modalDraggable + .settings-description', key: 'modalDraggableDesc', fallback: 'Allow dragging the modal to reposition it' },
      { selector: '#openaiKeyInput + .settings-description', key: 'openaiKeyDesc', fallback: 'Add your OpenAI API key for enhanced explanations' },
      { selector: '#saveInIncognito + .settings-description', key: 'incognitoDesc', fallback: 'By default, searches are not saved in incognito mode' },
      { selector: '#clearAllDataBtn + .settings-description', key: 'removeAllDataDesc', fallback: 'Remove all favorites, recent searches, and settings' },
      { selector: '#sendContactBtn + .settings-description', key: 'weWillGetBack', fallback: 'We\'ll get back to you as soon as possible' }
    ];
    
    descriptions.forEach(({ selector, key, fallback }) => {
      const el = document.querySelector(selector);
      if (el && t[key]) {
        el.textContent = t[key];
      }
    });
    
    // Also translate descriptions by matching text content (fallback method)
    document.querySelectorAll('.settings-description').forEach(desc => {
      const text = desc.textContent.trim();
      if (text.includes('Automatically renew your subscription when it expires')) {
        desc.textContent = t.autoRenewDesc;
      } else if (text.includes('Choose where the word explanation modal appears')) {
        desc.textContent = t.modalPlacementDesc;
      } else if (text.includes('Allow dragging the modal to reposition it')) {
        desc.textContent = t.modalDraggableDesc;
      } else if (text.includes('Add your OpenAI API key for enhanced explanations')) {
        desc.textContent = t.openaiKeyDesc;
      } else if (text.includes('By default, searches are not saved in incognito mode')) {
        desc.textContent = t.incognitoDesc;
      } else if (text.includes('Remove all favorites, recent searches, and settings')) {
        desc.textContent = t.removeAllDataDesc;
      } else if (text.includes('We\'ll get back to you as soon as possible')) {
        desc.textContent = t.weWillGetBack;
      }
    });
    
    // Translate empty states
    document.querySelectorAll('.empty-state').forEach(el => {
      if (el.closest('#favorites')) {
        el.textContent = t.noFavorites;
      } else if (el.closest('#recent')) {
        el.textContent = t.noRecentSearches;
      }
    });
    
    // Translate loading messages
    document.querySelectorAll('.loading').forEach(el => {
      if (el.closest('#favorites')) {
        el.textContent = t.loadingFavorites;
      } else if (el.closest('#recent')) {
        el.textContent = t.loadingRecent;
      } else if (el.closest('#wordOfDay')) {
        el.textContent = t.loadingWordOfDay;
      }
    });
    
    // Force update word of day title if it exists
    const wordOfDayTitle = document.querySelector('#wordOfDayHeader span');
    if (wordOfDayTitle) {
      wordOfDayTitle.textContent = t.wordOfDay;
    }
    
    // Update section titles
    const favoritesTitle = document.querySelector('#favorites').closest('.section')?.querySelector('.section-title span');
    if (favoritesTitle) favoritesTitle.textContent = t.favorites;
    
    const recentTitle = document.querySelector('#recent').closest('.section')?.querySelector('.section-title span');
    if (recentTitle) recentTitle.textContent = t.recentSearches;
    
    const savedTitle = document.querySelector('#saved')?.closest('.section')?.querySelector('.section-title span');
    if (savedTitle) savedTitle.textContent = t.saved;
    
    // Translate labels
    const labelTranslations = {
      '#autoRenewToggle + span': t.autoRenewLabel,
      'label:has(#modalPlacement)': t.modalPositionLabel,
      'label:contains("Modal Position:")': t.modalPositionLabel,
      '#modalPlacementDropdown': t.modalPositionLabel,
      '#modalDraggable + span': t.enableDragLabel,
      'label:has(#openaiKeyInput)': t.openaiKeyLabel,
      'label:contains("OpenAI API Key")': t.openaiKeyLabel,
      'label:has(#explanationStyle)': t.explanationStyleLabel,
      'label:contains("Explanation Style:")': t.explanationStyleLabel,
      '#saveInIncognito + span': t.saveInIncognitoLabel,
      '#showPhonetic + span': t.showPhoneticLabel,
      '#showExamples + span': t.showExamplesLabel,
      'label:has(#contactIssueType)': t.issueTypeLabel,
      'label:contains("Issue Type:")': t.issueTypeLabel
    };
    
    // Also translate labels that are direct text nodes
    document.querySelectorAll('label').forEach(label => {
      const text = label.textContent.trim();
      if (text === 'Modal Position:') {
        label.textContent = t.modalPositionLabel;
      } else if (text === 'OpenAI API Key (Optional):') {
        label.textContent = t.openaiKeyLabel;
      } else if (text === 'Explanation Style:') {
        label.textContent = t.explanationStyleLabel;
      } else if (text === 'Issue Type:') {
        label.textContent = t.issueTypeLabel;
      }
    });
    
    Object.keys(labelTranslations).forEach(selector => {
      const el = document.querySelector(selector);
      if (el && labelTranslations[selector]) {
        if (el.tagName === 'LABEL' && el.querySelector('span')) {
          el.querySelector('span').textContent = labelTranslations[selector];
        } else if (el.tagName === 'SPAN') {
          el.textContent = labelTranslations[selector];
        } else if (el.tagName === 'LABEL') {
          // For labels without spans, update the text after the input
          const span = el.querySelector('span');
          if (span) {
            span.textContent = labelTranslations[selector];
          } else {
            // If no span, find text node or create one
            const textNode = Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
            if (textNode) {
              textNode.textContent = labelTranslations[selector];
            }
          }
        }
      }
    });
    
    // Translate status labels and values (special handling) - synchronous
    const statusElement = document.getElementById('subscriptionStatus');
    const expiresElement = document.getElementById('subscriptionExpiry');
    const statusLabelSpan = document.querySelector('.subscription-status span:first-child');
    const expiresLabelSpan = document.querySelector('.subscription-status span:last-child');
    
    if (statusLabelSpan && t.statusLabel) {
      // Get current status from element or default to inactive
      let isActive = false;
      if (statusElement) {
        isActive = statusElement.style.color === 'rgb(16, 185, 129)' || 
                   statusElement.textContent === translations.en.active ||
                   statusElement.textContent === translations.es?.active ||
                   statusElement.textContent === translations.fr?.active ||
                   statusElement.textContent === translations.de?.active;
      }
      const statusValue = isActive ? t.active : t.inactive;
      if (statusElement) {
        statusElement.textContent = statusValue;
        statusElement.style.color = isActive ? '#10b981' : '#ef4444';
      }
      statusLabelSpan.innerHTML = t.statusLabel + ' <strong id="subscriptionStatus">' + statusValue + '</strong>';
    }
    
    if (expiresLabelSpan && t.expiresLabel) {
      // Get current expiry value or default to N/A
      let expiryValue = t.notAvailable;
      if (expiresElement) {
        const currentExpiry = expiresElement.textContent.trim();
        // If it's a date (contains numbers and slashes/dashes), keep it
        if (currentExpiry.match(/\d/) && (currentExpiry.includes('/') || currentExpiry.includes('-') || currentExpiry.length > 5)) {
          expiryValue = currentExpiry;
        }
      }
      if (expiresElement) {
        expiresElement.textContent = expiryValue;
      }
      expiresLabelSpan.innerHTML = t.expiresLabel + ' <strong id="subscriptionExpiry">' + expiryValue + '</strong>';
    }
    
    // Translate dropdown options - simple and immediate
    // Modal placement dropdown
    const modalPlacementOptions = document.querySelectorAll('#modalPlacementDropdown .custom-dropdown-option');
    if (modalPlacementOptions.length > 0 && t.modalIntuitive) {
      const optionMap = {
        'intuitive': t.modalIntuitive,
        'top': t.modalTop,
        'bottom': t.modalBottom,
        'left': t.modalLeft,
        'right': t.modalRight,
        'center': t.modalCenter,
        'custom': t.modalCustom
      };
      modalPlacementOptions.forEach(option => {
        const value = option.dataset.value;
        if (optionMap[value]) {
          option.textContent = optionMap[value];
        }
      });
      // Update selected text
      const modalPlacementSelected = document.querySelector('#modalPlacementDropdown .custom-dropdown-text');
      const modalPlacementValue = document.getElementById('modalPlacement')?.value;
      if (modalPlacementSelected && modalPlacementValue && optionMap[modalPlacementValue]) {
        modalPlacementSelected.textContent = optionMap[modalPlacementValue];
      }
    }
    
    // Explanation style dropdown
    const explanationStyleOptions = document.querySelectorAll('#explanationStyleDropdown .custom-dropdown-option');
    if (explanationStyleOptions.length > 0 && t.stylePlain) {
      const styleMap = {
        'plain': t.stylePlain,
        'technical': t.styleTechnical,
        'simple': t.styleSimple
      };
      explanationStyleOptions.forEach(option => {
        const value = option.dataset.value;
        if (styleMap[value]) {
          option.textContent = styleMap[value];
        }
      });
      // Update selected text
      const explanationStyleSelected = document.querySelector('#explanationStyleDropdown .custom-dropdown-text');
      const explanationStyleValue = document.getElementById('explanationStyle')?.value;
      if (explanationStyleSelected && explanationStyleValue && styleMap[explanationStyleValue]) {
        explanationStyleSelected.textContent = styleMap[explanationStyleValue];
      }
    }
    
    // Issue type dropdown
    const issueTypeOptions = document.querySelectorAll('#contactIssueTypeDropdown .custom-dropdown-option');
    if (issueTypeOptions.length > 0 && t.issueGeneral) {
      const issueMap = {
        'general': t.issueGeneral,
        'modal-not-working': t.issueModalNotWorking,
        'word-not-found': t.issueWordNotFound,
        'subscription': t.issueSubscription,
        'bug': t.issueBug,
        'feature': t.issueFeature,
        'other': t.issueOther
      };
      issueTypeOptions.forEach(option => {
        const value = option.dataset.value;
        if (issueMap[value]) {
          option.textContent = issueMap[value];
        }
      });
      // Update selected text
      const issueTypeSelected = document.querySelector('#contactIssueTypeDropdown .custom-dropdown-text');
      const issueTypeValue = document.getElementById('contactIssueType')?.value;
      if (issueTypeSelected && issueTypeValue && issueMap[issueTypeValue]) {
        issueTypeSelected.textContent = issueMap[issueTypeValue];
      }
    }
    
    // Translate placeholders
    const contactNameInput = document.getElementById('contactName');
    if (contactNameInput && t.contactNamePlaceholder) {
      contactNameInput.placeholder = t.contactNamePlaceholder;
    }
    
    const contactEmailInput = document.getElementById('contactEmail');
    if (contactEmailInput && t.contactEmailPlaceholder) {
      contactEmailInput.placeholder = t.contactEmailPlaceholder;
    }
    
    // Translate "We'll get back to you" message
    const weWillGetBackMsg = document.querySelector('#sendContactBtn + .settings-description');
    if (weWillGetBackMsg && t.weWillGetBack) {
      weWillGetBackMsg.textContent = t.weWillGetBack;
    }
    
    // Translate all settings descriptions (fallback method - also check by text content)
    const allDescriptions = document.querySelectorAll('.settings-description');
    allDescriptions.forEach(desc => {
      const text = desc.textContent.trim();
      // Match descriptions by their English text
      if (text.includes('Automatically renew your subscription when it expires')) {
        desc.textContent = t.autoRenewDesc;
      } else if (text.includes('Choose where the word explanation modal appears')) {
        desc.textContent = t.modalPlacementDesc;
      } else if (text.includes('Allow dragging the modal to reposition it')) {
        desc.textContent = t.modalDraggableDesc;
      } else if (text.includes('Add your OpenAI API key for enhanced explanations')) {
        desc.textContent = t.openaiKeyDesc;
      } else if (text.includes('By default, searches are not saved in incognito mode')) {
        desc.textContent = t.incognitoDesc;
      } else if (text.includes('Remove all favorites, recent searches, and settings')) {
        desc.textContent = t.removeAllDataDesc;
      } else if (text.includes('We\'ll get back to you as soon as possible')) {
        desc.textContent = t.weWillGetBack;
      }
    });
    
    } catch (e) {
      // Don't throw - allow the app to continue functioning
    }
  }
  
  function loadSettings() {
    chrome.storage.local.get(['settings', 'subscription'], (result) => {
      const settings = result.settings || {};
      const subscription = result.subscription || {};
      
      // Language selector - detect browser language if not set
      const languageInput = document.getElementById('dictionaryLanguage');
      const languageDropdown = document.getElementById('languageDropdown');
      if (languageInput && languageDropdown) {
        const savedLanguage = settings.dictionaryLanguage || detectBrowserLanguage();
        languageInput.value = savedLanguage;
        const textSpan = languageDropdown.querySelector('.custom-dropdown-text');
        const options = languageDropdown.querySelectorAll('.custom-dropdown-option');
        const selectedOption = Array.from(options).find(opt => opt.dataset.value === savedLanguage);
        if (selectedOption && textSpan) {
          // Use flag from data-flag attribute, fallback to textContent
          const flag = selectedOption.dataset.flag || selectedOption.textContent.trim();
          textSpan.textContent = flag;
          options.forEach(opt => opt.classList.remove('selected'));
          selectedOption.classList.add('selected');
        }
        // Re-initialize dropdown after setting value
        setTimeout(() => {
          initCustomDropdowns();
        }, 50);
        
        // Translate UI to saved language
        window.currentUILanguage = savedLanguage;
        translateUI(savedLanguage);
      }
      
      // Also translate UI on initial load
      const initialLang = settings.dictionaryLanguage || detectBrowserLanguage();
      window.currentUILanguage = initialLang;
      translateUI(initialLang);
      
      // Subscription tab
      if (document.getElementById('autoRenewToggle')) {
        document.getElementById('autoRenewToggle').checked = settings.autoRenew !== false;
      }
      // Update subscription status with translated labels - call translateUI to ensure it's translated
      const currentLang = window.currentUILanguage || settings.dictionaryLanguage || 'en';
      translateUI(currentLang);
      
      // Modal placement tab - update custom dropdown
      const modalPlacementInput = document.getElementById('modalPlacement');
      const modalPlacementDropdown = document.getElementById('modalPlacementDropdown');
      if (modalPlacementInput && modalPlacementDropdown) {
        const value = settings.modalPlacement || 'intuitive';
        modalPlacementInput.value = value;
        const textSpan = modalPlacementDropdown.querySelector('.custom-dropdown-text');
        const options = modalPlacementDropdown.querySelectorAll('.custom-dropdown-option');
        const selectedOption = Array.from(options).find(opt => opt.dataset.value === value);
        if (selectedOption && textSpan) {
          textSpan.textContent = selectedOption.textContent.trim();
          options.forEach(opt => opt.classList.remove('selected'));
          selectedOption.classList.add('selected');
        }
        // Auto-enable draggable if custom is selected
        if (value === 'custom') {
          if (document.getElementById('modalDraggable')) {
            document.getElementById('modalDraggable').checked = true;
          }
        }
        // Re-initialize dropdown after setting value
        setTimeout(() => {
          initCustomDropdowns();
        }, 50);
      }
      if (document.getElementById('modalDraggable')) {
        document.getElementById('modalDraggable').checked = settings.modalDraggable !== false;
      }
      
      // Explanation style (in General tab) - update custom dropdown
      const explanationStyleInput = document.getElementById('explanationStyle');
      const explanationStyleDropdown = document.getElementById('explanationStyleDropdown');
      if (explanationStyleInput && explanationStyleDropdown) {
        const value = settings.explanationStyle || 'plain';
        explanationStyleInput.value = value;
        const textSpan = explanationStyleDropdown.querySelector('.custom-dropdown-text');
        const options = explanationStyleDropdown.querySelectorAll('.custom-dropdown-option');
        const selectedOption = Array.from(options).find(opt => opt.dataset.value === value);
        if (selectedOption && textSpan) {
          textSpan.textContent = selectedOption.textContent.trim();
          options.forEach(opt => opt.classList.remove('selected'));
          selectedOption.classList.add('selected');
        }
        // Re-initialize dropdown after setting value
        setTimeout(() => {
          initCustomDropdowns();
        }, 50);
      }
      
      // General tab
      if (document.getElementById('saveInIncognito')) {
        document.getElementById('saveInIncognito').checked = settings.saveInIncognito === true;
      }
      if (document.getElementById('showPhonetic')) {
        document.getElementById('showPhonetic').checked = settings.showPhonetic !== false;
      }
      if (document.getElementById('showExamples')) {
        document.getElementById('showExamples').checked = settings.showExamples !== false;
      }
      
      // Voice preference buttons
      const voicePreferenceInput = document.getElementById('voicePreference');
      const voiceFemaleBtn = document.getElementById('voiceFemaleBtn');
      const voiceMaleBtn = document.getElementById('voiceMaleBtn');
      if (voicePreferenceInput && voiceFemaleBtn && voiceMaleBtn) {
        const savedVoicePreference = settings.voicePreference || 'auto';
        voicePreferenceInput.value = savedVoicePreference;
        
        // Update button active states
        if (savedVoicePreference === 'female') {
          voiceFemaleBtn.classList.add('active');
          voiceMaleBtn.classList.remove('active');
        } else if (savedVoicePreference === 'male') {
          voiceMaleBtn.classList.add('active');
          voiceFemaleBtn.classList.remove('active');
        } else {
          // Auto - neither active
          voiceFemaleBtn.classList.remove('active');
          voiceMaleBtn.classList.remove('active');
        }
        
        // Remove old listeners by cloning and replacing (clean way to remove all listeners)
        const newFemaleBtn = voiceFemaleBtn.cloneNode(true);
        const newMaleBtn = voiceMaleBtn.cloneNode(true);
        voiceFemaleBtn.parentNode.replaceChild(newFemaleBtn, voiceFemaleBtn);
        voiceMaleBtn.parentNode.replaceChild(newMaleBtn, voiceMaleBtn);
        
        // Add click handlers to new elements
        newFemaleBtn.addEventListener('click', () => {
          voicePreferenceInput.value = 'female';
          newFemaleBtn.classList.add('active');
          newMaleBtn.classList.remove('active');
          saveSettings();
        });
        
        newMaleBtn.addEventListener('click', () => {
          voicePreferenceInput.value = 'male';
          newMaleBtn.classList.add('active');
          newFemaleBtn.classList.remove('active');
          saveSettings();
        });
      }
    });
  }
  
  // Save settings
  function saveSettings() {
    // Get values from hidden inputs (custom dropdowns) or regular selects
    const modalPlacementEl = document.getElementById('modalPlacement');
    const explanationStyleEl = document.getElementById('explanationStyle');
    const dictionaryLanguageEl = document.getElementById('dictionaryLanguage');
    const voicePreferenceEl = document.getElementById('voicePreference');
    
    const dictionaryLanguageValue = dictionaryLanguageEl?.value || detectBrowserLanguage();
    
    const settings = {
      autoRenew: document.getElementById('autoRenewToggle')?.checked || false,
      modalPlacement: modalPlacementEl?.value || 'intuitive',
      modalDraggable: document.getElementById('modalDraggable')?.checked || false,
      explanationStyle: explanationStyleEl?.value || 'plain',
      dictionaryLanguage: dictionaryLanguageValue,
      saveInIncognito: document.getElementById('saveInIncognito')?.checked || false,
      showPhonetic: document.getElementById('showPhonetic')?.checked !== false,
      showExamples: document.getElementById('showExamples')?.checked !== false,
      voicePreference: voicePreferenceEl?.value || 'auto'
    };
    
    chrome.storage.local.set({ settings }, () => {
      showNotification('Settings saved successfully!', 'success');
      // Notify content scripts of settings change
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'settingsUpdated', settings });
        }
      });
    });
  }
  
  // Auto-save settings on change
  document.addEventListener('change', (e) => {
    if (e.target.closest('#settingsPage')) {
      // If custom placement is selected, auto-enable draggable
      if (e.target.id === 'modalPlacement' && e.target.value === 'custom') {
        const draggableCheckbox = document.getElementById('modalDraggable');
        if (draggableCheckbox) {
          draggableCheckbox.checked = true;
        }
      }
      // If dictionary language changed, save immediately and translate UI
      if (e.target.id === 'dictionaryLanguage') {
        const newLang = e.target.value;
        window.currentUILanguage = newLang;
        saveSettings();
        // Translate immediately - do it twice to catch everything
        translateUI(newLang);
        // Small delay to ensure DOM is ready, then translate again
        setTimeout(() => {
          translateUI(newLang);
        }, 50);
        // Reload all hub content with new language
        // Load word of day asynchronously - don't block
        loadWordOfDay().catch(err => {
        });
        loadFavorites();
        loadRecent();
        loadSaved();
        const t = translations[newLang] || translations.en;
        showNotification(t.languageUpdated || 'Language updated!', 'success');
      } else {
        saveSettings();
      }
    }
  });
  
  // Manage subscription button
  // Subscription Management in Popup
  // Load subscription info when subscription tab is opened
  const subscriptionTabHeader = document.querySelector('[data-tab="subscription"]');
  if (subscriptionTabHeader) {
    subscriptionTabHeader.addEventListener('click', () => {
      // Load subscription info when tab is clicked
      setTimeout(() => {
        loadPopupSubscriptionInfo();
        setupManageSubscriptionButton();
      }, 300); // Wait for tab to expand
    });
  }

  // Load subscription information in popup
  async function loadPopupSubscriptionInfo() {
    const subscriptionInfo = document.getElementById('popup-subscription-info');
    const cancelBtn = document.getElementById('popup-cancel-btn');
    const resubscribeBtn = document.getElementById('popup-resubscribe-btn');
    const refundBtn = document.getElementById('popup-refund-btn');
    const refundHint = document.getElementById('popup-refund-hint');
    const statusDiv = document.getElementById('popup-subscription-status');

    if (!subscriptionInfo) return;

    try {
      const result = await chrome.storage.local.get(['subscriptionId', 'userEmail', 'subscriptionExpiry']);
      
      if (!result.subscriptionId && !result.userEmail) {
        subscriptionInfo.innerHTML = '<strong>Status:</strong> Not subscribed';
        cancelBtn.style.display = 'none';
        resubscribeBtn.style.display = 'none';
        refundBtn.style.display = 'none';
        return;
      }

      // Verify subscription status
      const response = await fetch(`${API_BASE_URL}/verify-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: result.subscriptionId || result.userEmail }),
      });

      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        data = { valid: false, error: 'Could not load subscription. Check your connection and try again.' };
      }
      if (!response.ok && !data.error) {
        data.error = data.error || 'Service temporarily unavailable. Please try again.';
      }

      if (data.valid) {
        // Get expiry date - use expiryDate from API or fallback to currentPeriodEnd
        const expiryDateStr = data.expiryDate || data.currentPeriodEnd;
        if (!expiryDateStr) {
        }
        const expiry = expiryDateStr ? new Date(expiryDateStr) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // Fallback to 1 year from now
        const now = new Date();
        const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        const isCancelled = data.cancelAtPeriodEnd === true;
        const isTrialing = data.status === 'trialing';
        
        // Calculate trial end if in trial
        let trialEndDate = null;
        let trialDaysRemaining = null;
        if (isTrialing && data.trialEnd) {
          trialEndDate = new Date(data.trialEnd * 1000);
          trialDaysRemaining = Math.ceil((trialEndDate - now) / (1000 * 60 * 60 * 24));
        }
        
        // Calculate days since purchase (for 7-day refund window)
        // Use created timestamp if available, otherwise estimate from current period end
        const subscriptionStartDate = data.created 
          ? new Date(data.created * 1000)
          : new Date(data.currentPeriodEnd * 1000 - (365 * 24 * 60 * 60 * 1000)); // Fallback: estimate 1 year ago
        const daysSincePurchase = (now - subscriptionStartDate) / (1000 * 60 * 60 * 24);
        const within7Days = daysSincePurchase <= 7;
        
        // Debug logging
        // Build subscription info HTML with center alignment and titles above
        let statusText = 'Active';
        if (isTrialing) {
          statusText = 'Trial Active';
        } else if (isCancelled) {
          statusText = 'Active (Cancelling at period end)';
        }
        
        subscriptionInfo.innerHTML = `
          <div style="text-align: center;">
            <div style="margin-bottom: 16px;">
              <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Status</div>
              <div style="font-size: 16px; font-weight: 700; color: ${isCancelled ? '#f59e0b' : isTrialing ? '#1f7fff' : '#10b981'};">${statusText}</div>
            </div>
            ${trialEndDate ? `
            <div style="margin-bottom: 16px;">
              <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Trial Ends</div>
              <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${trialEndDate.toLocaleDateString()} (${trialDaysRemaining} day${trialDaysRemaining !== 1 ? 's' : ''} left)</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Your card will be charged automatically when the trial ends</div>
            </div>
            ` : ''}
            ${expiry && !isNaN(expiry.getTime()) ? `
            <div style="margin-bottom: 16px;">
              <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Subscription Expires</div>
              <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${expiry.toLocaleDateString()} (${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining)</div>
            </div>
            ` : ''}
            <div style="margin-bottom: 16px;">
              <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Subscription ID</div>
              <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                <code style="font-size: 12px; background: var(--bg-secondary); padding: 6px 12px; border-radius: 6px; color: var(--text-primary); font-family: 'Monaco', 'Courier New', monospace;">${data.subscriptionId}</code>
                <button id="copy-subscription-id" style="background: linear-gradient(135deg, #05007f 0%, #1f7fff 100%); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; transition: all 0.2s;" title="Copy Subscription ID">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        `;
        subscriptionInfo.style.color = isCancelled ? '#f59e0b' : '#10b981';
        
        // Add copy button handler
        const copyBtn = subscriptionInfo.querySelector('#copy-subscription-id');
        if (copyBtn) {
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(data.subscriptionId);
              const originalHTML = copyBtn.innerHTML;
              copyBtn.innerHTML = '✓ Copied';
              copyBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
              setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.style.background = 'linear-gradient(135deg, #05007f 0%, #1f7fff 100%)';
              }, 2000);
              showNotification('Subscription ID copied!', 'success');
            } catch (err) {
              showNotification('Failed to copy', 'error');
            }
          });
        }

        // Show appropriate buttons
        const manageBtn = document.getElementById('popup-manage-subscription-btn');
        if (manageBtn) {
          manageBtn.style.display = 'inline-block';
          // Ensure button handler is attached when button is shown
          setupManageSubscriptionButton();
        }
        
        if (isCancelled) {
          cancelBtn.style.display = 'none';
          resubscribeBtn.style.display = 'inline-block';
          refundBtn.style.display = 'none';
        } else {
          cancelBtn.style.display = 'inline-block';
          resubscribeBtn.style.display = 'none';
          // Show refund button only if within 7 days
          // Also show during trial (trial counts as within grace period)
          if (within7Days || isTrialing) {
            refundBtn.style.display = 'inline-block';
            refundBtn.disabled = false;
            refundBtn.style.opacity = '1';
            if (refundHint) refundHint.style.display = 'block';
          } else {
            refundBtn.style.display = 'none'; // Hide after 7 days
            if (refundHint) refundHint.style.display = 'none';
          }
        }
      } else {
        const isPaymentFailed = data.status === 'past_due' || data.status === 'unpaid';
        subscriptionInfo.innerHTML = `
          <div style="text-align: center;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Status</div>
            <div style="font-size: 14px; font-weight: 600; color: #dc2626; margin-bottom: 8px;">${data.error || 'Inactive'}</div>
            ${isPaymentFailed ? '<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">Click the button below to update your card and restore access.</div>' : ''}
          </div>
        `;
        subscriptionInfo.style.color = '#dc2626';
        cancelBtn.style.display = 'none';
        resubscribeBtn.style.display = 'none';
        refundBtn.style.display = 'none';
        const manageBtn = document.getElementById('popup-manage-subscription-btn');
        if (manageBtn) {
          manageBtn.style.display = isPaymentFailed ? 'inline-block' : 'none';
          if (isPaymentFailed) {
            manageBtn.textContent = 'Update payment method';
            setupManageSubscriptionButton();
          }
        }
      }
    } catch (error) {
      subscriptionInfo.innerHTML = '<strong>Status:</strong> Error loading subscription. Check your connection and try again.';
      subscriptionInfo.style.color = '#dc2626';
      cancelBtn.style.display = 'none';
      resubscribeBtn.style.display = 'none';
      refundBtn.style.display = 'none';
      const manageBtn = document.getElementById('popup-manage-subscription-btn');
      if (manageBtn) manageBtn.style.display = 'none';
    }
  }

  // Show confirmation modal
  function showConfirmationModal(title, message, confirmText, cancelText, onConfirm) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background: white; padding: 24px; border-radius: 12px; max-width: 400px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);';
    
    modalContent.innerHTML = `
      <h3 style="margin: 0 0 16px 0; color: #05007f; font-size: 20px; font-weight: 700;">${title}</h3>
      <p style="margin: 0 0 24px 0; color: #475569; font-size: 14px; line-height: 1.6;">${message}</p>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="modal-cancel" style="padding: 10px 20px; border: 1px solid #cbd5e1; background: white; color: #475569; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px;">${cancelText || 'Cancel'}</button>
        <button id="modal-confirm" style="padding: 10px 20px; border: none; background: linear-gradient(135deg, #05007f 0%, #1f7fff 100%); color: white; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(5, 0, 127, 0.35);">${confirmText || 'Confirm'}</button>
      </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    const confirmBtn = modalContent.querySelector('#modal-confirm');
    const cancelBtn = modalContent.querySelector('#modal-cancel');
    
    return new Promise((resolve) => {
      confirmBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve(true);
      });
      
      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        resolve(false);
      });
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
          resolve(false);
        }
      });
    });
  }

  // Manage subscription button handler - set up when button is available
  function setupManageSubscriptionButton() {
    const manageSubscriptionBtn = document.getElementById('popup-manage-subscription-btn');
    if (!manageSubscriptionBtn) {
      return;
    }
    
    // Remove any existing listeners by cloning the button
    const newBtn = manageSubscriptionBtn.cloneNode(true);
    manageSubscriptionBtn.parentNode.replaceChild(newBtn, manageSubscriptionBtn);
    
    newBtn.addEventListener('click', async () => {
      newBtn.disabled = true;
      newBtn.textContent = 'Opening...';
      
      try {
        const result = await chrome.storage.local.get(['subscriptionId', 'userEmail', 'subscriptionExpiry']);
        let email = result.userEmail;
        let subscriptionId = result.subscriptionId;
        
        // If storage is empty, try to get from subscription info that was just loaded
        if (!email && !subscriptionId) {
          // Try to get from the subscription info display
          const subscriptionInfo = document.getElementById('popup-subscription-info');
          if (subscriptionInfo) {
            const subscriptionIdMatch = subscriptionInfo.textContent.match(/sub_[a-zA-Z0-9]+/);
            if (subscriptionIdMatch) {
              subscriptionId = subscriptionIdMatch[0];
            }
          }
          
          // If still no data, try to verify by checking if user has active subscription
          if (!email && !subscriptionId) {
            // Last resort: try to get email from Chrome identity
            try {
              const identityResult = await new Promise((resolve) => {
                chrome.identity.getProfileUserInfo((userInfo) => {
                  if (userInfo && userInfo.email) {
                    resolve(userInfo.email);
                  } else {
                    resolve(null);
                  }
                });
              });
              if (identityResult) {
                email = identityResult;
              }
            } catch (e) {
            }
          }
        }
        
        // If we still have nothing, show error
        if (!email && !subscriptionId) {
          showNotification('No subscription found. Please ensure you are signed in and have an active subscription.', 'error');
          newBtn.disabled = false;
          const currentLang = window.currentUILanguage || 'en';
          const t = translations[currentLang] || translations.en;
          newBtn.textContent = t.manageSubscription || 'Manage Subscription';
          return;
        }
        
        const returnUrl = chrome.runtime.getURL('popup.html');
        const portalUrl = `${API_BASE_URL}/create-portal-session`;
        
        const response = await fetch(portalUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            subscriptionId: subscriptionId,
            returnUrl: returnUrl
          }),
        });
        
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        
        if (response.ok && data.url) {
          // Open Stripe customer portal in new tab
          chrome.tabs.create({ url: data.url });
          showNotification('Opening subscription management...', 'success');
        } else {
          const errorMsg = data.error || data.message || 'Failed to open subscription management. Please check the console for details.';
          
          // Don't show "environment" errors - show user-friendly message
          if (errorMsg.toLowerCase().includes('environment') || errorMsg.toLowerCase().includes('not available')) {
            showNotification('Unable to open subscription management. Please try refreshing the extension or contact support.', 'error');
          } else {
            showNotification(errorMsg, 'error');
          }
        }
      } catch (error) {
        
        // Check if it's a network error
        if (error.message && error.message.includes('fetch')) {
          showNotification('Network error. Please check your connection and try again.', 'error');
        } else if (error.message && error.message.includes('environment')) {
          showNotification('Unable to open subscription management. Please try refreshing the extension.', 'error');
        } else {
          showNotification('Error opening subscription management. Please try again.', 'error');
        }
      } finally {
        newBtn.disabled = false;
        const currentLang = window.currentUILanguage || 'en';
        const t = translations[currentLang] || translations.en;
        newBtn.textContent = t.manageSubscription || 'Manage Subscription';
      }
    });
    
  }
  
  // Set up immediately if button exists
  setupManageSubscriptionButton();

  // Sign out in Subscription tab (Settings)
  const popupSubscriptionSignoutBtn = document.getElementById('popup-subscription-signout-btn');
  if (popupSubscriptionSignoutBtn) {
    popupSubscriptionSignoutBtn.addEventListener('click', () => {
      performPopupSignOut('Sign out? You will need to sign in again to use premium features.');
    });
  }

  // Sign out at bottom of Settings page
  const settingsFooterSignoutBtn = document.getElementById('settings-footer-signout-btn');
  if (settingsFooterSignoutBtn) {
    settingsFooterSignoutBtn.addEventListener('click', () => {
      performPopupSignOut('Sign out? You will need to sign in again to use premium features.');
    });
  }

  // Cancel subscription button
  const popupCancelBtn = document.getElementById('popup-cancel-btn');
  const cancelHint = document.getElementById('popup-cancel-hint');
  if (popupCancelBtn) {
    // Show/hide hint when button is shown
    const observer = new MutationObserver(() => {
      if (popupCancelBtn.style.display !== 'none') {
        if (cancelHint) cancelHint.style.display = 'block';
      } else {
        if (cancelHint) cancelHint.style.display = 'none';
      }
    });
    observer.observe(popupCancelBtn, { attributes: true, attributeFilter: ['style'] });
    
    popupCancelBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmationModal(
        'Cancel Subscription',
        'Your subscription will be cancelled at the end of the current billing period. You will retain access until then. If you are within 7 days of purchase, you will receive a full refund automatically.',
        'Yes, Cancel Subscription',
        'Keep Subscription'
      );
      
      if (!confirmed) return;

      popupCancelBtn.disabled = true;
      popupCancelBtn.textContent = 'Cancelling...';
      const statusDiv = document.getElementById('popup-subscription-status');
      if (statusDiv) {
        statusDiv.innerHTML = '';
        statusDiv.style.color = '';
      }

      try {
        const result = await chrome.storage.local.get(['subscriptionId', 'userEmail']);
        const response = await fetch(`${API_BASE_URL}/cancel-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: result.subscriptionId,
            email: result.userEmail,
            autoRefund: true, // Request auto-refund if within 7 days
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          if (data.refunded) {
            // Was refunded (within 7 days)
            await chrome.storage.local.remove(['subscriptionId', 'subscriptionExpiry', 'subscriptionActive']);
            if (statusDiv) {
              statusDiv.innerHTML = `✅ Subscription cancelled and refunded. £${data.refundAmount || 2.99} will be refunded to your original payment method.`;
              statusDiv.style.color = '#10b981';
            }
            showNotification('Subscription cancelled and refunded', 'success');
          } else {
            // Cancelled at period end
            if (statusDiv) {
              statusDiv.innerHTML = `✅ Subscription will be cancelled at period end. You'll retain access until ${new Date(data.currentPeriodEnd * 1000).toLocaleDateString()}.`;
              statusDiv.style.color = '#10b981';
            }
            showNotification('Subscription cancellation scheduled', 'success');
          }
          
          // Reload subscription info
          setTimeout(() => {
            loadPopupSubscriptionInfo();
          }, 2000);
        } else {
          if (statusDiv) {
            statusDiv.innerHTML = `❌ ${data.error || 'Failed to cancel subscription'}`;
            statusDiv.style.color = '#dc2626';
          }
          showNotification('Failed to cancel subscription', 'error');
          popupCancelBtn.disabled = false;
          popupCancelBtn.textContent = 'Cancel Subscription';
        }
      } catch (error) {
        if (statusDiv) {
          statusDiv.innerHTML = '❌ Error cancelling subscription. Please try again.';
          statusDiv.style.color = '#dc2626';
        }
        showNotification('Error cancelling subscription', 'error');
        popupCancelBtn.disabled = false;
        popupCancelBtn.textContent = 'Cancel Subscription';
      }
    });
  }

  // Resubscribe button
  const popupResubscribeBtn = document.getElementById('popup-resubscribe-btn');
  if (popupResubscribeBtn) {
    popupResubscribeBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmationModal(
        'Resubscribe',
        'This will reactivate your subscription and it will continue to renew automatically.',
        'Yes, Resubscribe',
        'Cancel'
      );
      
      if (!confirmed) return;

      popupResubscribeBtn.disabled = true;
      popupResubscribeBtn.textContent = 'Reactivating...';
      const statusDiv = document.getElementById('popup-subscription-status');
      if (statusDiv) {
        statusDiv.innerHTML = '';
        statusDiv.style.color = '';
      }

      try {
        const result = await chrome.storage.local.get(['subscriptionId', 'userEmail']);
        const response = await fetch(`${API_BASE_URL}/cancel-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: result.subscriptionId,
            email: result.userEmail,
            action: 'reactivate',
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          if (statusDiv) {
            statusDiv.innerHTML = '✅ Subscription reactivated successfully!';
            statusDiv.style.color = '#10b981';
          }
          showNotification('Subscription reactivated', 'success');
          
          // Reload subscription info
          setTimeout(() => {
            loadPopupSubscriptionInfo();
          }, 2000);
        } else {
          if (statusDiv) {
            statusDiv.innerHTML = `❌ ${data.error || 'Failed to reactivate subscription'}`;
            statusDiv.style.color = '#dc2626';
          }
          showNotification('Failed to reactivate subscription', 'error');
          popupResubscribeBtn.disabled = false;
          popupResubscribeBtn.textContent = 'Resubscribe';
        }
      } catch (error) {
        if (statusDiv) {
          statusDiv.innerHTML = '❌ Error reactivating subscription. Please try again.';
          statusDiv.style.color = '#dc2626';
        }
        showNotification('Error reactivating subscription', 'error');
        popupResubscribeBtn.disabled = false;
        popupResubscribeBtn.textContent = 'Resubscribe';
      }
    });
  }

  // Refund button
  const popupRefundBtn = document.getElementById('popup-refund-btn');
  const refundHint = document.getElementById('popup-refund-hint');
  if (popupRefundBtn) {
    // Show/hide hint when button is shown
    const observer = new MutationObserver(() => {
      if (popupRefundBtn.style.display !== 'none') {
        if (refundHint) refundHint.style.display = 'block';
      } else {
        if (refundHint) refundHint.style.display = 'none';
      }
    });
    observer.observe(popupRefundBtn, { attributes: true, attributeFilter: ['style'] });
    
    popupRefundBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmationModal(
        'Request Refund',
        'Are you sure you want to request a refund? Your subscription will be cancelled immediately and you will lose access. This action cannot be undone. Refunds are only available within 7 days of purchase.',
        'Yes, Request Refund',
        'Cancel'
      );
      
      if (!confirmed) return;

      popupRefundBtn.disabled = true;
      popupRefundBtn.textContent = 'Processing refund...';
      const statusDiv = document.getElementById('popup-subscription-status');
      if (statusDiv) {
        statusDiv.innerHTML = '';
        statusDiv.style.color = '';
      }

      try {
        const result = await chrome.storage.local.get(['subscriptionId', 'userEmail']);
        const response = await fetch(`${API_BASE_URL}/process-refund`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptionId: result.subscriptionId,
            email: result.userEmail,
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Clear subscription from storage
          await chrome.storage.local.remove(['subscriptionId', 'subscriptionExpiry', 'subscriptionActive']);
          
          if (statusDiv) {
            statusDiv.innerHTML = `✅ Refund processed successfully! £${data.amount || 2.99} will be refunded to your original payment method.`;
            statusDiv.style.color = '#10b981';
          }
          showNotification('Refund processed successfully', 'success');
          
          // Reload subscription info
          setTimeout(() => {
            loadPopupSubscriptionInfo();
          }, 2000);
        } else {
          if (statusDiv) {
            statusDiv.innerHTML = `❌ ${data.error || 'Failed to process refund'}. ${data.details || ''}`;
            statusDiv.style.color = '#dc2626';
          }
          showNotification('Failed to process refund', 'error');
          popupRefundBtn.disabled = false;
          popupRefundBtn.textContent = 'Request Refund (7-day window)';
        }
      } catch (error) {
        if (statusDiv) {
          statusDiv.innerHTML = '❌ Error processing refund. Please try again.';
          statusDiv.style.color = '#dc2626';
        }
        showNotification('Error processing refund', 'error');
        popupRefundBtn.disabled = false;
        popupRefundBtn.textContent = 'Request Refund (7-day window)';
      }
    });
  }
  
  // Clear all data button
  const clearAllDataBtn = document.getElementById('clearAllDataBtn');
  if (clearAllDataBtn) {
    clearAllDataBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
        chrome.storage.local.clear(() => {
          showNotification('All data cleared successfully!', 'success');
          loadFavorites();
          loadRecent();
          loadSaved();
          // Load word of day asynchronously - don't block
          loadWordOfDay().catch(err => {
          });
        });
      }
    });
  }
  
  // Contact form handler
  const sendContactBtn = document.getElementById('sendContactBtn');
  if (sendContactBtn) {
    sendContactBtn.addEventListener('click', async () => {
      const name = document.getElementById('contactName').value.trim();
      const email = document.getElementById('contactEmail').value.trim();
      const issueType = document.getElementById('contactIssueType').value;
      const message = document.getElementById('contactMessage').value.trim();
      
      // Get issue type display text
      const issueTypeDropdown = document.getElementById('contactIssueTypeDropdown');
      const issueTypeText = issueTypeDropdown ? issueTypeDropdown.querySelector('.custom-dropdown-text').textContent : 'General Inquiry';
      
      // Validation
      if (!name || !email || !message) {
        showNotification('Please fill in all required fields.', 'error');
        return;
      }
      
      // Create subject from issue type
      const subject = `[${issueTypeText}] Contact Form Submission`;
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        showNotification('Please enter a valid email address.', 'error');
        return;
      }
      
      // Disable button during send
      sendContactBtn.disabled = true;
      const originalText = sendContactBtn.textContent;
      sendContactBtn.textContent = 'Sending...';
      
      try {
        // Send email via background script
        chrome.runtime.sendMessage({
          type: 'sendContactEmail',
          data: {
            name: name,
            email: email,
            subject: subject,
            message: message
          }
        }, (response) => {
          sendContactBtn.disabled = false;
          sendContactBtn.textContent = originalText;
          
          if (chrome.runtime.lastError) {
            // Fallback to mailto
            const recipient = 'charles@leveldesignagency.com';
            const mailtoSubject = encodeURIComponent(`[Nimbus Extension] ${subject}`);
            const mailtoBody = encodeURIComponent(`Name: ${name}\nEmail: ${email}\nIssue Type: ${issueTypeText}\n\nMessage:\n${message}`);
            window.location.href = `mailto:${recipient}?subject=${mailtoSubject}&body=${mailtoBody}`;
            showNotification('Opening email client...', 'success');
            return;
          }
          
          if (response && response.success) {
            // Clear form
            document.getElementById('contactName').value = '';
            document.getElementById('contactEmail').value = '';
            document.getElementById('contactMessage').value = '';
            
            // Reset dropdown to default
            const issueTypeDropdown = document.getElementById('contactIssueTypeDropdown');
            if (issueTypeDropdown) {
              const hiddenInput = document.getElementById('contactIssueType');
              const textSpan = issueTypeDropdown.querySelector('.custom-dropdown-text');
              const defaultOption = issueTypeDropdown.querySelector('.custom-dropdown-option[data-value="general"]');
              if (hiddenInput && textSpan && defaultOption) {
                hiddenInput.value = 'general';
                textSpan.textContent = defaultOption.textContent.trim();
                issueTypeDropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => opt.classList.remove('selected'));
                defaultOption.classList.add('selected');
              }
            }
            
            showNotification('Message sent successfully!', 'success');
          } else {
            // Fallback to mailto if API fails
            const recipient = 'charles@leveldesignagency.com';
            const mailtoSubject = encodeURIComponent(`[Nimbus Extension] ${subject}`);
            const mailtoBody = encodeURIComponent(`Name: ${name}\nEmail: ${email}\nIssue Type: ${issueTypeText}\n\nMessage:\n${message}`);
            window.location.href = `mailto:${recipient}?subject=${mailtoSubject}&body=${mailtoBody}`;
            showNotification('Opening email client...', 'success');
          }
        });
      } catch (error) {
        sendContactBtn.disabled = false;
        sendContactBtn.textContent = originalText;
        showNotification('Failed to send message. Please try again.', 'error');
      }
    });
  }

  // Search input handler - execute search on Enter
  if (searchInput) {
    searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const isActive = await checkSubscription();
        if (!isActive) {
          showUpgradePromptInPopup();
          showNotification('Please subscribe to use search functionality.', 'error');
          return;
        }
        const query = searchInput.value.trim();
        if (query.length >= 2) {
          executeSearch(query);
        }
      }
    });

    // Search icon button handler
    const searchIconBtn = document.getElementById('searchIconBtn');
    if (searchIconBtn) {
      searchIconBtn.addEventListener('click', async () => {
        const isActive = await checkSubscription();
        if (!isActive) {
          showUpgradePromptInPopup();
          showNotification('Please subscribe to use search functionality.', 'error');
          return;
        }
        const query = searchInput.value.trim();
        if (query.length >= 2) {
          executeSearch(query);
        }
      });
    }
  }

  // Show loading placeholder cards
  function showLoadingPlaceholder(query) {
    currentView = 'search';
    // Add hub-search-mode class when showing search results
    document.body.classList.add('hub-search-mode');
    
    // Hide other sections
    document.querySelectorAll('.section').forEach(section => {
      if (section.querySelector('#wordOfDay') === null) {
        section.style.display = 'none';
      }
    });
    
    // Show loading placeholder with better styling
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal loading-card">
        <div class="word-card-header">
          <div class="word-card-header-top">
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word loading-skeleton-text">Searching...</span>
              </div>
            </div>
          </div>
        </div>
        <div class="word-card-content loading-content">
          <div class="loading-skeleton-line"></div>
          <div class="loading-skeleton-line"></div>
          <div class="loading-skeleton-line" style="width: 90%;"></div>
          <div class="loading-skeleton-line" style="width: 95%;"></div>
          <div class="loading-skeleton-line" style="width: 85%;"></div>
        </div>
      </div>
    `;
  }

  // Execute search - handles both words and people
  async function executeSearch(query) {
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return;
    }
    
    // Check subscription before executing search
    const isActive = await checkSubscription();
    if (!isActive) {
      showUpgradePromptInPopup();
      showNotification('Please subscribe to use search functionality.', 'error');
      return;
    }
    
    const trimmedQuery = query.trim();
    
    // Show loading placeholder immediately
    showLoadingPlaceholder(trimmedQuery);
    
    // For 3+ word phrases, always use AI (skip entity detection)
    const words = trimmedQuery.split(/\s+/).filter(w => w.trim().length > 0);
    const isPhrase = words.length >= 3;
    
    // Check if it might be a person, organization, or entity (only for 1-2 words)
    let isLikelyEntity = false;
    if (!isPhrase) {
      isLikelyEntity = /^[A-Z][A-Za-z'\-]+(\s+[A-Z][A-Za-z'\-]+)*(\s+(Inc|LLC|Ltd|Corp|Company|Corporation|Foundation|Institute|University|College|Group|Organization|Org))?$/i.test(trimmedQuery) && 
                      trimmedQuery.split(/\s+/).length >= 1 && 
                      trimmedQuery.split(/\s+/).length <= 6 &&
                      trimmedQuery.length >= 2 &&
                      trimmedQuery.length <= 80;
    }
    
      if (isLikelyEntity) {
        // Try to fetch entity data (person or organization)
        try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'explain',
            word: trimmedQuery,
            context: ''
          }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          });
        });
        
          if (response && response.error) {
            throw new Error(response.error);
          }
          
          if (response && response.isPerson && response.personData) {
            displayPersonResult(trimmedQuery, response.personData);
            return;
          } else if (response && response.isOrganization && response.organizationData) {
            displayOrganizationResult(trimmedQuery, response.organizationData);
            return;
          } else if (response && response.isPlace && response.placeData) {
            displayPlaceResult(trimmedQuery, response.placeData);
            return;
          } else if (response && (response.isPartialName || response.isPartialNameFallback) && response.partialNameData) {
            // Handle partial names (first name only, etc.)
            if (response.isPartialName && response.partialNameData.explanation) {
              // AI succeeded - show in tooltip with links
              displayPartialNameResult(trimmedQuery, response.partialNameData, true);
            } else {
              // AI failed or timed out - show news articles in hub
              displayPartialNameResult(trimmedQuery, response.partialNameData, false);
            }
            return;
          }
        } catch (err) {
          // Continue to word search below
        }
      }
      
      // For phrases or when entity search fails, use word search (dictionary first, then AI)
      // This will automatically use AI if dictionary fails
      try {
      await showWordDetails(trimmedQuery);
    } catch (err) {
      // Clear loading placeholder and show error message
      wordOfDayDiv.innerHTML = `
        <div class="word-card-modal">
          <div class="word-card-header">
            <div class="word-card-header-top">
              <div class="word-card-word-container">
                <div class="word-card-word-wrapper">
                  <span class="word-card-word">${query}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="word-card-content">
            <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
              <p style="margin-bottom: 12px; font-weight: 600; color: var(--text-primary);">Unable to find information</p>
              <p style="font-size: 13px; color: var(--text-muted);">Please try searching again or check your connection.</p>
            </div>
          </div>
        </div>
      `;
    }
  }

  // Display location result in hub with map view
  function displayLocationResult(locationTerm, canMap = true) {
    currentView = 'location';
    document.body.classList.add('hub-search-mode');
    
    // Hide other sections
    document.querySelectorAll('.section').forEach(section => {
      if (section.querySelector('#wordOfDay') === null) {
        section.style.display = 'none';
      }
    });
    
    // Save to recent
    saveToRecent(locationTerm);
    loadRecent();
    
    // Build location card HTML with map
    const hasBack = navigationHistory.length > 1;
    const wordOfDayDiv = document.getElementById('wordOfDay');
    
    // Google Maps embed URL (using iframe with search query - free, no API key needed)
    const mapsQuery = encodeURIComponent(locationTerm);
    // Use Google Maps search URL directly in iframe (works without API key)
    const mapsEmbedUrl = `https://www.google.com/maps?q=${mapsQuery}&output=embed`;
    // Fallback to full Google Maps page
    const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
    
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal location-card">
        <div class="word-card-header">
          <div class="word-card-header-top">
            ${hasBack ? `<button class="word-card-back-btn" id="wordCardBackBtn" title="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>` : ''}
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${locationTerm}</span>
              </div>
              <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy location">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="word-card-content location-content">
          <div class="location-map-container" style="width: 100%; height: 400px; border-radius: 12px; overflow: hidden; margin-bottom: 16px; background: #f1f5f9; display: flex; align-items: center; justify-content: center;">
            ${canMap ? `
              <iframe 
                src="${mapsEmbedUrl}" 
                width="100%" 
                height="100%" 
                style="border: 0; border-radius: 12px;" 
                allowfullscreen="" 
                loading="lazy" 
                referrerpolicy="no-referrer-when-downgrade">
              </iframe>
            ` : `
              <div style="padding: 20px; text-align: center; color: #64748b;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 12px; opacity: 0.5;">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
                <p style="margin: 0 0 12px; font-size: 14px;">Location found but cannot be mapped directly.</p>
                <a href="${mapsSearchUrl}" target="_blank" style="color: #05007f; text-decoration: underline; font-weight: 500;">Search on Google Maps</a>
              </div>
            `}
          </div>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <a href="${mapsSearchUrl}" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; background: linear-gradient(135deg, #05007f 0%, #1f7fff 100%); color: white; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px; transition: all 0.2s;" onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 4px 8px rgba(5, 0, 127, 0.35)';" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none';">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              Open in Google Maps
            </a>
            <a href="https://www.google.com/search?q=${mapsQuery}" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; background: #f8fafc; color: #05007f; border: 2px solid rgba(31, 127, 255, 0.25); border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px; transition: all 0.2s;" onmouseover="this.style.borderColor='#05007f'; this.style.background='#ffffff';" onmouseout="this.style.borderColor='rgba(31, 127, 255, 0.25)'; this.style.background='#f8fafc';">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              Search on Google
            </a>
          </div>
        </div>
      </div>
    `;
    
    // Set up back button
    if (hasBack) {
      const backBtn = document.getElementById('wordCardBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          navigationHistory.pop();
          if (navigationHistory.length > 0) {
            const prev = navigationHistory[navigationHistory.length - 1];
            if (prev.type === 'person') {
              displayPersonResult(prev.term, prev.data);
            } else if (prev.type === 'organization') {
              displayOrganizationResult(prev.term, prev.data);
            } else if (prev.type === 'place') {
              displayPlaceResult(prev.term, prev.data);
            } else if (prev.type === 'location') {
              displayLocationResult(prev.term, prev.canMap);
            } else {
              showWordDetails(prev.term);
            }
          } else {
            location.reload();
          }
        });
      }
    }
    
    // Set up copy button
    const copyBtn = document.getElementById('wordCardCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(locationTerm);
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 300);
        } catch (err) {
        }
      });
    }
    
    // Add to navigation history
    navigationHistory.push({ type: 'location', term: locationTerm, canMap: canMap });
  }

  // Display person result in hub
  function displayPersonResult(searchTerm, personData) {
    if (!personData) {
      showWordDetails(searchTerm);
      return;
    }
    const container = document.getElementById('wordOfDay') || wordOfDayDiv;
    if (!container) {
      showWordDetails(searchTerm);
      return;
    }
    const section = container.closest('.section');
    if (section) section.style.display = 'block';
    const wordOfDayTop = container.closest('.word-of-day-top');
    if (wordOfDayTop) wordOfDayTop.style.display = 'block';
    container.style.display = 'block';
    currentView = 'person';
    document.body.classList.add('hub-search-mode');
    document.body.classList.add('entity-card-view');
    document.querySelectorAll('.section').forEach(sec => {
      if (sec.querySelector('#wordOfDay') === null) sec.style.display = 'none';
    });
    saveToRecent(searchTerm);
    loadRecent();
    const hasBack = navigationHistory.length > 1;
    container.innerHTML = `
      <div class="word-card-modal person-card">
        <div class="word-card-header">
          <div class="word-card-header-top">
            ${hasBack ? `<button class="word-card-back-btn" id="wordCardBackBtn" title="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>` : ''}
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${personData.name || searchTerm}</span>
              </div>
              <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy name">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="word-card-content person-content">
          ${personData.image ? `<div class="person-image-container">
            <img src="${personData.image}" alt="${personData.name}" class="person-image" onerror="this.parentElement.style.display='none';">
          </div>` : ''}
          <div class="word-card-explanation person-bio">
            ${personData.bio || personData.summary || 'No biography available.'}
          </div>
          ${personData.birthDate || personData.age || personData.occupation || personData.nationality || personData.relationships || personData.notableWorks ? `
          <div class="person-metadata">
            ${personData.birthDate ? `<div class="person-meta-item"><strong>Born:</strong> ${personData.birthDate}${personData.age ? ` (Age: ${personData.age})` : ''}</div>` : personData.age ? `<div class="person-meta-item"><strong>Age:</strong> ${personData.age}</div>` : ''}
            ${personData.occupation ? `<div class="person-meta-item"><strong>Occupation:</strong> ${personData.occupation}</div>` : ''}
            ${personData.nationality ? `<div class="person-meta-item"><strong>Nationality:</strong> ${personData.nationality}</div>` : ''}
            ${personData.relationships && personData.relationships.length > 0 ? `<div class="person-meta-item"><strong>Relationships:</strong> ${Array.isArray(personData.relationships) ? personData.relationships.join(', ') : personData.relationships}</div>` : ''}
            ${personData.notableWorks && personData.notableWorks.length > 0 ? `<div class="person-meta-item"><strong>Notable Works:</strong> ${Array.isArray(personData.notableWorks) ? personData.notableWorks.join(', ') : personData.notableWorks}</div>` : ''}
          </div>
          ` : ''}
          ${personData.newsArticles && personData.newsArticles.length > 0 ? `
          <div class="person-news-section">
            <div class="person-news-title">${translations[window.currentUILanguage || 'en']?.recentNews || 'Recent News'}</div>
            <div class="person-news-list">
              ${personData.newsArticles.map((article, index) => `
                ${article.link ? `
                <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="person-news-item" data-news-index="${index}" style="text-decoration: none; color: inherit; display: block;">
                  <div class="person-news-title-text">${article.title}</div>
                  ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                </a>
                ` : `
                <div class="person-news-item" data-news-index="${index}">
                  <div class="person-news-title-text">${article.title}</div>
                  ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                </div>
                `}
              `).join('')}
            </div>
          </div>
          ` : ''}
          ${(personData.socialLinks && (personData.socialLinks.twitter || personData.socialLinks.instagram || personData.socialLinks.youtube || personData.socialLinks.tiktok)) ? `
          <div class="person-social">
            ${personData.socialLinks.twitter ? `<a href="${personData.socialLinks.twitter}" target="_blank" rel="noopener noreferrer" title="X (Twitter)" class="person-social-icon">${'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'}</a>` : ''}
            ${personData.socialLinks.instagram ? `<a href="${personData.socialLinks.instagram}" target="_blank" rel="noopener noreferrer" title="Instagram" class="person-social-icon">${'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="18" cy="6" r="1.5" fill="currentColor"/></svg>'}</a>` : ''}
            ${personData.socialLinks.youtube ? `<a href="${personData.socialLinks.youtube}" target="_blank" rel="noopener noreferrer" title="YouTube" class="person-social-icon">${'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><polygon points="10,9 10,15 15,12" fill="currentColor"/></svg>'}</a>` : ''}
            ${personData.socialLinks.tiktok ? `<a href="${personData.socialLinks.tiktok}" target="_blank" rel="noopener noreferrer" title="TikTok" class="person-social-icon">${'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>'}</a>` : ''}
          </div>
          ` : ''}
          <div class="entity-sources">${[
            personData.wikipediaUrl ? `<a href="${personData.wikipediaUrl}" target="_blank" rel="noopener noreferrer">Wikipedia</a>` : '',
            `<a href="https://news.google.com/search?q=${encodeURIComponent(personData.name || searchTerm)}" target="_blank" rel="noopener noreferrer">Google News</a>`,
            `<a href="https://www.bbc.co.uk/search?q=${encodeURIComponent(personData.name || searchTerm)}" target="_blank" rel="noopener noreferrer">BBC</a>`
          ].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
    `;
    
    // Add event listeners
    if (hasBack) {
      const backBtn = document.getElementById('wordCardBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          navigationHistory.pop();
          if (navigationHistory.length > 0) {
            showWordDetails(navigationHistory[navigationHistory.length - 1], false);
          } else {
            returnToHub();
          }
        });
      }
    }
    
    const copyBtn = document.getElementById('wordCardCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(personData.name || searchTerm);
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 300);
        } catch (err) {
        }
      });
    }
    
    if (personData.newsArticles && personData.newsArticles.length > 0) {
      container.querySelectorAll('.person-news-item').forEach((item, index) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const article = personData.newsArticles[index];
          if (article && article.link) window.open(article.link, '_blank', 'noopener,noreferrer');
        });
      });
    }
  }

  // Display organization result in hub
  function displayOrganizationResult(searchTerm, orgData) {
    const container = document.getElementById('wordOfDay') || wordOfDayDiv;
    if (container) {
      const wordOfDayTop = container.closest('.word-of-day-top');
      if (wordOfDayTop) wordOfDayTop.style.display = 'block';
      container.style.display = 'block';
    }
    currentView = 'organization';
    document.body.classList.add('hub-search-mode');
    document.body.classList.add('entity-card-view');
    
    // Hide other sections
    document.querySelectorAll('.section').forEach(section => {
      if (section.querySelector('#wordOfDay') === null) {
        section.style.display = 'none';
      }
    });
    
    // Save to recent
    saveToRecent(searchTerm);
    loadRecent();
    
    // Build organization card HTML
    const hasBack = navigationHistory.length > 1;
    (container || wordOfDayDiv).innerHTML = `
      <div class="word-card-modal person-card">
        <div class="word-card-header">
          <div class="word-card-header-top">
            ${hasBack ? `<button class="word-card-back-btn" id="wordCardBackBtn" title="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>` : ''}
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${orgData.name || searchTerm}</span>
              </div>
              <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy name">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="word-card-content person-content">
          ${orgData.image ? `<div class="person-image-container">
            <img src="${orgData.image}" alt="${orgData.name}" class="person-image" onerror="this.parentElement.style.display='none';">
          </div>` : ''}
          <div class="word-card-explanation person-bio">
            ${orgData.bio || orgData.summary || 'No information available.'}
          </div>
          ${orgData.founded || orgData.headquarters || orgData.industry || orgData.revenue || orgData.employees || orgData.keyPeople || orgData.relatedCompanies ? `
          <div class="person-metadata">
            ${orgData.founded ? `<div class="person-meta-item"><strong>Founded:</strong> ${orgData.founded}</div>` : ''}
            ${orgData.headquarters ? `<div class="person-meta-item"><strong>Headquarters:</strong> ${orgData.headquarters}</div>` : ''}
            ${orgData.industry ? `<div class="person-meta-item"><strong>Industry:</strong> ${orgData.industry}</div>` : ''}
            ${orgData.revenue ? `<div class="person-meta-item"><strong>Revenue:</strong> ${orgData.revenue}</div>` : ''}
            ${orgData.employees ? `<div class="person-meta-item"><strong>Employees:</strong> ${orgData.employees}</div>` : ''}
            ${orgData.keyPeople && orgData.keyPeople.length > 0 ? `<div class="person-meta-item"><strong>Key People:</strong> ${Array.isArray(orgData.keyPeople) ? orgData.keyPeople.join(', ') : orgData.keyPeople}</div>` : ''}
            ${orgData.relatedCompanies && orgData.relatedCompanies.length > 0 ? `<div class="person-meta-item"><strong>Related Companies:</strong> ${Array.isArray(orgData.relatedCompanies) ? orgData.relatedCompanies.join(', ') : orgData.relatedCompanies}</div>` : ''}
          </div>
          ` : ''}
          ${orgData.newsArticles && orgData.newsArticles.length > 0 ? `
          <div class="person-news-section">
            <div class="person-news-title">${translations[window.currentUILanguage || 'en']?.recentNews || 'Recent News'}</div>
            <div class="person-news-list">
              ${orgData.newsArticles.map((article, index) => `
                ${article.link ? `
                <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="person-news-item" data-news-index="${index}" style="text-decoration: none; color: inherit; display: block;">
                  <div class="person-news-title-text">${article.title}</div>
                  ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                </a>
                ` : `
                <div class="person-news-item" data-news-index="${index}">
                  <div class="person-news-title-text">${article.title}</div>
                  ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                </div>
                `}
              `).join('')}
            </div>
          </div>
          ` : ''}
          <div class="entity-sources">${[
            orgData.wikipediaUrl ? `<a href="${orgData.wikipediaUrl}" target="_blank" rel="noopener noreferrer">Wikipedia</a>` : '',
            `<a href="https://news.google.com/search?q=${encodeURIComponent(orgData.name || searchTerm)}" target="_blank" rel="noopener noreferrer">Google News</a>`,
            `<a href="https://www.bbc.co.uk/search?q=${encodeURIComponent(orgData.name || searchTerm)}" target="_blank" rel="noopener noreferrer">BBC</a>`
          ].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
    `;
    
    // Add event listeners (similar to person)
    if (hasBack) {
      const backBtn = document.getElementById('wordCardBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          navigationHistory.pop();
          if (navigationHistory.length > 0) {
            showWordDetails(navigationHistory[navigationHistory.length - 1], false);
          } else {
            returnToHub();
          }
        });
      }
    }
    
    const copyBtn = document.getElementById('wordCardCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(orgData.name || searchTerm);
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 300);
        } catch (err) {
        }
      });
    }
    
    // Add click handlers for news items
    if (orgData.newsArticles && orgData.newsArticles.length > 0) {
      wordOfDayDiv.querySelectorAll('.person-news-item').forEach((item, index) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const article = orgData.newsArticles[index];
          if (article && article.link) {
            window.open(article.link, '_blank', 'noopener,noreferrer');
          }
        });
      });
    }
  }

  // Display place result in hub
  // Display partial name result (first name only, etc.)
  function displayPartialNameResult(searchTerm, partialNameData, hasAIExplanation) {
    const container = document.getElementById('wordOfDay') || wordOfDayDiv;
    if (!container) {
      showWordDetails(searchTerm);
      return;
    }
    const section = container.closest('.section');
    if (section) section.style.display = 'block';
    currentView = 'partialName';
    document.body.classList.add('hub-search-mode');
    document.body.classList.add('entity-card-view');
    document.querySelectorAll('.section').forEach(sec => {
      if (sec.querySelector('#wordOfDay') === null) sec.style.display = 'none';
    });
    saveToRecent(searchTerm);
    loadRecent();
    const hasBack = navigationHistory.length > 1;
    
    // If AI provided explanation, show it with news links
    if (hasAIExplanation && partialNameData.explanation) {
      container.innerHTML = `
        <div class="word-card-modal person-card">
          <div class="word-card-header">
            <div class="word-card-header-top">
              ${hasBack ? `<button class="word-card-back-btn" id="wordCardBackBtn" title="Back">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>` : ''}
              <div class="word-card-word-container">
                <div class="word-card-word-wrapper">
                  <span class="word-card-word">${partialNameData.name || searchTerm}</span>
                </div>
                <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy name">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class="word-card-content person-content">
            <div class="word-card-explanation person-bio">
              ${partialNameData.explanation}
            </div>
            ${partialNameData.newsArticles && partialNameData.newsArticles.length > 0 ? `
            <div class="person-news-section">
              <div class="person-news-title">${translations[window.currentUILanguage || 'en']?.recentNews || 'Recent News'}</div>
              <div class="person-news-list">
                ${partialNameData.newsArticles.slice(0, 5).map((article, index) => `
                  ${article.link ? `
                  <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="person-news-item" data-news-index="${index}" style="text-decoration: none; color: inherit; display: block;">
                    <div class="person-news-title-text">${article.title}</div>
                    ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                  </a>
                  ` : `
                  <div class="person-news-item" data-news-index="${index}">
                    <div class="person-news-title-text">${article.title}</div>
                    ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                  </div>
                  `}
                `).join('')}
              </div>
            </div>
            ` : ''}
          </div>
        </div>
      `;
    } else {
      // AI failed or timed out - show news articles in hub as fallback
      container.innerHTML = `
        <div class="word-card-modal person-card">
          <div class="word-card-header">
            <div class="word-card-header-top">
              ${hasBack ? `<button class="word-card-back-btn" id="wordCardBackBtn" title="Back">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>` : ''}
              <div class="word-card-word-container">
                <div class="word-card-word-wrapper">
                  <span class="word-card-word">${partialNameData.name || searchTerm}</span>
                </div>
                <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy name">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class="word-card-content person-content">
            <div class="word-card-explanation person-bio" style="color: var(--text-muted); font-style: italic;">
              Search results and news articles related to "${partialNameData.name || searchTerm}"
            </div>
            ${partialNameData.newsArticles && partialNameData.newsArticles.length > 0 ? `
            <div class="person-news-section">
              <div class="person-news-title">${translations[window.currentUILanguage || 'en']?.recentNews || 'Recent News'}</div>
              <div class="person-news-list">
                ${partialNameData.newsArticles.map((article, index) => `
                  ${article.link ? `
                  <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="person-news-item" data-news-index="${index}" style="text-decoration: none; color: inherit; display: block;">
                    <div class="person-news-title-text">${article.title}</div>
                    ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                    ${article.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${article.description}</div>` : ''}
                  </a>
                  ` : `
                  <div class="person-news-item" data-news-index="${index}">
                    <div class="person-news-title-text">${article.title}</div>
                    ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                    ${article.description ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${article.description}</div>` : ''}
                  </div>
                  `}
                `).join('')}
              </div>
            </div>
            ` : `
            <div class="person-news-section">
              <div class="person-news-title">${translations[window.currentUILanguage || 'en']?.recentNews || 'Recent News'}</div>
              <div style="padding: 20px; text-align: center; color: var(--text-muted);">
                No recent news articles found for "${partialNameData.name || searchTerm}"
              </div>
            </div>
            `}
          </div>
        </div>
      `;
    }
    
    // Event handlers
    if (hasBack) {
      const backBtn = document.getElementById('wordCardBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          navigationHistory.pop();
          if (navigationHistory.length > 0) {
            const prev = navigationHistory[navigationHistory.length - 1];
            if (prev.type === 'search') {
              performSearch(prev.query);
            } else {
              loadWordOfDay();
            }
          } else {
            loadWordOfDay();
          }
        });
      }
    }
    
    const copyBtn = document.getElementById('wordCardCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(partialNameData.name || searchTerm);
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 300);
        } catch (err) {
        }
      });
    }
    
    if (partialNameData.newsArticles && partialNameData.newsArticles.length > 0) {
      container.querySelectorAll('.person-news-item').forEach((item, index) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const article = partialNameData.newsArticles[index];
          if (article && article.link) window.open(article.link, '_blank', 'noopener,noreferrer');
        });
      });
    }
  }

  function displayPlaceResult(searchTerm, placeData) {
    if (!placeData) {
      showWordDetails(searchTerm);
      return;
    }
    // Get wordOfDayDiv - try multiple times if needed
    let targetDiv = wordOfDayDiv || document.getElementById('wordOfDay');
    if (!targetDiv) {
      // Wait a bit and try again
      setTimeout(() => {
        targetDiv = document.getElementById('wordOfDay');
        if (targetDiv) {
          displayPlaceResult(searchTerm, placeData);
        } else {
        }
      }, 100);
      return;
    }
    currentView = 'place';
    document.body.classList.add('hub-search-mode');
    document.body.classList.add('entity-card-view');
    
    // Hide search bar completely
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
      searchContainer.style.display = 'none';
      searchContainer.style.visibility = 'hidden';
    }
    
    // Hide all sections (favorites, recent, saved, word of day header)
    document.querySelectorAll('.section').forEach(section => {
        section.style.display = 'none';
      section.style.visibility = 'hidden';
    });
    
    // Hide word of day header if it exists
    const wordOfDayHeader = document.getElementById('wordOfDayHeader');
    if (wordOfDayHeader) {
      wordOfDayHeader.style.display = 'none';
    }
    
    // Hide the content wrapper if it exists
    const contentWrapper = document.querySelector('.content');
    if (contentWrapper) {
      contentWrapper.style.display = 'none';
      contentWrapper.style.visibility = 'hidden';
    }
    
    // Ensure wordOfDayDiv is visible and takes full space
    targetDiv.style.display = 'block';
    targetDiv.style.visibility = 'visible';
    targetDiv.style.width = '100%';
    targetDiv.style.margin = '0';
    targetDiv.style.padding = '0';
    
    // Save to recent
    saveToRecent(searchTerm);
    loadRecent();
    
    // Build place card HTML
    const hasBack = navigationHistory.length > 1;
    targetDiv.innerHTML = `
      <div class="word-card-modal person-card">
        <div class="word-card-header">
          <div class="word-card-header-top">
            ${hasBack ? `<button class="word-card-back-btn" id="wordCardBackBtn" title="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>` : ''}
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${placeData.name || searchTerm}</span>
              </div>
              <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy name">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="word-card-content person-content">
          ${placeData.image ? `<div class="person-image-container">
            <img src="${placeData.image}" alt="${placeData.name}" class="person-image" onerror="this.parentElement.style.display='none';">
          </div>` : ''}
          <div class="word-card-explanation person-bio">
            ${placeData.bio || placeData.summary || 'No information available.'}
          </div>
          ${placeData.population || placeData.country || placeData.area || placeData.coordinates || placeData.elevation || placeData.timeZone ? `
          <div class="person-metadata">
            ${placeData.population ? `<div class="person-meta-item"><strong>Population:</strong> ${parseInt(placeData.population).toLocaleString()}</div>` : ''}
            ${placeData.country ? `<div class="person-meta-item"><strong>Country:</strong> ${placeData.country}</div>` : ''}
            ${placeData.area ? `<div class="person-meta-item"><strong>Area:</strong> ${placeData.area}</div>` : ''}
            ${placeData.coordinates ? `<div class="person-meta-item"><strong>Coordinates:</strong> ${placeData.coordinates}</div>` : ''}
            ${placeData.elevation ? `<div class="person-meta-item"><strong>Elevation:</strong> ${placeData.elevation}</div>` : ''}
            ${placeData.timeZone ? `<div class="person-meta-item"><strong>Time Zone:</strong> ${placeData.timeZone}</div>` : ''}
          </div>
          ` : ''}
          ${placeData.newsArticles && placeData.newsArticles.length > 0 ? `
          <div class="person-news-section">
            <div class="person-news-title">${translations[window.currentUILanguage || 'en']?.recentNews || 'Recent News'}</div>
            <div class="person-news-list">
              ${placeData.newsArticles.map((article, index) => `
                ${article.link ? `
                <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="person-news-item" data-news-index="${index}" style="text-decoration: none; color: inherit; display: block;">
                  <div class="person-news-title-text">${article.title}</div>
                  ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                </a>
                ` : `
                <div class="person-news-item" data-news-index="${index}">
                  <div class="person-news-title-text">${article.title}</div>
                  ${article.date ? `<div class="person-news-date">${new Date(article.date).toLocaleDateString()}</div>` : ''}
                </div>
                `}
              `).join('')}
            </div>
          </div>
          ` : ''}
          <div class="entity-sources">${[
            placeData.wikipediaUrl ? `<a href="${placeData.wikipediaUrl}" target="_blank" rel="noopener noreferrer">Wikipedia</a>` : '',
            `<a href="https://news.google.com/search?q=${encodeURIComponent(placeData.name || searchTerm)}" target="_blank" rel="noopener noreferrer">Google News</a>`,
            `<a href="https://www.bbc.co.uk/search?q=${encodeURIComponent(placeData.name || searchTerm)}" target="_blank" rel="noopener noreferrer">BBC</a>`
          ].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
    `;
    
    // Add event listeners (similar to person)
    if (hasBack) {
      const backBtn = document.getElementById('wordCardBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          navigationHistory.pop();
          if (navigationHistory.length > 0) {
            showWordDetails(navigationHistory[navigationHistory.length - 1], false);
          } else {
            returnToHub();
          }
        });
      }
    }
    
    const copyBtn = document.getElementById('wordCardCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(placeData.name || searchTerm);
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 300);
        } catch (err) {
        }
      });
    }
    
    // Add click handlers for news items
    if (placeData.newsArticles && placeData.newsArticles.length > 0) {
      targetDiv.querySelectorAll('.person-news-item').forEach((item, index) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const article = placeData.newsArticles[index];
          if (article && article.link) {
            window.open(article.link, '_blank', 'noopener,noreferrer');
          }
        });
      });
    }
  }


  // Navigation functions
  function returnToHub() {
    navigationHistory = [];
    currentView = 'hub';
    showHubView();
  }

  function showHubView() {
    currentView = 'hub';
    document.body.classList.remove('hub-search-mode');
    document.body.classList.remove('entity-card-view');
    
    // Show search bar again when returning to hub - ensure it's visible
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
      searchContainer.style.display = '';
      searchContainer.style.visibility = 'visible';
    }
    
    // Show content wrapper
    const contentWrapper = document.querySelector('.content');
    if (contentWrapper) {
      contentWrapper.style.display = '';
      contentWrapper.style.visibility = 'visible';
    }
    
    // Show word of day header
    const wordOfDayHeader = document.getElementById('wordOfDayHeader');
    if (wordOfDayHeader) {
      wordOfDayHeader.style.display = '';
    }
    
    // Show all sections
    document.querySelectorAll('.section').forEach(section => {
      section.style.display = 'block';
      section.style.visibility = 'visible';
    });
    
    // Ensure wordOfDay div is visible
    if (wordOfDayDiv) {
      wordOfDayDiv.style.display = 'block';
    }
    
    searchInput.value = '';
    loadFavorites();
    loadRecent();
    loadSaved();
    // Load word of day asynchronously - don't block
    loadWordOfDay().catch(err => {
    });
  }

  async function showWordDetails(word, pushToHistory = true) {
    document.body.classList.remove('entity-card-view');
    // Show loading immediately
    showLoadingPlaceholder(word);
    
    // Check if this is a statement (3+ words) - should always use AI, never show "did you mean"
    const words = word.trim().split(/\s+/).filter(w => w.trim().length > 0);
    const isStatement = words.length >= 3;
    
    // Add to navigation history if not already there
    if (pushToHistory && (navigationHistory.length === 0 || navigationHistory[navigationHistory.length - 1] !== word)) {
      navigationHistory.push(word);
    }

    // Save to recent
    await saveToRecent(word);
    loadRecent();

    // Get explanation
    try {
      // Add timeout to prevent hanging
      const resp = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ error: 'Request timed out. Please try again.' });
        }, 20000);
        
        chrome.runtime.sendMessage({ 
          type: 'explain', 
          word: word, 
          context: '',
          detailed: true
        }, (response) => {
          clearTimeout(timeout);
          
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else if (!response) {
            resolve({ error: 'No response from background script' });
          } else {
            resolve(response);
          }
        });
      });

      // Display the response - FIXED LOGIC
      if (resp && resp.error) {
        // Show error
        wordOfDayDiv.innerHTML = `
          <div class="word-card-modal">
            <div class="word-card-header">
              <div class="word-card-header-top">
                <div class="word-card-word-container">
                  <div class="word-card-word-wrapper">
                    <span class="word-card-word">${word}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="word-card-content">
              <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                <p style="margin-bottom: 12px; font-weight: 600; color: var(--text-primary);">Error: ${resp.error}</p>
                <p style="font-size: 13px; color: var(--text-muted);">Please try again.</p>
              </div>
            </div>
          </div>
        `;
      } else if (resp && resp.explanation) {
        // Has explanation - display it
        const explanationStr = String(resp.explanation).trim();
        
        // For statements (3+ words), ALWAYS display the AI response, even if it says "not found"
        // For single words, check if it's a valid explanation
        if (isStatement || (explanationStr.length > 0 && 
            !explanationStr.includes('not found') && 
            !explanationStr.includes('No definition found'))) {
          // Ensure all required fields exist
          if (!resp.synonyms) resp.synonyms = [];
          if (!resp.examples) resp.examples = [];
          resp.explanation = explanationStr;
          await displayWordDetails(word, resp, true); // true = isNewSearch
        } else {
          // Only show "did you mean" for single words, not statements
          if (!isStatement) {
            const suggestions = await getDidYouMeanSuggestions(word);
            showDidYouMean(word, suggestions);
          } else {
            // For statements, show the explanation even if it's not perfect
            if (!resp.synonyms) resp.synonyms = [];
            if (!resp.examples) resp.examples = [];
            resp.explanation = explanationStr;
            await displayWordDetails(word, resp, true); // true = isNewSearch
          }
        }
      } else {
        // For statements, show a helpful message instead of "did you mean"
        if (isStatement) {
          wordOfDayDiv.innerHTML = `
            <div class="word-card-modal">
              <div class="word-card-header">
                <div class="word-card-header-top">
                  <div class="word-card-word-container">
                    <div class="word-card-word-wrapper">
                      <span class="word-card-word">${word}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="word-card-content">
                <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                  <p style="margin-bottom: 12px; font-weight: 600; color: var(--text-primary);">Processing your statement...</p>
                  <p style="font-size: 13px; color: var(--text-muted);">Please wait while we analyze this.</p>
                </div>
              </div>
            </div>
          `;
        } else {
          wordOfDayDiv.innerHTML = `
            <div class="word-card-modal">
              <div class="word-card-header">
                <div class="word-card-header-top">
                  <div class="word-card-word-container">
                    <div class="word-card-word-wrapper">
                      <span class="word-card-word">${word}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="word-card-content">
                <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                  <p style="margin-bottom: 12px; font-weight: 600; color: var(--text-primary);">No response received</p>
                  <p style="font-size: 13px; color: var(--text-muted);">Please try searching again.</p>
                </div>
              </div>
            </div>
          `;
        }
      }
    } catch (e) {
      // For statements, don't show "did you mean" - show error message instead
      if (isStatement) {
        const errorMsg = e?.message || 'Unknown error occurred';
        wordOfDayDiv.innerHTML = `
          <div class="word-card-modal">
            <div class="word-card-header">
              <div class="word-card-header-top">
                <div class="word-card-word-container">
                  <div class="word-card-word-wrapper">
                    <span class="word-card-word">${word}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="word-card-content">
              <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                <p style="margin-bottom: 12px; font-weight: 600; color: var(--text-primary);">Error processing statement</p>
                <p style="font-size: 13px; color: var(--text-muted);">${errorMsg}</p>
                <p style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">Open popup console (right-click extension icon → Inspect popup) and background console (chrome://extensions → Service worker) for details.</p>
              </div>
            </div>
          </div>
        `;
      } else {
        // Only show "did you mean" for single words
        const suggestions = await getDidYouMeanSuggestions(word);
        showDidYouMean(word, suggestions);
      }
    }
  }

  async function displayWordDetails(word, data, isNewSearch = false) {
    currentView = 'word';
    // Add hub-search-mode class when showing search results (after highlighting)
    document.body.classList.add('hub-search-mode');
    
    // Hide search bar for 3+ word statements (AI chat) only - keep logo visible
    const isStatement = word.trim().split(/\s+/).length >= 3;
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
      if (isStatement) {
        searchContainer.style.display = 'none';
      } else {
        // Ensure search bar is visible for single words
        searchContainer.style.display = '';
        searchContainer.style.visibility = 'visible';
      }
    }
    
    // Hide other sections
    document.querySelectorAll('.section').forEach(section => {
      if (section.querySelector('#wordOfDay') === null) {
        section.style.display = 'none';
      }
    });
    
    // Get favorites to check if word is favorited
    const favorites = await getStorage('favorites') || [];
    const isFavorited = favorites.includes(word);
    
    // Get settings
    const settings = await new Promise(resolve => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {});
      });
    });
    const showPhonetic = settings.showPhonetic !== false;
    const showExamples = settings.showExamples !== false;
    
    // Extract synonyms
    let synonyms = [];
    if (data.synonyms !== undefined && data.synonyms !== null) {
      if (Array.isArray(data.synonyms)) {
        synonyms = data.synonyms.filter(s => s && typeof s === 'string' && s.trim());
      } else if (typeof data.synonyms === 'string') {
        synonyms = [data.synonyms.trim()].filter(s => s);
      }
    }
    
    // Build HTML matching modal layout exactly
    const hasBack = navigationHistory.length > 1;
    // isStatement already declared above at line 3642
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal ${isStatement ? 'statement-chat' : ''}">
        <div class="word-card-header">
          <div class="word-card-header-top">
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word ${isStatement ? 'statement-text' : ''}">${word}</span>
                ${showPhonetic && data.pronunciation ? `<span class="word-card-phonetic">${data.pronunciation}</span>` : ''}
              </div>
              <button class="word-card-copy-btn" id="wordCardCopyBtn" title="Copy word">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
          ${hasBack ? `<button class="back-btn" id="wordCardBackBtn">← Back</button>` : ''}
        </div>
        ${word.trim().split(/\s+/).length >= 3 ? `
          <!-- Chat Interface for AI Responses - full-height, fixed input at bottom -->
          <div class="ai-chat-container" id="aiChatContainer" style="margin-top: 0; padding: 0; width: 100%;">
            <div class="ai-chat-messages" id="aiChatMessages" style="padding: 16px; display: flex; flex-direction: column; gap: 16px;">
              <!-- User message: The highlighted sentence -->
              <div class="ai-message ai-user" style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">You</div>
                <div style="padding: 12px 16px; background: var(--accent-blue); color: white; border-radius: 12px; max-width: 80%; line-height: 1.5; font-size: 13px; white-space: pre-wrap; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${word}</div>
              </div>
              <!-- AI response -->
              <div class="ai-message ai-assistant" style="display: flex; flex-direction: column; gap: 4px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                <div style="padding: 12px 16px; background: var(--card-bg); color: var(--text-primary); border-radius: 12px; line-height: 1.5; font-size: 13px; word-wrap: break-word; overflow-wrap: break-word; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${formatMessage(data.explanation || 'No explanation available.')}</div>
              </div>
            </div>
        ` : `
          <!-- Regular word display for single words -->
          <div class="word-card-explanation">${data.explanation || 'No explanation available.'}</div>
          ${showExamples && data.examples && data.examples.length > 0 ? `
            <div class="word-card-examples-container">
              <div class="word-card-examples-label">${translations[window.currentUILanguage || 'en']?.examplesLabel || 'Examples'}</div>
              <div class="word-card-examples-list">
                ${data.examples.map(ex => `<div class="word-card-example-item">${ex}</div>`).join('')}
              </div>
            </div>
          ` : ''}
          ${synonyms.length > 0 ? `
            <div class="word-card-synonyms-container">
              <div class="word-card-synonyms-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                </svg>
                ${translations[window.currentUILanguage || 'en']?.synonymsLabel || 'Synonyms'}
              </div>
              <div class="word-card-synonyms-scroll">
                ${synonyms.map(s => `<span class="word-card-synonym-tag" data-synonym="${s}">${s}</span>`).join('')}
              </div>
            </div>
          ` : ''}
        `}
        ${word.trim().split(/\s+/).length >= 3 ? `
            <div class="ai-chat-input-container" style="display: flex; gap: 8px; align-items: center; padding: 16px; flex-shrink: 0;">
              <input type="text" id="aiChatInput" placeholder="Ask a follow-up question..." style="flex: 1; padding: 12px 16px; border: 2px solid var(--border-color); border-radius: 12px; background: var(--card-bg); color: var(--text-primary); font-size: 13px; outline: none; box-shadow: var(--card-shadow-inner), var(--card-shadow);" />
              <button id="aiChatSendBtn" style="padding: 12px 16px; background: var(--accent-blue); color: white; border: none; border-radius: 12px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s ease; box-shadow: var(--card-shadow-inner), var(--card-shadow);">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
          </div>
        ` : ''}
        ${word.trim().split(/\s+/).length < 3 ? `
        <div class="word-card-actions">
          <button class="word-card-fav-btn-icon ${isFavorited ? 'favorited' : ''}" id="wordCardFavBtn" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          <button class="word-card-search-btn-icon" id="wordCardSearchBtn" title="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </button>
        </div>
        ` : ''}
      </div>
    `;
    
    // Event handlers
    if (hasBack) {
      const backBtn = document.getElementById('wordCardBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          navigationHistory.pop(); // Remove current
          const previousWord = navigationHistory[navigationHistory.length - 1];
          if (previousWord) {
            showWordDetails(previousWord, false); // Don't push to history
          } else {
            returnToHub();
          }
        });
      }
    }
    
    const copyBtn = document.getElementById('wordCardCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(word);
        copyBtn.classList.add('copied');
        setTimeout(() => copyBtn.classList.remove('copied'), 2000);
        } catch (e) {
        }
      });
    }
    
    // Add hover effects for links (if they exist - for 3+ word statements)
    document.querySelectorAll('.word-card-link').forEach(link => {
      link.addEventListener('mouseenter', function() {
        this.style.background = 'rgba(241, 245, 249, 0.8)';
        this.style.transform = 'translateX(4px)';
      });
      link.addEventListener('mouseleave', function() {
        this.style.background = 'rgba(241, 245, 249, 0.5)';
        this.style.transform = 'translateX(0)';
      });
    });
    
    const favBtn = document.getElementById('wordCardFavBtn');
    if (favBtn) {
      favBtn.addEventListener('click', async () => {
        const favorites = await getStorage('favorites') || [];
        const index = favorites.indexOf(word);
        if (index > -1) {
          favorites.splice(index, 1);
        } else {
          favorites.push(word);
        }
        await setStorage({ favorites });
        const isNowFavorited = favorites.includes(word);
        favBtn.classList.toggle('favorited', isNowFavorited);
        const svg = favBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', isNowFavorited ? 'currentColor' : 'none');
        loadFavorites();
      });
    }
    
    const searchBtn = document.getElementById('wordCardSearchBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(word)}`, '_blank');
      });
    }
    
    // Chat functionality for AI responses (3+ words)
    if (word.trim().split(/\s+/).length >= 3) {
      const chatInput = document.getElementById('aiChatInput');
      const chatSendBtn = document.getElementById('aiChatSendBtn');
      const chatMessages = document.getElementById('aiChatMessages');
      
      // Initialize conversation - always start fresh for new searches
      let conversationId = null;
      let conversationHistory = [
        { role: 'user', content: word },
        { role: 'assistant', content: data.explanation || 'No explanation available.' }
      ];
      
      // Only load existing conversation if NOT a new search (e.g., clicking from conversations list)
      if (!isNewSearch) {
        chrome.storage.local.get(['conversations'], (result) => {
          const conversations = result.conversations || {};
          const queryTitle = word.substring(0, 50);
          
          // Find existing conversation with matching title
          for (const [id, conv] of Object.entries(conversations)) {
            if (conv.title === queryTitle) {
              conversationId = id;
              conversationHistory = conv.messages || conversationHistory;
              break;
            }
          }
          
          // If found existing conversation, render its messages
          if (conversationId && conversations[conversationId] && conversations[conversationId].messages) {
            conversationHistory = conversations[conversationId].messages;
            chatMessages.innerHTML = conversationHistory.map(msg => {
              if (msg.role === 'user') {
                return `
                  <div class="ai-message ai-user" style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">You</div>
                    <div style="padding: 12px 16px; background: var(--accent-blue); color: white; border-radius: 12px; max-width: 80%; line-height: 1.5; font-size: 13px; white-space: pre-wrap; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${msg.content}</div>
                  </div>
                `;
              } else if (msg.role === 'assistant') {
                return `
                  <div class="ai-message ai-assistant" style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                    <div style="padding: 12px 16px; background: var(--card-bg); color: var(--text-primary); border-radius: 12px; line-height: 1.5; font-size: 13px; white-space: pre-wrap; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${msg.content}</div>
                  </div>
                `;
              }
              return '';
            }).join('');
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
          
          // Store conversation ID on the input
          if (chatInput) {
            chatInput.dataset.conversationId = conversationId || `conv_${Date.now()}_${word.substring(0, 20).replace(/\s+/g, '_')}`;
            chatInput.dataset.originalQuery = word;
          }
        });
      } else {
        // For new searches, always create a fresh conversation ID
        conversationId = `conv_${Date.now()}_${word.substring(0, 20).replace(/\s+/g, '_')}`;
        if (chatInput) {
          chatInput.dataset.conversationId = conversationId;
          chatInput.dataset.originalQuery = word;
        }
        // Render initial messages (user query + AI response)
        chatMessages.innerHTML = `
          <div class="ai-message ai-user" style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">You</div>
            <div style="padding: 12px 16px; background: var(--accent-blue); color: white; border-radius: 12px; max-width: 80%; line-height: 1.5; font-size: 13px; white-space: pre-wrap; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${word}</div>
          </div>
          <div class="ai-message ai-assistant" style="display: flex; flex-direction: column; gap: 4px;">
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
            <div style="padding: 12px 16px; background: var(--card-bg); color: var(--text-primary); border-radius: 12px; line-height: 1.5; font-size: 13px; white-space: pre-wrap; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${data.explanation || 'No explanation available.'}</div>
          </div>
        `;
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Save conversation AFTER first AI response (only for new searches)
        chrome.storage.local.get(['conversations'], (result) => {
          const conversations = result.conversations || {};
          conversations[conversationId] = {
            title: word.substring(0, 50),
            messages: conversationHistory,
            timestamp: Date.now(),
            lastUpdated: Date.now()
          };
          chrome.storage.local.set({ conversations }, () => {
            loadConversations(); // Refresh conversations list
          });
        });
      }
      
      const sendMessage = async () => {
        const message = chatInput.value.trim();
        if (!message) return;
        
        // Add user message to UI
        const userMsgDiv = document.createElement('div');
        userMsgDiv.className = 'ai-message ai-user';
          userMsgDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px; align-items: flex-end;';
          userMsgDiv.innerHTML = `
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">You</div>
            <div style="padding: 12px 16px; background: var(--accent-blue); color: white; border-radius: 12px; max-width: 80%; line-height: 1.5; font-size: 13px; white-space: pre-wrap; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${message}</div>
          `;
        chatMessages.appendChild(userMsgDiv);
        conversationHistory.push({ role: 'user', content: message });
        
        // Add loading message
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'ai-message ai-assistant';
          loadingDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
          loadingDiv.innerHTML = `
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
            <div style="padding: 12px 16px; background: var(--card-bg); border-radius: 12px; color: var(--text-primary); line-height: 1.5; font-size: 13px; box-shadow: var(--card-shadow-inner), var(--card-shadow);">Thinking...</div>
          `;
        chatMessages.appendChild(loadingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        chatInput.value = '';
        chatInput.disabled = true;
        chatSendBtn.disabled = true;
        
        try {
          // Check if request is allowed
          const canRequest = await canMakeRequest(message);
          if (!canRequest.allowed) {
            loadingDiv.remove();
            const errorDiv = document.createElement('div');
            errorDiv.className = 'ai-message ai-assistant';
            errorDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
            errorDiv.innerHTML = `
              <div style="font-size: 11px; color: var(--text-muted, #94a3b8); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
              <div style="padding: 10px 14px; background: #fef3c7; border-radius: 12px; border: 1px solid #fbbf24; color: #92400e; line-height: 1.5; font-size: 13px;">${canRequest.reason}</div>
            `;
            chatMessages.appendChild(errorDiv);
            chatInput.disabled = false;
            chatSendBtn.disabled = false;
            chatInput.focus();
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return;
          }
          
          // Handle document requests
          if (isDocumentRequest(message)) {
            loadingDiv.remove();
            const infoDiv = document.createElement('div');
            infoDiv.className = 'ai-message ai-assistant';
            infoDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
            infoDiv.innerHTML = `
              <div style="font-size: 11px; color: var(--text-muted, #94a3b8); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
              <div style="padding: 10px 14px; background: #dbeafe; border-radius: 12px; border: 1px solid #60a5fa; color: #05007f; line-height: 1.5; font-size: 13px;">I can help explain concepts and provide information, but I cannot create Word documents or PDFs. You can copy any text I provide and paste it into your document editor.</div>
            `;
            chatMessages.appendChild(infoDiv);
            chatInput.disabled = false;
            chatSendBtn.disabled = false;
            chatInput.focus();
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return;
          }
          
          // Increment usage for code requests
          if (isCodeRequest(message)) {
            await incrementUsage(message);
          }
          
          // Send to background script with conversation context
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: 'chat',
              message: message,
              conversationHistory: conversationHistory.slice(0, -1), // Exclude the current user message
              originalQuery: word
            }, (resp) => {
              if (chrome.runtime.lastError) {
                resolve({ error: chrome.runtime.lastError.message });
              } else {
                resolve(resp);
              }
            });
          });
          
          // Remove loading message
          loadingDiv.remove();
          
          if (response && response.explanation && !response.error) {
            // Add AI response
            const aiMsgDiv = document.createElement('div');
            aiMsgDiv.className = 'ai-message ai-assistant';
              aiMsgDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
              aiMsgDiv.innerHTML = `
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                <div style="padding: 12px 16px; background: var(--card-bg); border-radius: 12px; color: var(--text-primary); line-height: 1.5; font-size: 13px; word-wrap: break-word; overflow-wrap: break-word; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${formatMessage(response.explanation)}</div>
              `;
              
              // Add copy button handlers for code blocks
              setTimeout(() => {
                aiMsgDiv.querySelectorAll('.copy-code-btn').forEach(btn => {
                  btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const codeBlock = btn.closest('.code-block-container');
                    const code = codeBlock.querySelector('code').textContent;
                    navigator.clipboard.writeText(code).then(() => {
                      btn.textContent = 'Copied!';
                      setTimeout(() => {
                        btn.textContent = 'Copy';
                      }, 2000);
                    }).catch(err => {
                    });
                  });
                });
              }, 0);
            chatMessages.appendChild(aiMsgDiv);
            conversationHistory.push({ role: 'assistant', content: response.explanation });
            
            // Save conversation
            const currentConvId = chatInput?.dataset?.conversationId || conversationId;
            chrome.storage.local.get(['conversations'], (result) => {
              const conversations = result.conversations || {};
              const existingConv = conversations[currentConvId];
              conversations[currentConvId] = {
                title: word.substring(0, 50),
                messages: conversationHistory,
                timestamp: existingConv?.timestamp || Date.now(),
                lastUpdated: Date.now()
              };
              chrome.storage.local.set({ conversations });
              loadConversations(); // Refresh conversations list
            });
          } else {
            // Show error
            const errorDiv = document.createElement('div');
            errorDiv.className = 'ai-message ai-assistant';
            errorDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
            errorDiv.innerHTML = `
              <div style="font-size: 11px; color: var(--text-muted, #94a3b8); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
              <div style="padding: 10px 14px; background: #fee2e2; border-radius: 12px; border: 1px solid #fca5a5; color: #991b1b; line-height: 1.5; font-size: 13px;">Sorry, I couldn't process that. Please try again.</div>
            `;
            chatMessages.appendChild(errorDiv);
          }
        } catch (err) {
          loadingDiv.remove();
          const errorDiv = document.createElement('div');
          errorDiv.className = 'ai-message ai-assistant';
          errorDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
          errorDiv.innerHTML = `
            <div style="font-size: 11px; color: var(--text-muted, #94a3b8); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
            <div style="padding: 10px 14px; background: #fee2e2; border-radius: 12px; border: 1px solid #fca5a5; color: #991b1b; line-height: 1.5; font-size: 13px;">Error: ${err.message}</div>
          `;
          chatMessages.appendChild(errorDiv);
        }
        
        chatInput.disabled = false;
        chatSendBtn.disabled = false;
        chatInput.focus();
        chatMessages.scrollTop = chatMessages.scrollHeight;
      };
      
      chatSendBtn.addEventListener('click', sendMessage);
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    
    // Make synonyms clickable
    wordOfDayDiv.querySelectorAll('.word-card-synonym-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        showWordDetails(tag.dataset.synonym);
      });
    });
  }

  async function getDidYouMeanSuggestions(word) {
    const wordLower = word.toLowerCase();
    const suggestions = [];
    
    // Get all words from favorites and recent
    const [favorites, recent] = await Promise.all([
      getStorage('favorites'),
      getStorage('recentSearches')
    ]);
    
    const allWords = [...(favorites || []), ...(recent || [])];
    
    // Simple Levenshtein-like matching (find words with similar length and characters)
    for (const candidate of allWords) {
      if (!candidate || typeof candidate !== 'string') continue;
      const candidateLower = candidate.toLowerCase();
      if (candidateLower === wordLower) continue;
      
      // Check if similar (same length ± 2, shares 70%+ characters)
      if (Math.abs(candidateLower.length - wordLower.length) <= 2) {
        let matches = 0;
        const minLen = Math.min(candidateLower.length, wordLower.length);
        for (let i = 0; i < minLen; i++) {
          if (candidateLower[i] === wordLower[i]) matches++;
        }
        if (matches / minLen >= 0.6) {
          suggestions.push(candidate);
        }
      }
    }
    
    // Also check common words
    const commonWords = await getWordSuggestions(wordLower.substring(0, Math.min(3, wordLower.length)));
    suggestions.push(...commonWords.filter(w => w.toLowerCase() !== wordLower));
    
    // Remove duplicates and limit to 5
    const unique = [...new Set(suggestions)];
    return unique.slice(0, 5);
  }

  function showDidYouMean(word, suggestions) {
    const hasBack = navigationHistory.length > 1;
    
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal">
        <div class="word-card-header">
          <div class="word-card-header-top">
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word" style="color: #dc2626;">${word}</span>
              </div>
            </div>
          </div>
          ${hasBack ? `<button class="back-btn" id="didYouMeanBackBtn">← Back</button>` : ''}
        </div>
        <div class="word-card-explanation" style="text-align: center; padding: 40px 20px;">
          <div style="font-size: 18px; font-weight: 600; color: #64748b; margin-bottom: 12px;">
            Word not found
          </div>
          <div style="font-size: 14px; color: #94a3b8; margin-bottom: 24px;">
            Did you mean one of these?
          </div>
          ${suggestions.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${suggestions.map(s => `
                <button class="suggestion-item" style="text-align: left; cursor: pointer; padding: 12px 16px; background: white; border: 1px solid #e2e8f0; border-radius: 8px; transition: all 0.2s;" data-word="${s}">
                  <span style="font-weight: 600; color: #05007f;">${s}</span>
                </button>
              `).join('')}
            </div>
          ` : `
            <div style="font-size: 13px; color: #94a3b8;">
              No suggestions found. Try searching for a different word.
            </div>
          `}
        </div>
      </div>
    `;
    
    // Back button
    if (hasBack) {
      document.getElementById('didYouMeanBackBtn').addEventListener('click', () => {
        navigationHistory.pop();
        const previousWord = navigationHistory[navigationHistory.length - 1];
        if (previousWord) {
          showWordDetails(previousWord, false);
        } else {
          returnToHub();
        }
      });
    }
    
    // Suggestion clicks
    wordOfDayDiv.querySelectorAll('[data-word]').forEach(btn => {
      btn.addEventListener('click', () => {
        showWordDetails(btn.dataset.word);
      });
    });
  }
  
  function getPronunciation(word) {
    // Simple pronunciation guide
    return `/${word}/`;
  }

  async function loadConversations() {
    try {
      const conversationsDiv = document.getElementById('conversations');
      if (!conversationsDiv) return;
      
      const conversations = await getStorage('conversations') || {};
      const conversationEntries = Object.entries(conversations);
      
      if (conversationEntries.length === 0) {
        const lang = window.currentUILanguage || 'en';
        const t = translations[lang] || translations.en;
        conversationsDiv.innerHTML = `<div class="empty-state">${t.noConversations || 'No conversations yet'}</div>`;
        return;
      }
      
      // Sort by lastUpdated (most recent first)
      conversationEntries.sort((a, b) => (b[1].lastUpdated || b[1].timestamp || 0) - (a[1].lastUpdated || a[1].timestamp || 0));
      
      // Build table view similar to recent searches
      const lang = window.currentUILanguage || 'en';
      const t = translations[lang] || translations.en;
      
      conversationsDiv.innerHTML = `
        <div class="recent-table-container">
          <div class="recent-table">
            ${conversationEntries.map(([id, conv]) => {
              const title = conv.title || 'Untitled Conversation';
              const timestamp = conv.lastUpdated || conv.timestamp || Date.now();
              const timeAgo = getTimeAgo(timestamp);
              const messageCount = conv.messages ? conv.messages.length : 0;
              
              return `
                <div class="recent-table-row conversation-row" data-conversation-id="${id}">
                  <div class="recent-table-word" style="flex: 1; cursor: pointer;">
                    <div style="font-weight: 700; color: var(--text-primary); font-size: 15px; margin-bottom: 4px;">${title}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">${messageCount} message${messageCount !== 1 ? 's' : ''}</div>
                  </div>
                  <div class="recent-table-time" style="min-width: 80px; text-align: right; color: var(--text-muted); font-size: 12px;">${timeAgo}</div>
                  <button class="recent-remove-btn conversation-delete-btn" data-conversation-id="${id}" title="Delete conversation" style="margin-left: 8px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
      
      // Add click handlers for conversation rows - make entire row clickable
      conversationsDiv.querySelectorAll('.conversation-row').forEach(row => {
        const conversationId = row.dataset.conversationId;
        
        // Make entire row clickable (except delete button)
        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
          // Don't trigger if clicking the delete button
          if (e.target.closest('.conversation-delete-btn')) {
            return;
          }
          
          // Load the conversation - find the original query from the conversation
          const conv = conversations[conversationId];
          if (conv && conv.messages && conv.messages.length > 0) {
            // Get the original query from the first user message or title
            const firstUserMsg = conv.messages.find(m => m.role === 'user');
            const originalQuery = firstUserMsg?.content || conv.title || 'Unknown';
            
            
            // Get the first AI response to use as the explanation for displayWordDetails
            const firstAssistantMsg = conv.messages.find(m => m.role === 'assistant');
            const explanation = firstAssistantMsg?.content || 'No explanation available.';
            
            // Create a data object similar to what showWordDetails would receive
            const conversationData = {
              explanation: explanation,
              synonyms: [],
              examples: [],
              newsArticles: conv.newsArticles || []
            };
            
            // Use displayWordDetails directly to skip API call and show conversation immediately
            displayWordDetails(originalQuery, conversationData, false).then(async () => {
              // After the word details are shown, restore the conversation
              // Wait a bit longer to ensure chat UI is fully rendered
              await new Promise(resolve => setTimeout(resolve, 400));
              
              const chatMessages = document.getElementById('aiChatMessages');
              const chatInput = document.getElementById('aiChatInput');
              const chatSendBtn = document.getElementById('aiChatSendBtn');
              
              
              if (chatMessages && conv.messages) {
                // Re-render all messages
                chatMessages.innerHTML = conv.messages.map(msg => {
                    if (msg.role === 'assistant') {
                      return `
                        <div class="ai-message ai-assistant" style="display: flex; flex-direction: column; gap: 4px;">
                          <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                          <div style="padding: 12px 16px; background: var(--card-bg); border-radius: 12px; color: var(--text-primary); line-height: 1.5; font-size: 13px; word-wrap: break-word; overflow-wrap: break-word; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${formatMessage(msg.content)}</div>
                        </div>
                      `;
                    } else {
                      return `
                        <div class="ai-message ai-user" style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
                          <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">You</div>
                          <div style="padding: 12px 16px; background: var(--accent-blue); color: white; border-radius: 12px; max-width: 80%; line-height: 1.5; font-size: 13px; white-space: pre-wrap; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${msg.content}</div>
                        </div>
                      `;
                    }
                  }).join('');
                  chatMessages.scrollTop = chatMessages.scrollHeight;
                  
                  // Add copy button handlers for code blocks in loaded messages
                  setTimeout(() => {
                    chatMessages.querySelectorAll('.copy-code-btn').forEach(btn => {
                      btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const codeBlock = btn.closest('.code-block-container');
                        const code = codeBlock.querySelector('code').textContent;
                        navigator.clipboard.writeText(code).then(() => {
                          btn.textContent = 'Copied!';
                          setTimeout(() => {
                            btn.textContent = 'Copy';
                          }, 2000);
                        }).catch(err => {
                        });
                      });
                    });
                  }, 0);
                  
                  // Store conversation ID and history for continuing the conversation
                  if (chatInput) {
                    chatInput.dataset.conversationId = conversationId;
                    chatInput.dataset.originalQuery = originalQuery;
                    
                    // Set up sendMessage handler if not already set
                    if (chatSendBtn && !chatSendBtn.dataset.handlerAttached) {
                      chatSendBtn.dataset.handlerAttached = 'true';
                      
                      const sendMessage = async () => {
                        const message = chatInput.value.trim();
                        if (!message) return;
                        
                        // Add user message to UI
                        const userMsgDiv = document.createElement('div');
                        userMsgDiv.className = 'ai-message ai-user';
                        userMsgDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px; align-items: flex-end;';
                        userMsgDiv.innerHTML = `
                          <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">You</div>
                          <div style="padding: 12px 16px; background: var(--accent-blue); color: white; border-radius: 12px; max-width: 80%; line-height: 1.5; font-size: 13px; white-space: pre-wrap; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${message}</div>
                        `;
                        chatMessages.appendChild(userMsgDiv);
                        
                        // Get current conversation history
                        const currentConvId = chatInput.dataset.conversationId;
                        chrome.storage.local.get(['conversations'], async (result) => {
                          const conversations = result.conversations || {};
                          const currentConv = conversations[currentConvId] || conv;
                          const conversationHistory = currentConv.messages || [];
                          conversationHistory.push({ role: 'user', content: message });
                          
                          // Add loading message
                          const loadingDiv = document.createElement('div');
                          loadingDiv.className = 'ai-message ai-assistant';
                          loadingDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
                          loadingDiv.innerHTML = `
                            <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                            <div style="padding: 12px 16px; background: var(--card-bg); border-radius: 12px; color: var(--text-primary); line-height: 1.5; font-size: 13px; box-shadow: var(--card-shadow-inner), var(--card-shadow);">Thinking...</div>
                          `;
                          chatMessages.appendChild(loadingDiv);
                          chatMessages.scrollTop = chatMessages.scrollHeight;
                          
                          chatInput.value = '';
                          chatInput.disabled = true;
                          chatSendBtn.disabled = true;
                          
                          try {
                            // Check if request is allowed
                            const canRequest = await canMakeRequest(message);
                            if (!canRequest.allowed) {
                              loadingDiv.remove();
                              const errorDiv = document.createElement('div');
                              errorDiv.className = 'ai-message ai-assistant';
                              errorDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
                              errorDiv.innerHTML = `
                                <div style="font-size: 11px; color: var(--text-muted, #94a3b8); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                                <div style="padding: 10px 14px; background: #fef3c7; border-radius: 12px; border: 1px solid #fbbf24; color: #92400e; line-height: 1.5; font-size: 13px;">${canRequest.reason}</div>
                              `;
                              chatMessages.appendChild(errorDiv);
                              chatInput.disabled = false;
                              chatSendBtn.disabled = false;
                              chatInput.focus();
                              chatMessages.scrollTop = chatMessages.scrollHeight;
                              return;
                            }
                            
                            // Handle document requests
                            if (isDocumentRequest(message)) {
                              loadingDiv.remove();
                              const infoDiv = document.createElement('div');
                              infoDiv.className = 'ai-message ai-assistant';
                              infoDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
                              infoDiv.innerHTML = `
                                <div style="font-size: 11px; color: var(--text-muted, #94a3b8); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                                <div style="padding: 10px 14px; background: #dbeafe; border-radius: 12px; border: 1px solid #60a5fa; color: #05007f; line-height: 1.5; font-size: 13px;">I can help explain concepts and provide information, but I cannot create Word documents or PDFs. You can copy any text I provide and paste it into your document editor.</div>
                              `;
                              chatMessages.appendChild(infoDiv);
                              chatInput.disabled = false;
                              chatSendBtn.disabled = false;
                              chatInput.focus();
                              chatMessages.scrollTop = chatMessages.scrollHeight;
                              return;
                            }
                            
                            // Increment usage for code requests
                            if (isCodeRequest(message)) {
                              await incrementUsage(message);
                            }
                            
                            // Send to background script with conversation context
                            const response = await new Promise((resolve) => {
                              chrome.runtime.sendMessage({
                                type: 'chat',
                                message: message,
                                conversationHistory: conversationHistory.slice(0, -1),
                                originalQuery: chatInput.dataset.originalQuery || originalQuery
                              }, (resp) => {
                                if (chrome.runtime.lastError) {
                                  resolve({ error: chrome.runtime.lastError.message });
                                } else {
                                  resolve(resp);
                                }
                              });
                            });
                            
                            // Remove loading message
                            loadingDiv.remove();
                            
                            if (response && response.explanation && !response.error) {
                              // Add AI response
                              const aiMsgDiv = document.createElement('div');
                              aiMsgDiv.className = 'ai-message ai-assistant';
                              aiMsgDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
                              aiMsgDiv.innerHTML = `
                                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                                <div style="padding: 12px 16px; background: var(--card-bg); border-radius: 12px; color: var(--text-primary); line-height: 1.5; font-size: 13px; word-wrap: break-word; overflow-wrap: break-word; box-shadow: var(--card-shadow-inner), var(--card-shadow);">${formatMessage(response.explanation)}</div>
                              `;
                              chatMessages.appendChild(aiMsgDiv);
                              
                              // Add copy button handlers for code blocks
                              setTimeout(() => {
                                aiMsgDiv.querySelectorAll('.copy-code-btn').forEach(btn => {
                                  btn.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    const codeBlock = btn.closest('.code-block-container');
                                    const code = codeBlock.querySelector('code').textContent;
                                    navigator.clipboard.writeText(code).then(() => {
                                      btn.textContent = 'Copied!';
                                      setTimeout(() => {
                                        btn.textContent = 'Copy';
                                      }, 2000);
                                    }).catch(err => {
                                    });
                                  });
                                });
                              }, 0);
                              
                              conversationHistory.push({ role: 'assistant', content: response.explanation });
                              
                              // Save updated conversation
                              conversations[currentConvId] = {
                                title: currentConv.title || originalQuery.substring(0, 50),
                                messages: conversationHistory,
                                timestamp: currentConv.timestamp || Date.now(),
                                lastUpdated: Date.now()
                              };
                              chrome.storage.local.set({ conversations });
                              loadConversations();
                            } else {
                              // Show error
                              const errorDiv = document.createElement('div');
                              errorDiv.className = 'ai-message ai-assistant';
                              errorDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
                              errorDiv.innerHTML = `
                                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                                <div style="padding: 10px 14px; background: #fee2e2; border-radius: 12px; border: 1px solid #fca5a5; color: #991b1b; line-height: 1.5; font-size: 13px;">Sorry, I couldn't process that. Please try again.</div>
                              `;
                              chatMessages.appendChild(errorDiv);
                            }
                          } catch (err) {
                            loadingDiv.remove();
                            const errorDiv = document.createElement('div');
                            errorDiv.className = 'ai-message ai-assistant';
                            errorDiv.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
                            errorDiv.innerHTML = `
                              <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px;">AI Assistant</div>
                              <div style="padding: 10px 14px; background: #fee2e2; border-radius: 12px; border: 1px solid #fca5a5; color: #991b1b; line-height: 1.5; font-size: 13px;">Error: ${err.message}</div>
                            `;
                            chatMessages.appendChild(errorDiv);
                          }
                          
                          chatInput.disabled = false;
                          chatSendBtn.disabled = false;
                          chatInput.focus();
                        });
                      };
                      
                      // Attach handlers
                      chatSendBtn.addEventListener('click', sendMessage);
                      chatInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      });
                    } else {
                      // Handler already attached, just update the conversation ID
                    }
                  } else {
                  }
              }
            }).catch(err => {
            });
          }
        });
      });
      
      // Add delete handler using event delegation - more reliable
      // Remove old handler if exists
      if (conversationsDiv._deleteHandler) {
        conversationsDiv.removeEventListener('click', conversationsDiv._deleteHandler, true);
      }
      
      conversationsDiv._deleteHandler = (e) => {
        // Check if click is on delete button or its SVG child
        const deleteBtn = e.target.closest('.conversation-delete-btn');
        if (!deleteBtn) return;
        
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const conversationId = deleteBtn.dataset.conversationId;
        if (!conversationId) {
          return;
        }
        
        // Delete immediately without confirmation
        chrome.storage.local.get(['conversations'], (data) => {
          if (chrome.runtime.lastError) {
            return;
          }
          
          const conversations = data.conversations || {};
          
          if (!conversations[conversationId]) {
            return;
          }
          
          // Delete the conversation
          delete conversations[conversationId];
          
          // Save back to storage
          chrome.storage.local.set({ conversations }, () => {
            if (chrome.runtime.lastError) {
              return;
            }
            
            // Immediately refresh the UI after successful save
            loadConversations();
          });
        });
      };
      
      // Attach handler with capture phase to fire before row click handler
      conversationsDiv.addEventListener('click', conversationsDiv._deleteHandler, true);
    } catch (e) {
      const conversationsDiv = document.getElementById('conversations');
      if (conversationsDiv) {
        conversationsDiv.innerHTML = '<div class="empty-state">Error loading conversations</div>';
      }
    }
  }

  async function loadFavorites() {
    try {
      if (!favoritesDiv) {
        return;
      }
      const favorites = await getStorage('favorites') || [];
      
      if (favorites.length === 0) {
        const lang = window.currentUILanguage || 'en';
        const t = translations[lang] || translations.en;
        favoritesDiv.innerHTML = `<div class="empty-state">${t.noFavorites}</div>`;
        return;
      }

      favoritesDiv.innerHTML = favorites.map(word => {
        const t = translations[window.currentUILanguage || 'en'] || translations.en;
        return `
        <div class="word-item" data-word="${word}">
          <span class="word">${word}</span>
          <button class="remove-btn" data-word="${word}" title="${t.removeFromFavorites || 'Remove'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
      `; }).join('');

      // Add click handlers - entire card is clickable
      favoritesDiv.querySelectorAll('.word-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.remove-btn')) return;
            showWordDetails(el.dataset.word);
        });
      });

      favoritesDiv.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await removeFavorite(btn.dataset.word);
          loadFavorites();
        });
      });
    } catch (e) {
      favoritesDiv.innerHTML = '<div class="empty-state">Error loading favorites</div>';
    }
  }

  let recentExpanded = false;
  let allRecentSearches = [];

  async function loadRecent() {
    try {
      if (!recentDiv) {
        return;
      }
      let recent = await getStorage('recentSearches') || [];
      
      // Migrate old format (strings) to new format (objects with timestamp)
      if (recent.length > 0 && typeof recent[0] === 'string') {
        recent = recent.map(w => ({ word: w, timestamp: Date.now() }));
        await setStorage({ recentSearches: recent });
      }
      
      // Auto-cleanup: Remove entries older than 14 days
      const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
      const cleaned = recent.filter(item => {
        const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
        return timestamp > fourteenDaysAgo;
      });
      
      // Save cleaned list if any items were removed
      if (cleaned.length !== recent.length) {
        await setStorage({ recentSearches: cleaned });
        recent = cleaned;
      }
      
      allRecentSearches = recent;
      
      if (recent.length === 0) {
        const lang = window.currentUILanguage || 'en';
        const t = translations[lang] || translations.en;
        recentDiv.innerHTML = `<div class="empty-state">${t.noRecentSearches}</div>`;
        return;
      }

      renderRecentSearches();
    } catch (e) {
      recentDiv.innerHTML = '<div class="empty-state">Error loading recent searches</div>';
    }
  }

  function renderRecentSearches() {
    const lang = window.currentUILanguage || 'en';
    const t = translations[lang] || translations.en;
    
    if (recentExpanded) {
      // Show table view with all searches
      const tableHTML = `
        <div class="recent-table-container">
          <div class="recent-table-header">
            <span style="color: rgba(255, 255, 255, 0.8);">${t.allRecentSearches} (${allRecentSearches.length})</span>
            <button class="clear-all-btn" id="clearAllRecent">${t.clearAll}</button>
          </div>
          <div class="recent-table">
            ${allRecentSearches.map((item, index) => {
              const word = typeof item === 'string' ? item : item.word;
              const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
              const date = new Date(timestamp);
              const timeAgo = getTimeAgo(timestamp);
              return `
                <div class="recent-table-row">
                  <span class="recent-table-word" data-word="${word}">${word}</span>
                  <span class="recent-table-time">${timeAgo}</span>
                  <button class="recent-remove-btn" data-index="${index}" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                </div>
              `;
            }).join('')}
          </div>
          <button class="show-less-btn" id="collapseRecent">${t.showLess}</button>
        </div>
      `;
      recentDiv.innerHTML = tableHTML;
      
      // Add event handlers - entire row is clickable
      recentDiv.querySelectorAll('.recent-table-row').forEach(row => {
        const wordEl = row.querySelector('.recent-table-word');
        if (wordEl) {
          row.dataset.word = wordEl.dataset.word;
          row.style.cursor = 'pointer';
          row.addEventListener('click', (e) => {
            if (e.target.closest('.recent-remove-btn')) return;
              showWordDetails(row.dataset.word);
          });
        }
      });
      
      recentDiv.querySelectorAll('.recent-remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const index = parseInt(btn.dataset.index);
          await removeRecentSearch(index);
        });
      });
      
      // Add clear all button handler - attach immediately after HTML is set
      const clearAllBtn = recentDiv.querySelector('#clearAllRecent');
      if (clearAllBtn) {
        // Remove any existing listeners
        const newBtn = clearAllBtn.cloneNode(true);
        clearAllBtn.parentNode.replaceChild(newBtn, clearAllBtn);
        
        newBtn.addEventListener('click', async function(e) {
          e.stopPropagation();
          e.preventDefault();
          
          const lang = window.currentUILanguage || 'en';
          const t = translations[lang] || translations.en;
          
          try {
            await setStorage({ recentSearches: [] });
            allRecentSearches = [];
            recentExpanded = false;
            await loadRecent();
            showNotification(t.recentSearchesCleared || 'All recent searches cleared!', 'success');
          } catch (err) {
            showNotification('Error clearing recent searches. Please try again.', 'error');
          }
        });
      }
      
      // Add Show Less button handler
      const collapseBtn = document.getElementById('collapseRecent');
      if (collapseBtn) {
        // Remove any existing listeners by cloning
        const newBtn = collapseBtn.cloneNode(true);
        collapseBtn.parentNode.replaceChild(newBtn, collapseBtn);
        
        newBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
        recentExpanded = false;
        renderRecentSearches();
      });
      } else {
      }
    } else {
      // Show first 10 with Load More button - use same table style
      const first10 = allRecentSearches.slice(0, 10);
      const hasMore = allRecentSearches.length > 10;
      const moreText = t.more || 'more';
      const remainingCount = allRecentSearches.length - 10;
      
      const listHTML = `
        <div class="recent-table-container">
          <div class="recent-table">
            ${first10.map((item, index) => {
              const word = typeof item === 'string' ? item : item.word;
              const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
              const timeAgo = getTimeAgo(timestamp);
              return `
                <div class="recent-table-row" data-word="${word}">
                  <span class="recent-table-word">${word}</span>
                  <span class="recent-table-time">${timeAgo}</span>
                </div>
              `;
            }).join('')}
          </div>
          ${hasMore ? `<button class="load-more-btn" id="loadMoreRecent" style="display: block;">${t.loadMore} (${remainingCount} ${moreText})</button>` : ''}
        </div>
      `;
      
      recentDiv.innerHTML = listHTML;
      
      // Add click handlers - entire row is clickable
      recentDiv.querySelectorAll('.recent-table-row').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          showWordDetails(row.dataset.word);
        });
      });
      
      // Add Load More button handler - ensure it exists before adding listener
      if (hasMore) {
        const loadMoreBtn = document.getElementById('loadMoreRecent');
        if (loadMoreBtn) {
          // Remove any existing listeners by cloning
          const newBtn = loadMoreBtn.cloneNode(true);
          loadMoreBtn.parentNode.replaceChild(newBtn, loadMoreBtn);
          
          newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
          recentExpanded = true;
          renderRecentSearches();
        });
        } else {
        }
      }
    }
  }

  async function removeRecentSearch(index) {
    allRecentSearches.splice(index, 1);
    await setStorage({ recentSearches: allRecentSearches });
    renderRecentSearches();
  }

  function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }

  async function loadSaved() {
    try {
      if (!savedDiv) return;
      const list = await getStorage('savedForLater') || [];
      const t = translations[window.currentUILanguage || 'en'] || translations.en;
      if (list.length === 0) {
        savedDiv.innerHTML = `<div class="empty-state">${t.noSaved || 'No saved items yet.'}</div>`;
        return;
      }
      savedDiv.innerHTML = list.slice(0, 50).map(item => {
        const title = (item.title || item.url || 'Untitled').trim();
        const titleShow = title.length > 60 ? title.slice(0, 57) + '...' : title;
        const snippet = (item.text || '').toString().slice(0, 60);
        const snippetShow = snippet ? (snippet.length >= 60 ? snippet + '...' : snippet) : '';
        const urlAttr = (item.url || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `
          <div class="saved-item" data-id="${(item.id || '').replace(/"/g, '&quot;')}" data-url="${urlAttr}">
            <div class="saved-item-main" title="${(t.open || 'Open').replace(/"/g, '&quot;')}">
              <span class="saved-item-title">${titleShow.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
              ${snippetShow ? `<span class="saved-item-snippet">${snippetShow.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>` : ''}
            </div>
            <button class="saved-item-remove" data-id="${(item.id || '').replace(/"/g, '&quot;')}" title="${(t.remove || 'Remove').replace(/"/g, '&quot;')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
          </div>
        `;
      }).join('');
      savedDiv.querySelectorAll('.saved-item-main').forEach(el => {
        el.addEventListener('click', () => {
          const row = el.closest('.saved-item');
          const url = row?.dataset?.url;
          if (url) chrome.runtime.sendMessage({ type: 'openTab', url: url }, () => {});
        });
      });
      savedDiv.querySelectorAll('.saved-item-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = (btn.dataset.id || '').trim();
          if (!id) return;
          let arr = await getStorage('savedForLater') || [];
          arr = arr.filter(x => (x.id || '') !== id);
          await setStorage({ savedForLater: arr });
          loadSaved();
        });
      });
    } catch (e) {
      if (savedDiv) savedDiv.innerHTML = '<div class="empty-state">Error loading saved.</div>';
    }
  }

  async function loadWordOfDay(retryCount = 0) {
    if (!wordOfDayDiv) {
      return;
    }
    const pending = await new Promise(r => { chrome.storage.local.get(['pendingSearch'], x => r(x.pendingSearch)); });
    if (pending && ['person','place','organization'].includes(pending.type) && pending.data) return;
    if (currentView === 'person' || currentView === 'place' || currentView === 'organization') return;
    
    const currentLang = window.currentUILanguage || 'en';
    const loadingText = translations[currentLang]?.loadingWordOfDay || translations.en.loadingWordOfDay;
    wordOfDayDiv.innerHTML = `<div class="loading">${loadingText}</div>`;
    wordOfDayDiv.style.display = 'block';

    try {
      // Get word of the day - cache per day per user
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      
      // Get user email for deterministic word selection
      const storageData = await new Promise(resolve => {
        chrome.storage.local.get(['wordOfDay', 'wordOfDayDate', 'wordOfDayLanguage', 'userEmail'], (result) => {
          resolve(result);
        });
      });
      
      // Get current language setting
      const settings = await new Promise(resolve => {
        chrome.storage.local.get(['settings'], (result) => {
          resolve(result.settings || {});
        });
      });
      const currentLanguage = settings.dictionaryLanguage || 'en';
      
      // Check if we have a cached word for today in the current language
      const cachedWord = storageData.wordOfDayDate === today && 
                         storageData.wordOfDayLanguage === currentLanguage && 
                         storageData.wordOfDay;
      
      let word;
      if (cachedWord) {
        word = cachedWord;
      } else {
        // Get a new random word and cache it - with timeout to prevent hanging
        try {
          const wordPromise = getRandomWord(currentLanguage, storageData.userEmail || 'anonymous', today);
          const wordTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Word generation timeout')), 15000) // 15 second max
          );
          word = await Promise.race([wordPromise, wordTimeout]);
          
        if (word) {
          chrome.storage.local.set({ 
            wordOfDay: word, 
            wordOfDayDate: today,
            wordOfDayLanguage: currentLanguage
          }, () => {
          });
          }
        } catch (wordError) {
          // Use fallback word
          const fallbackWords = {
            en: 'serendipity',
            es: 'serendipidad',
            fr: 'sérendipité',
            de: 'Serendipität'
          };
          word = fallbackWords[currentLanguage] || fallbackWords.en;
        }
      }
      
      if (!word) {
        throw new Error('No word generated');
      }
      
      // Get detailed explanation with pronunciation and examples
      // Use timeout to prevent hanging
      const detailsPromise = getWordOfDayDetails(word);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Word of day details timeout')), 10000)
      );
      
      const details = await Promise.race([detailsPromise, timeoutPromise]);
      
      // Check if wordOfDayDiv still exists (might have been removed)
      if (!wordOfDayDiv || !wordOfDayDiv.parentNode) {
        return;
      }
      
      if (!details) {
        throw new Error('No details returned');
      }
      
      if (currentView === 'person' || currentView === 'place' || currentView === 'organization') return;
      if (details && details.explanation) {
        displayWordOfDay(word, details);
      } else {
        const currentLang = window.currentUILanguage || 'en';
        displayWordOfDay(word, {
          explanation: currentLang === 'de' 
            ? `Definition für "${word}" wird geladen...`
            : `Definition for "${word}" is loading...`,
          synonyms: [],
          pronunciation: null,
          examples: []
        });
      }
    } catch (e) {

      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000;
        setTimeout(() => loadWordOfDay(retryCount + 1), delay);
        return;
      }

      if (!wordOfDayDiv || !wordOfDayDiv.parentNode) return;
      if (currentView === 'person' || currentView === 'place' || currentView === 'organization') return;
      
      const currentLang = window.currentUILanguage || 'en';
      const errorMsg = translations[currentLang]?.errorLoadingWordOfDay || 'Error loading word of the day.';
      wordOfDayDiv.innerHTML = `
        <div class="word-card-modal">
          <div class="empty-state">${errorMsg}</div>
        </div>
      `;
    }
  }

  // Simple deterministic PRNG seeded with date + user
  function seededRandom(seed) {
    let value = seed;
    return function() {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }

  // Generate a numeric seed from date + user email
  function generateSeed(date, userEmail) {
    const seedString = `${date}-${userEmail}`;
    let hash = 0;
    for (let i = 0; i < seedString.length; i++) {
      const char = seedString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  async function getRandomWord(language, userEmail, date) {
    try {
      // Get seen words for this language to avoid duplicates
      const storageData = await new Promise(resolve => {
        chrome.storage.local.get([`seenWords_${language}`, 'favorites'], (result) => {
          resolve(result);
        });
      });
      
      const seenWords = storageData[`seenWords_${language}`] || [];
      const favorites = storageData.favorites || [];
      
      // Language code mapping for API
      const langMap = {
        en: 'en',
        es: 'es',
        fr: 'fr',
        de: 'de',
        it: 'it',
        pt: 'pt-br',
        ru: 'ru',
        ja: 'ja',
        zh: 'zh',
        ko: 'ko',
        ar: 'ar',
        hi: 'hi',
        nl: 'nl',
        sv: 'sv',
        pl: 'pl'
      };
      
      const apiLang = langMap[language] || 'en';
      
      // Try to fetch random word from free API (prefer longer words for complexity)
      // Limit attempts to prevent long delays
      let selectedWord = null;
      const maxAttempts = 3; // Reduced from 10 to prevent long delays
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          // Use random-word-api.herokuapp.com (free, no API key required)
          // Request longer words (8+ chars) for more complex vocabulary
          const minLength = 6 + (attempt * 2); // Start at 6, increase to 8, 10, etc.
          const maxLength = 20;
          
          const apiUrl = `https://random-word-api.herokuapp.com/word?number=10&length=${minLength}&lang=${apiLang}`;
          
          // Add timeout to prevent hanging
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
          
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            },
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
          }
          
          const words = await response.json();
          
          if (words && Array.isArray(words) && words.length > 0) {
            // Filter out seen words and pick a random one
            const availableWords = words.filter(word => 
              word && 
              typeof word === 'string' && 
              word.length >= minLength && 
              !seenWords.includes(word.toLowerCase()) &&
              !favorites.includes(word.toLowerCase())
            );
            
            if (availableWords.length > 0) {
              // Generate deterministic seed from date + user email
              const seed = generateSeed(date, userEmail);
              const random = seededRandom(seed + attempt);
              const randomIndex = Math.floor(random() * availableWords.length);
              selectedWord = availableWords[randomIndex].toLowerCase();
              break;
            }
          }
        } catch (apiError) {
          // Don't log AbortError (timeout) as warning, it's expected
          if (apiError.name !== 'AbortError') {
          }
          // Try fallback API on last attempt
          if (attempt === maxAttempts - 1) {
            try {
              // Fallback to vercel.app API
              const fallbackUrl = `https://random-word-api.vercel.app/api?words=10&length=${6 + attempt * 2}`;
              
              // Add timeout to prevent hanging
              const fallbackController = new AbortController();
              const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), 3000); // 3 second timeout
              
              const fallbackResponse = await fetch(fallbackUrl, {
                signal: fallbackController.signal
              });
              
              clearTimeout(fallbackTimeoutId);
              
              if (fallbackResponse.ok) {
                const fallbackData = await fallbackResponse.json();
                if (fallbackData && Array.isArray(fallbackData) && fallbackData.length > 0) {
                  const availableWords = fallbackData.filter(word => 
                    word && 
                    typeof word === 'string' && 
                    !seenWords.includes(word.toLowerCase()) &&
                    !favorites.includes(word.toLowerCase())
                  );
                  if (availableWords.length > 0) {
                    const seed = generateSeed(date, userEmail);
                    const random = seededRandom(seed + attempt);
                    const randomIndex = Math.floor(random() * availableWords.length);
                    selectedWord = availableWords[randomIndex].toLowerCase();
                    break;
                  }
                }
              }
            } catch (fallbackError) {
            }
          }
        }
      }
      
      // If API failed completely, use minimal fallback list (only for emergency)
      if (!selectedWord) {
        const minimalFallback = {
          en: ['serendipity', 'ephemeral', 'eloquent', 'resilient', 'mellifluous', 'ubiquitous', 'perspicacious', 'luminous', 'effervescent', 'quintessential'],
          es: ['serendipidad', 'efímero', 'elocuente', 'resistente', 'melifluo', 'ubicuo', 'perspicaz', 'luminoso', 'efervescente', 'quintaesencial'],
          fr: ['sérendipité', 'éphémère', 'éloquent', 'résilient', 'méliflu', 'ubiquitaire', 'perspicace', 'lumineux', 'effervescent', 'quintessentiel'],
          de: ['Serendipität', 'flüchtig', 'eloquent', 'widerstandsfähig', 'melodisch', 'allgegenwärtig', 'scharfsinnig', 'leuchtend', 'sprudelnd', 'quintessentiell']
        };
        
        const words = minimalFallback[language] || minimalFallback.en;
      
      // Generate deterministic seed from date + user email
      const seed = generateSeed(date, userEmail);
      const random = seededRandom(seed);
      
        // Filter out seen words
      const availableWords = words.filter(word => !seenWords.includes(word));
      const wordsToChooseFrom = availableWords.length > 0 ? availableWords : words;
      
      // Pick a deterministic random word based on seed
      const randomIndex = Math.floor(random() * wordsToChooseFrom.length);
        selectedWord = wordsToChooseFrom[randomIndex];
      }
      
      if (selectedWord) {
      // Add to seen words (unless it's a favorite - favorites can repeat)
      if (!favorites.includes(selectedWord)) {
        seenWords.push(selectedWord);
        // Limit seen words to prevent storage bloat (keep last 1000)
        if (seenWords.length > 1000) {
          seenWords.shift();
        }
        chrome.storage.local.set({ [`seenWords_${language}`]: seenWords }, () => {});
      }
      
      return selectedWord;
      }
      
      // Ultimate fallback (should never reach here)
      return language === 'en' ? 'serendipity' : 
             language === 'es' ? 'serendipidad' :
             language === 'fr' ? 'sérendipité' :
             language === 'de' ? 'Serendipität' : 'serendipity';
    } catch (e) {
      // Fallback to a default word
      return language === 'en' ? 'serendipity' : 
             language === 'es' ? 'serendipidad' :
             language === 'fr' ? 'sérendipité' :
             language === 'de' ? 'Serendipität' : 'serendipity';
    }
  }

  // Free dictionary API fallback when main explain returns "not found" (so WOTD always has a definition)
  async function fetchFreeDictionaryForWord(word, lang) {
    const langCode = (lang || 'en').split('-')[0];
    const supported = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'hi', 'ja', 'ko', 'ar', 'zh'];
    if (!supported.includes(langCode)) langCode = 'en';
    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/${langCode}/${encodeURIComponent(word.trim())}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      const entry = data[0];
      const meanings = entry.meanings || [];
      const definitions = [];
      const examples = [];
      let synonyms = [];
      for (const m of meanings) {
        for (const d of (m.definitions || [])) {
          if (d.definition) definitions.push(d.definition);
          if (d.example) examples.push(d.example);
        }
        if (m.synonyms && Array.isArray(m.synonyms)) {
          synonyms = synonyms.concat(m.synonyms.filter(s => s && typeof s === 'string'));
        }
      }
      const pronunciation = (entry.phonetic || (entry.phonetics && entry.phonetics[0] && entry.phonetics[0].text)) || getPronunciation(word);
      const explanation = definitions.length ? definitions.slice(0, 3).join(' ') : null;
      if (!explanation) return null;
      return {
        explanation,
        synonyms: [...new Set(synonyms)].slice(0, 12),
        pronunciation: pronunciation || getPronunciation(word),
        examples: examples.slice(0, 5)
      };
    } catch (e) {
      return null;
    }
  }

  async function getWordOfDayDetails(word) {
    try {
      // Get explanation with detailed info
      const resp = await new Promise((resolve) => {
        try {
          if (!chrome || !chrome.runtime || !chrome.runtime.id) {
            resolve({ error: 'Extension context invalidated' });
            return;
          }
          
          // Set a timeout for the message
          const timeout = setTimeout(() => {
            resolve({ error: 'Request timeout', explanation: `Definition für "${word}" wird geladen...` });
          }, 15000); // 15 second timeout
          
          chrome.runtime.sendMessage({ 
            type: 'explain', 
            word: word, 
            context: '',
            detailed: true
          }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { error: 'No response' });
            }
          });
        } catch (e) {
          resolve({ error: e.message });
        }
      });

      
      // Even if there's an error in the response, try to use what we have
      if (resp) {
        // Check if response has an error field but also has explanation
        if (resp.error && !resp.explanation) {
          const isNotFound = /not found|nicht gefunden/i.test(resp.error);
          if (isNotFound) {
            const settings = await new Promise(resolve => {
              chrome.storage.local.get(['settings'], (result) => { resolve(result.settings || {}); });
            });
            const lang = (settings.dictionaryLanguage || 'en').split('-')[0];
            const freeDef = await fetchFreeDictionaryForWord(word, lang);
            if (freeDef) {
              return freeDef;
            }
          }
          const settings = await new Promise(resolve => {
            chrome.storage.local.get(['settings'], (result) => { resolve(result.settings || {}); });
          });
          const lang = settings.dictionaryLanguage || 'en';
          const errorMessages = {
            'de': /not found|nicht gefunden/i.test(resp.error)
              ? `"${word}" wurde im Wörterbuch nicht gefunden. Bitte versuchen Sie es später erneut.`
              : `Fehler beim Laden der Definition: ${resp.error}`,
            'en': /not found/i.test(resp.error)
              ? `"${word}" not found in dictionary. Please try again later.`
              : `Error loading definition: ${resp.error}`
          };
          return {
            explanation: errorMessages[lang] || errorMessages['en'],
            synonyms: resp.synonyms || [],
            pronunciation: resp.pronunciation || getPronunciation(word),
            examples: resp.examples || []
          };
        }
        
        // Return the response even if it has an error field, as long as it has explanation
        // Ensure synonyms is always an array
        let synonyms = [];
        if (resp.synonyms) {
          if (Array.isArray(resp.synonyms)) {
            synonyms = resp.synonyms.filter(s => s && typeof s === 'string' && s.trim());
          } else if (typeof resp.synonyms === 'string') {
            synonyms = [resp.synonyms.trim()].filter(s => s);
          }
        }
        
        
        return {
          explanation: resp.explanation || resp.error || `Definition für "${word}"`,
          synonyms: synonyms,
          pronunciation: resp.pronunciation || getPronunciation(word),
          examples: resp.examples || []
        };
      } else {
        // If no response at all, return fallback
        // Get current language for error message
        const settings = await new Promise(resolve => {
          chrome.storage.local.get(['settings'], (result) => {
            resolve(result.settings || {});
          });
        });
        const lang = settings.dictionaryLanguage || 'en';
        
        const errorMessages = {
          'de': `Konnte Definition für "${word}" nicht laden.`,
          'en': `Could not load definition for "${word}".`
        };
        
        return {
          explanation: errorMessages[lang] || errorMessages['en'],
          synonyms: [],
          pronunciation: getPronunciation(word),
          examples: []
        };
      }
    } catch (e) {
      // Fallback
      return {
        explanation: `Fehler beim Laden der Definition: ${e.message}`,
        synonyms: [],
        pronunciation: getPronunciation(word),
        examples: []
      };
    }
  }
  
  function getPronunciation(word) {
    // Simple pronunciation guide
    return `/${word}/`;
  }

  async function displayWordOfDay(word, details) {
    // Get favorites to check if word is favorited
    const favorites = await getStorage('favorites') || [];
    const isFavorited = favorites.includes(word);
    
    // Get settings
    const settings = await new Promise(resolve => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {});
      });
    });
    const showPhonetic = settings.showPhonetic !== false;
    const showExamples = settings.showExamples !== false;
    
    // Extract synonyms
    let synonyms = [];
    if (details.synonyms !== undefined && details.synonyms !== null) {
      if (Array.isArray(details.synonyms)) {
        synonyms = details.synonyms.filter(s => s && typeof s === 'string' && s.trim());
      } else if (typeof details.synonyms === 'string') {
        synonyms = [details.synonyms.trim()].filter(s => s);
      }
    }
    
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal">
        <div class="word-card-header">
          <div class="word-card-header-top">
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${word}</span>
                ${showPhonetic && details.pronunciation ? `<span class="word-card-phonetic">${details.pronunciation}</span>` : ''}
              </div>
              <button class="word-card-copy-btn" id="wotdCopyBtn" title="${translations[window.currentUILanguage || 'en']?.copyWord || 'Copy word'}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
              </button>
              <button class="word-card-tts-btn" id="wotdTtsBtn" title="${translations[window.currentUILanguage || 'en']?.speakWord || 'Speak word'}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="word-card-explanation">${details.explanation}</div>
        ${showExamples && details.examples && details.examples.length > 0 ? `
          <div class="word-card-examples-container">
            <div class="word-card-examples-label">${translations[window.currentUILanguage || 'en']?.examplesLabel || 'Examples'}</div>
            <div class="word-card-examples-list">
              ${details.examples.map(ex => `<div class="word-card-example-item">${ex}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        ${synonyms.length > 0 ? `
          <div class="word-card-synonyms-container">
            <div class="word-card-synonyms-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
              </svg>
              ${translations[window.currentUILanguage || 'en']?.synonymsLabel || 'Synonyms'}
            </div>
            <div class="word-card-synonyms-scroll">
              ${synonyms.map(s => `<span class="word-card-synonym-tag" data-synonym="${s}">${s}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="word-card-actions">
          <button class="word-card-fav-btn-icon ${isFavorited ? 'favorited' : ''}" id="wotdFavBtn" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
          <button class="word-card-search-btn-icon" id="wotdSearchBtn" title="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    
    // Event handlers
    document.getElementById('wotdCopyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(word);
        const btn = document.getElementById('wotdCopyBtn');
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 2000);
      } catch (e) {
      }
    });
    
    document.getElementById('wotdFavBtn').addEventListener('click', async () => {
      const favorites = await getStorage('favorites') || [];
      const index = favorites.indexOf(word);
      if (index > -1) {
        favorites.splice(index, 1);
      } else {
        favorites.push(word);
      }
      await setStorage({ favorites });
      const btn = document.getElementById('wotdFavBtn');
      const isNowFavorited = favorites.includes(word);
      btn.classList.toggle('favorited', isNowFavorited);
      btn.querySelector('svg').setAttribute('fill', isNowFavorited ? 'currentColor' : 'none');
      loadFavorites();
    });
    
    document.getElementById('wotdSearchBtn').addEventListener('click', () => {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(word)}`, '_blank');
    });
    
    const ttsBtn = document.getElementById('wotdTtsBtn');
    ttsBtn.addEventListener('click', () => {
      speakWord(word, details.pronunciation, ttsBtn);
    });
    
    // Make synonyms clickable
    wordOfDayDiv.querySelectorAll('.word-card-synonym-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        showWordDetails(tag.dataset.synonym);
      });
    });
  }

  // Unified voice selection function (shared with contentScript logic)
  function getBestVoice(lang = 'en-US', voicePreference = 'auto') {
    if (!window.speechSynthesis) return null;
    
    let voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) {
      window.speechSynthesis.getVoices();
      voices = window.speechSynthesis.getVoices();
    }
    if (!voices || voices.length === 0) return null;
    
    // Filter voices by language first
    const langCode = lang.split('-')[0];
    let matchingVoices = voices.filter(v => v.lang.startsWith(langCode));
    
    if (matchingVoices.length === 0) {
      matchingVoices = voices.filter(v => v.lang.includes(langCode));
    }
    
    if (matchingVoices.length === 0) {
      matchingVoices = voices;
    }
    
    // Apply voice preference (male/female/auto)
    if (voicePreference === 'female') {
      // Prioritize more feminine voices - Google Cloud TTS and Apple voices
      const femaleVoices = matchingVoices.filter(v => 
        v.name.toLowerCase().includes('female') || 
        // Google Cloud TTS female voices (C, E, F are typically female)
        (v.name.includes('Google') && (
          v.name.includes('en-US-Standard-C') || 
          v.name.includes('en-US-Standard-E') || 
          v.name.includes('en-US-Standard-F') ||
          v.name.includes('en-US-Wavenet-C') || 
          v.name.includes('en-US-Wavenet-E') || 
          v.name.includes('en-US-Wavenet-F') ||
          v.name.includes('en-US-Neural2-C') || 
          v.name.includes('en-US-Neural2-E') || 
          v.name.includes('en-US-Neural2-F')
        )) ||
        // Apple macOS female voices - prioritize Samantha and Victoria
        (v.name.includes('Samantha') || v.name.includes('Victoria'))
      );
      if (femaleVoices.length > 0) {
        matchingVoices = femaleVoices;
      }
    } else if (voicePreference === 'male') {
      // Prioritize deeper, more masculine voices - avoid soft voices
      // Focus on Google Cloud TTS (D and J are deeper than B) and Apple voices
      const maleVoices = matchingVoices.filter(v => 
        v.name.toLowerCase().includes('male') || 
        // Google Cloud TTS - prioritize D and J (deeper), then B
        (v.name.includes('Google') && (
          v.name.includes('en-US-Standard-D') || 
          v.name.includes('en-US-Standard-J') || 
          v.name.includes('en-US-Wavenet-D') || 
          v.name.includes('en-US-Wavenet-J') || 
          v.name.includes('en-US-Neural2-D') || 
          v.name.includes('en-US-Neural2-J') ||
          v.name.includes('en-US-Standard-B') || 
          v.name.includes('en-US-Wavenet-B') || 
          v.name.includes('en-US-Neural2-B')
        )) ||
        // Apple macOS male voices - Alex is good, avoid soft-sounding names
        (v.name.includes('Alex') || v.name.includes('Daniel') || v.name.includes('Fred'))
      );
      if (maleVoices.length > 0) {
        matchingVoices = maleVoices;
      }
    }
    
    // Priority order for voice selection (most natural/lifelike first)
    // NO MICROSOFT VOICES - Google and Apple only
    const voicePriorities = [
      // Google Neural/Wavenet voices (best quality) - prioritize deeper male (D, J) and feminine female (C, E, F)
      (v) => {
        if (voicePreference === 'male' && (v.name.includes('en-US-Standard-D') || v.name.includes('en-US-Standard-J') || v.name.includes('en-US-Wavenet-D') || v.name.includes('en-US-Wavenet-J') || v.name.includes('en-US-Neural2-D') || v.name.includes('en-US-Neural2-J'))) {
          return v.name.includes('Google') && (v.name.includes('Neural') || v.name.includes('Wavenet'));
        }
        if (voicePreference === 'female' && (v.name.includes('en-US-Standard-C') || v.name.includes('en-US-Standard-E') || v.name.includes('en-US-Standard-F') || v.name.includes('en-US-Wavenet-C') || v.name.includes('en-US-Wavenet-E') || v.name.includes('en-US-Wavenet-F') || v.name.includes('en-US-Neural2-C') || v.name.includes('en-US-Neural2-E') || v.name.includes('en-US-Neural2-F'))) {
          return v.name.includes('Google') && (v.name.includes('Neural') || v.name.includes('Wavenet'));
        }
        if (voicePreference === 'auto') {
          return v.name.includes('Google') && (v.name.includes('Neural') || v.name.includes('Wavenet'));
        }
        return false;
      },
      // Google Standard voices (fallback)
      (v) => {
        if (voicePreference === 'male' && (v.name.includes('en-US-Standard-D') || v.name.includes('en-US-Standard-J'))) {
          return v.name.includes('Google');
        }
        if (voicePreference === 'female' && (v.name.includes('en-US-Standard-C') || v.name.includes('en-US-Standard-E') || v.name.includes('en-US-Standard-F'))) {
          return v.name.includes('Google');
        }
        if (voicePreference === 'auto') {
          return v.name.includes('Google');
        }
        return false;
      },
      // Apple voices (Mac/iOS) - Alex is male, Samantha/Victoria are female
      (v) => {
        if (voicePreference === 'male' && v.name.includes('Alex')) return true;
        if (voicePreference === 'female' && (v.name.includes('Samantha') || v.name.includes('Victoria'))) return true;
        if (voicePreference === 'auto') {
          return v.name.includes('Samantha') || v.name.includes('Alex') || v.name.includes('Victoria');
        }
        return false;
      },
      // Other Google voices (fallback)
      (v) => v.name.includes('Google') && !v.name.includes('Microsoft'),
      // Default to any voice matching the language (but NOT Microsoft)
      (v) => v.lang.startsWith(langCode) && !v.name.includes('Microsoft')
    ];
    
    // Try to find the best voice based on priorities
    for (const priorityFn of voicePriorities) {
      const found = matchingVoices.find(priorityFn);
      if (found) return found;
    }
    
    // Fallback: prefer female voices if auto (often sound more natural) - NO MICROSOFT
    if (voicePreference === 'auto') {
      const femaleVoice = matchingVoices.find(v => 
        (!v.name.includes('Microsoft')) && (
          v.name.toLowerCase().includes('female') || 
          v.name.includes('Samantha') || 
          v.name.includes('Victoria') ||
          (v.name.includes('Google') && (v.name.includes('en-US-Standard-C') || v.name.includes('en-US-Standard-E') || v.name.includes('en-US-Standard-F')))
        )
      );
      if (femaleVoice) return femaleVoice;
    }
    
    // Last resort: return first matching voice (but NOT Microsoft)
    const nonMicrosoftVoices = matchingVoices.filter(v => !v.name.includes('Microsoft'));
    if (nonMicrosoftVoices.length > 0) return nonMicrosoftVoices[0];
    
    // Absolute last resort: any voice except Microsoft
    const anyNonMicrosoft = voices.filter(v => !v.name.includes('Microsoft'));
    return anyNonMicrosoft[0] || null;
  }

  // Text-to-speech function
  function speakWord(word, pronunciation, buttonElement = null) {
    if (!('speechSynthesis' in window)) {
      if (buttonElement) {
        buttonElement.classList.remove('speaking');
      }
      return;
    }
    
    // Stop any ongoing speech
    window.speechSynthesis.cancel();
    
    // Get settings for language and voice preference
    chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings || {};
      const lang = settings.dictionaryLanguage || 'en';
      const voicePreference = settings.voicePreference || 'auto'; // 'auto', 'male', 'female'
      
      // Map language codes to speech synthesis voices
      const langMap = {
        'en': 'en-US',
        'es': 'es-ES',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'it': 'it-IT',
        'pt': 'pt-PT',
        'ru': 'ru-RU',
        'ja': 'ja-JP',
        'zh': 'zh-CN',
        'ko': 'ko-KR',
        'ar': 'ar-SA',
        'hi': 'hi-IN',
        'nl': 'nl-NL',
        'sv': 'sv-SE',
        'pl': 'pl-PL',
        'tr': 'tr-TR'
      };
      
      const langCode = langMap[lang] || 'en-US';
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = langCode;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;
      
      // Function to set voice and speak
      const speakWithVoice = () => {
        const bestVoice = getBestVoice(langCode, voicePreference);
        if (bestVoice) {
          utterance.voice = bestVoice;
          utterance.lang = bestVoice.lang;
        }
        
        // Visual feedback
        if (buttonElement) {
          buttonElement.classList.add('speaking');
        }
        
        utterance.onend = () => {
          if (buttonElement) {
            buttonElement.classList.remove('speaking');
          }
        };
        
        utterance.onerror = (e) => {
          if (buttonElement) {
            buttonElement.classList.remove('speaking');
          }
        };
        
        window.speechSynthesis.speak(utterance);
      };
      
      // Voices may not be loaded immediately, wait for them
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        speakWithVoice();
      } else {
        // Wait for voices to load
        window.speechSynthesis.onvoiceschanged = () => {
          speakWithVoice();
          window.speechSynthesis.onvoiceschanged = null; // Remove listener after first call
        };
      }
    });
  }

  // Helper functions
  function getStorage(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (res) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(res[key]);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function setStorage(data) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve();
          return;
        }
        chrome.storage.local.set(data, () => {
          if (chrome.runtime.lastError) {
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  async function removeFavorite(word) {
    const favorites = await getStorage('favorites') || [];
    const filtered = favorites.filter(w => w !== word);
    await setStorage({ favorites: filtered });
  }

  async function saveToRecent(word) {
    // Check if we're in incognito mode - don't save if so
    try {
      if (chrome && chrome.extension && chrome.extension.inIncognitoContext) {
        // Incognito mode detected, not saving to recent
        return;
      }
    } catch (e) {
      // Extension context might not be available in popup
    }
    
    const recent = await getStorage('recentSearches') || [];
    
    // Migrate old format (strings) to new format (objects with timestamp)
    let recentList = recent;
    if (recent.length > 0 && typeof recent[0] === 'string') {
      recentList = recent.map(w => ({ word: w, timestamp: Date.now() }));
    }
    
    // Remove if already exists
    const filtered = recentList.filter(item => {
      const itemWord = typeof item === 'string' ? item : item.word;
      return itemWord !== word;
    });
    
    // Add to front with timestamp
    filtered.unshift({ word: word, timestamp: Date.now() });
    
          // Remove entries older than 14 days
          const fourteenDaysAgo2 = Date.now() - (14 * 24 * 60 * 60 * 1000);
          const cleaned = filtered.filter(item => {
            const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
            return timestamp > fourteenDaysAgo2;
          });
    
    // Limit to 100 recent searches, auto-delete oldest when exceeded
    await setStorage({ recentSearches: cleaned.slice(0, 100) });
  }

  // Make loadWordOfDay available globally for onclick
  window.loadWordOfDay = loadWordOfDay;

})();



