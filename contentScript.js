/* contentScript.js
   Text selection detection, tooltip injection with Google button and synonyms.
   Nimbus Extension
*/

(() => {
  const MIN_WORD_LEN = 2;
  let tooltipEl = null;
  let selectionTimer = null;
  let currentWord = null;
  let currentSynonyms = [];
  let lastSelection = '';
  let manuallyClosed = false; // Track if user manually closed the tooltip
  let modalSettings = {
    placement: 'intuitive',
    draggable: true,
    showPhonetic: true,
    showExamples: true
  };
  let isDragging = false;

  // Initialize subscription status
  let subscriptionActive = false;
  const SUBSCRIPTION_ID = 'nimbus_yearly_subscription';
  let usage = { used: 0, date: new Date().toISOString().slice(0,10), limit: 999999 };
  
  // Check if extension is running in development mode (unpacked)
  // In development, bypass subscription check for testing
  const isDevelopmentMode = chrome.runtime.getManifest().update_url === undefined;
  
  function safeStorageGet(keys, callback) {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(keys, callback);
    } catch (e) {
      console.warn('CursorIQ: Storage get failed', e);
    }
  }
  
  function safeStorageSet(data, callback) {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set(data, callback);
    } catch (e) {
      console.warn('CursorIQ: Storage set failed', e);
    }
  }
  
  // Check subscription status
  async function checkSubscription() {
    // Bypass subscription check in development mode (unpacked extension)
    const isDevelopmentMode = !chrome.runtime.getManifest().update_url;
    if (isDevelopmentMode) {
      console.log('Nimbus: Development mode detected - bypassing subscription check');
      subscriptionActive = true;
      return true;
    }
    
    try {
      // If payments API not available (dev mode or not published), allow access
      if (!chrome || !chrome.payments || !chrome.payments.getPurchases) {
        console.warn('Nimbus: Payments API not available - allowing access (dev mode)');
        subscriptionActive = true;
        return true;
      }
      
      return new Promise((resolve) => {
        chrome.payments.getPurchases((purchases) => {
          if (chrome.runtime.lastError) {
            console.warn('Nimbus: Error checking purchases:', chrome.runtime.lastError);
            resolve(false);
            return;
          }
          
          const hasActiveSubscription = purchases && purchases.some(
            p => p.productId === SUBSCRIPTION_ID && p.purchaseState === 'PURCHASED'
          );
          
          subscriptionActive = hasActiveSubscription || false;
          console.log('Nimbus: Subscription status:', subscriptionActive);
          resolve(subscriptionActive);
        });
      });
    } catch (e) {
      console.error('Nimbus: Error checking subscription:', e);
      return false;
    }
  }

  // Initialize subscription check on load
  checkSubscription().then(() => {
    safeStorageGet(['usage'], (res) => {
      if (chrome.runtime.lastError) return;
      if (res.usage) {
        usage = res.usage;
      }
    });
  });

  // Listen for storage changes
  try {
    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.usage) {
          usage = changes.usage.newValue || usage;
        }
      });
    }
  } catch (e) {
    console.warn('Nimbus: Could not set up storage listener', e);
  }

  // Listen for purchase updates
  try {
    if (chrome && chrome.payments && chrome.payments.onPurchasesUpdated) {
      chrome.payments.onPurchasesUpdated.addListener((purchases) => {
        checkSubscription();
      });
    }
  } catch (e) {
    console.warn('Nimbus: Purchase listener setup failed', e);
  }

  console.log('Nimbus: Content script loaded on', window.location.href);

  // Listen for text selection
  document.addEventListener('mouseup', handleSelection);
  // Don't use selectionchange - it fires too often and causes issues
  // document.addEventListener('selectionchange', handleSelection);
  
  // Add keyboard shortcut for testing (Ctrl+Shift+E)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      try {
        // Check extension context before proceeding
        if (!chrome || !chrome.runtime) {
          console.warn('CursorIQ: Extension context invalidated');
          return;
        }
        try {
          const runtimeId = chrome.runtime.id;
          if (!runtimeId) {
            return;
          }
        } catch (err) {
          console.warn('CursorIQ: Extension context invalidated:', err.message);
          return;
        }
        
        const selection = window.getSelection();
        if (selection && selection.toString().trim()) {
          handleSelection();
        } else {
          // Test with a dummy word
          triggerExplain({ word: 'test', context: 'test context', range: null, contextHash: 0 });
        }
      } catch (err) {
        if (err.message && err.message.includes('Extension context invalidated')) {
          console.warn('CursorIQ: Extension context invalidated');
        } else {
          console.error('CursorIQ: Error in keyboard shortcut handler', err);
        }
      }
    }
  });

  function handleSelection() {
    // Check extension context FIRST before doing anything
    try {
      if (!chrome || !chrome.runtime) {
        // Extension context invalidated - silently return
        return;
      }
      // Check if runtime.id exists (will throw if context invalidated)
      try {
        const runtimeId = chrome.runtime.id;
        if (!runtimeId) {
          return;
        }
      } catch (e) {
        // Extension context invalidated
        return;
      }
    } catch (e) {
      // Extension context invalidated - silently return
      return;
    }

    // Clear any existing timer
    if (selectionTimer) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }

    try {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        // No selection - DON'T auto-remove if tooltip exists
        // Only remove if user explicitly clicks outside AND tooltip wasn't manually closed
        // For now, disable auto-close entirely - user must click X or click away
        return;
      }

      const selectedText = selection.toString().trim();
      if (!selectedText || selectedText.length < MIN_WORD_LEN) {
        return;
      }

      // Check if selection is an email address
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(selectedText)) {
        // It's an email - show email modal instead
        showEmailModal(selectedText, range);
        return;
      }

      // Limit to maximum 2 words - split and check word count
      const words = selectedText.split(/\s+/).filter(w => w.trim().length > 0);
      if (words.length > 2) {
        // More than 2 words selected - don't show tooltip
        return;
      }

      // Check if selection is inside an input, textarea, or search field
      try {
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const startContainer = range.startContainer;
          const endContainer = range.endContainer;
          
          // Helper function to check if a node is inside an input/textarea
          const isInsideInput = (node) => {
            let current = node;
            let depth = 0;
            const maxDepth = 20; // Prevent infinite loops
            
            while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
              depth++;
              
              // Check if it's an input/textarea element
              if (current.nodeType === Node.ELEMENT_NODE) {
                const tagName = current.tagName?.toLowerCase();
                if (tagName === 'input' || tagName === 'textarea' || tagName === 'search') {
                  return true;
                }
                // Check for contenteditable
                if (current.contentEditable === 'true' || current.isContentEditable) {
                  return true;
                }
                // Check for input-like classes/attributes
                if (current.classList) {
                  const classes = Array.from(current.classList);
                  if (classes.some(c => c.includes('input') || c.includes('search') || c.includes('textarea') || c.includes('Search'))) {
                    return true;
                  }
                }
                // Check for input-like attributes
                if (current.getAttribute && (current.getAttribute('role') === 'textbox' || current.getAttribute('type') === 'search' || current.getAttribute('type') === 'text')) {
                  return true;
                }
              }
              
              // Move up the tree
              current = current.parentElement || current.parentNode;
            }
            return false;
          };
          
          // Check both start and end containers
          if (isInsideInput(startContainer) || isInsideInput(endContainer)) {
            console.log('CursorIQ: Selection is inside input/textarea/search, ignoring');
            return;
          }
          
          // Also check the common ancestor
          const commonAncestor = range.commonAncestorContainer;
          if (isInsideInput(commonAncestor)) {
            console.log('CursorIQ: Selection common ancestor is inside input/textarea/search, ignoring');
            return;
          }
          
          // Additional check: see if the active element is an input
          const activeElement = document.activeElement;
          if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SEARCH' || activeElement.contentEditable === 'true')) {
            console.log('CursorIQ: Active element is input/textarea/search, ignoring');
            return;
          }
        }
      } catch (e) {
        // If check fails, continue anyway
        console.warn('CursorIQ: Error checking if selection is in input', e);
      }

    // Don't process if same selection AND tooltip is already showing
    // But allow if tooltip was just closed (lastSelection is empty)
    if (selectedText === lastSelection && tooltipEl) {
      return;
    }

    // Update lastSelection - this allows re-selecting after closing
    lastSelection = selectedText;

      // Get the range and context
      let range = null;
      let context = selectedText;
      
      try {
        range = selection.getRangeAt(0);
        if (range && range.commonAncestorContainer) {
          const parent = range.commonAncestorContainer.parentElement;
          if (parent && parent.innerText) {
            context = parent.innerText;
          }
        }
      } catch (e) {
        console.warn('CursorIQ: Error getting range/context', e);
      }

      // Extract first word or phrase (up to 2 words max)
      const term = words.join(' ');

      console.log('CursorIQ: Selection detected:', term);

      // Trigger explanation after a short delay
      selectionTimer = setTimeout(() => {
        try {
          // Check extension context again before triggering
          if (!chrome || !chrome.runtime || !chrome.runtime.id) {
            return;
          }
          
          const currentSelection = window.getSelection();
          if (currentSelection && currentSelection.toString().trim() === selectedText) {
            const contextStr = (context || selectedText || '').toString();
            triggerExplain({
              word: term,
              range: range,
              context: contextStr,
              contextHash: hashString(contextStr.slice ? contextStr.slice(0, 200) : contextStr.substring(0, 200))
            });
          }
        } catch (e) {
          if (e.message && e.message.includes('Extension context invalidated')) {
            console.warn('CursorIQ: Extension context invalidated during selection');
          } else {
            console.error('CursorIQ: Error in selection handler', e);
          }
        }
      }, 200); // Shorter delay for faster response
    } catch (e) {
      if (e.message && e.message.includes('Extension context invalidated')) {
        // Silently ignore - extension was reloaded
        return;
      }
      console.error('CursorIQ: Error in handleSelection', e);
    }
  }

  function triggerExplain(wordInfo) {
    if (!wordInfo.word || wordInfo.word.length < MIN_WORD_LEN) return;

    // Check if extension context is still valid BEFORE doing anything
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        console.error('CursorIQ: Extension context invalidated - refresh page');
        alert('CursorIQ: Extension was reloaded. Please refresh this page (F5) to continue.');
        return;
      }
    } catch (e) {
      console.error('CursorIQ: Cannot access chrome.runtime', e);
      alert('CursorIQ: Extension error. Please refresh the page (F5).');
      return;
    }

    // Check subscription before allowing word lookup
    checkSubscription().then((isActive) => {
      if (!isActive) {
        // Show upgrade prompt
        showUpgradePrompt(wordInfo);
        return;
      }

      // reset daily usage if date changed
      const today = new Date().toISOString().slice(0,10);
      if (usage.date !== today) { usage.used = 0; usage.date = today; }

      // Track usage
      usage.used += 1;
      safeStorageSet({ usage });

      currentWord = wordInfo.word;
      showTooltip(wordInfo, "Thinking...", false, []); // Show loading state with empty synonyms

      console.log('Nimbus: Sending message to background for:', wordInfo.word);
      
      try {
        console.log('Nimbus: About to call chrome.runtime.sendMessage');
        console.log('Nimbus: chrome.runtime exists:', !!chrome.runtime);
        console.log('Nimbus: chrome.runtime.id:', chrome.runtime?.id);
        
        chrome.runtime.sendMessage({ type: 'explain', word: wordInfo.word, context: wordInfo.context }, (resp) => {
        console.log('CursorIQ: ========== CALLBACK FIRED ==========');
        console.log('CursorIQ: Callback executed!');
        console.log('CursorIQ: Response received:', resp);
        console.log('CursorIQ: Response type:', typeof resp);
        console.log('CursorIQ: chrome.runtime.lastError:', chrome.runtime.lastError);
        
        // Check for extension context invalidated
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message;
          console.error('CursorIQ: Runtime error in callback:', chrome.runtime.lastError);
          if (errorMsg && (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message port closed'))) {
            console.warn('CursorIQ: Extension was reloaded. Please refresh the page.');
            showTooltip(wordInfo, "⚠️ Extension reloaded. Please refresh the page (F5).", true);
            return;
          }
          showTooltip(wordInfo, "Extension error: " + errorMsg);
          return;
        }
        
        if (!resp) {
          console.error('CursorIQ: No response from background');
          showTooltip(wordInfo, "No response from background service.");
          return;
        }
        if (resp.error) {
          console.error('CursorIQ: Background error', resp.error);
          showTooltip(wordInfo, `Error: ${resp.error}`);
          return;
        }
        console.log('CursorIQ: ========== RECEIVED RESPONSE ==========');
        console.log('CursorIQ: Got explanation', resp.explanation?.substring(0, 50));
        console.log('CursorIQ: isPerson:', resp.isPerson, 'personData:', resp.personData ? 'present' : 'missing');
        console.log('CursorIQ: Full response object:', resp);
        console.log('CursorIQ: Response keys:', Object.keys(resp || {}));
        console.log('CursorIQ: Got synonyms from response:', resp.synonyms);
        console.log('CursorIQ: Synonyms type:', typeof resp.synonyms, 'isArray:', Array.isArray(resp.synonyms));
        console.log('CursorIQ: Synonyms value (stringified):', JSON.stringify(resp.synonyms));
        console.log('CursorIQ: Synonyms value (direct):', resp.synonyms);
        console.log('CursorIQ: Synonyms length:', resp.synonyms?.length);
        
        // Save to recent searches
        saveToRecent(wordInfo.word);
        
        // Extract synonyms - ensure it's always an array
        let synonyms = [];
        if (resp.synonyms !== undefined && resp.synonyms !== null) {
          if (Array.isArray(resp.synonyms)) {
            synonyms = resp.synonyms.filter(s => s && typeof s === 'string' && s.trim());
            console.log('CursorIQ: Filtered synonyms array:', synonyms);
          } else if (typeof resp.synonyms === 'string') {
            synonyms = [resp.synonyms.trim()].filter(s => s);
          } else {
            synonyms = [String(resp.synonyms)].filter(s => s);
          }
        } else {
          console.warn('CursorIQ: WARNING - resp.synonyms is undefined or null!');
        }
        
        console.log('CursorIQ: Final synonyms array:', synonyms);
        console.log('CursorIQ: Final synonyms length:', synonyms.length);
        console.log('CursorIQ: About to call showTooltip with synonyms:', synonyms);
        console.log('CursorIQ: =======================================');
        
        // Check if this is person, organization, or place data
        if (resp.isPerson && resp.personData) {
          // Open hub and pass person data
          openHubWithPersonData(resp.personData, wordInfo.word);
        } else if (resp.isOrganization && resp.organizationData) {
          // Open hub and pass organization data
          openHubWithPersonData(resp.organizationData, wordInfo.word);
        } else if (resp.isPlace && resp.placeData) {
          // Open hub and pass place data
          openHubWithPersonData(resp.placeData, wordInfo.word);
        } else {
          showTooltip(wordInfo, resp.explanation || "No explanation returned.", false, synonyms, resp.pronunciation, resp.examples || []);
        }
        });
        
        // Add a timeout to detect if callback never fires
        setTimeout(() => {
          console.warn('Nimbus: WARNING - Callback may not have fired after 5 seconds');
        }, 5000);
      } catch (err) {
        console.error('Nimbus: Error sending message', err);
        if (err.message && err.message.includes('Extension context invalidated')) {
          showTooltip(wordInfo, "⚠️ Extension reloaded. Please refresh the page (F5).", true);
        } else {
          showTooltip(wordInfo, "Error: " + err.message, true);
        }
      }
    });
  }

  // Show upgrade prompt when subscription is not active
  function showUpgradePrompt(wordInfo) {
    const upgradeHtml = `
      <div style="text-align: center; padding: 20px;">
        <h3 style="margin: 0 0 10px 0; color: #1e3a8a;">Subscribe to Nimbus</h3>
        <p style="margin: 0 0 15px 0; color: #666;">Unlock unlimited word definitions for just £4.99/year</p>
        <button id="nimbus-upgrade-btn" style="background: #1e3a8a; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: 600;">
          Subscribe Now - £4.99/year
        </button>
      </div>
    `;
    
    showTooltip(wordInfo, upgradeHtml, false, []);
    
    // Add click handler for upgrade button
    setTimeout(() => {
      const upgradeBtn = document.getElementById('nimbus-upgrade-btn');
      if (upgradeBtn) {
        upgradeBtn.addEventListener('click', () => {
          // Launch Chrome payment flow
          if (chrome && chrome.payments && chrome.payments.purchase) {
            chrome.payments.purchase({
              sku: SUBSCRIPTION_ID
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.error('Nimbus: Purchase error:', chrome.runtime.lastError);
                showTooltip(wordInfo, "Purchase failed. Please try again.", true);
                return;
              }
              
              if (response && response.responseCode === 0) {
                // Purchase successful, check subscription again
                checkSubscription().then(() => {
                  // Retry the word lookup
                  triggerExplain(wordInfo);
                });
              } else {
                showTooltip(wordInfo, "Purchase cancelled or failed.", true);
              }
            });
          } else {
            // Fallback: open extension popup or options page
            chrome.runtime.sendMessage({ action: 'openUpgrade' });
          }
        });
      }
    }, 100);
  }

  function showTooltip(wordInfo, text, isWarning=false, synonyms=[], pronunciation=null, examples=[]) {
    // Reset manually closed flag when showing new tooltip
    manuallyClosed = false;
    removeTooltip();
    currentSynonyms = synonyms;
    
    // Load settings (refresh in case they changed)
    loadModalSettings();

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cursoriq-tooltip';
    if (isWarning) tooltipEl.classList.add('warning');
    
    // Make entire modal draggable if enabled
    if (modalSettings.draggable || modalSettings.placement === 'custom') {
      tooltipEl.style.cursor = 'move';
      
      let startX, startY, initialX, initialY;
      
      // Make modal draggable by clicking anywhere on it (but not on interactive elements)
      tooltipEl.addEventListener('mousedown', (e) => {
        // Don't start drag if clicking on buttons, links, or interactive elements
        if (e.target.tagName === 'BUTTON' || 
            e.target.tagName === 'A' || 
            e.target.closest('button') || 
            e.target.closest('a') ||
            e.target.closest('.cursoriq-synonym-tag') ||
            e.target.closest('.cursoriq-explanation') ||
            e.target.closest('.cursoriq-example-item') ||
            e.target.closest('.cursoriq-examples-container')) {
          return;
        }
        
        // Don't start drag if user is selecting text
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        tooltipEl.style.cursor = 'grabbing';
        
        const rect = tooltipEl.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        initialX = rect.left;
        initialY = rect.top;
        
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', stopDrag);
      });
      
      function handleDrag(e) {
        if (!isDragging) return;
        e.preventDefault();
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        const newX = initialX + deltaX;
        const newY = initialY + deltaY;
        
        // Keep modal within viewport
        const maxX = window.innerWidth - tooltipEl.offsetWidth;
        const maxY = window.innerHeight - tooltipEl.offsetHeight;
        
        const finalX = Math.max(0, Math.min(newX, maxX));
        const finalY = Math.max(0, Math.min(newY, maxY));
        
        tooltipEl.style.left = finalX + 'px';
        tooltipEl.style.top = finalY + 'px';
        tooltipEl.style.position = 'fixed';
        tooltipEl.style.transform = 'none';
        tooltipEl.style.margin = '0';
      }
      
      function stopDrag() {
        isDragging = false;
        tooltipEl.style.cursor = 'move';
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', stopDrag);
        
        // Save position only if placement is set to 'custom'
        // This way, dragging only affects position when user explicitly wants custom placement
        if (tooltipEl && tooltipEl.style.position === 'fixed' && modalSettings.placement === 'custom') {
          const savedPos = {
            x: parseInt(tooltipEl.style.left) || 0,
            y: parseInt(tooltipEl.style.top) || 0
          };
          chrome.storage.local.set({ 
            modalPosition: savedPos
          });
        }
      }
    }

    // Close button - positioned in top right corner, halfway out
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cursoriq-close-btn';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Mark as manually closed BEFORE clearing selection
      manuallyClosed = true;
      // Clear any pending timers
      if (selectionTimer) {
        clearTimeout(selectionTimer);
        selectionTimer = null;
      }
      // Clear the text selection
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
      // Remove tooltip
      removeTooltip();
    });
    tooltipEl.appendChild(closeBtn);

    // Header with word and copy button
    const header = document.createElement('div');
    header.className = 'cursoriq-header';
    
    const wordContainer = document.createElement('div');
    wordContainer.style.display = 'flex';
    wordContainer.style.alignItems = 'center';
    wordContainer.style.gap = '8px';
    
    const wordWrapper = document.createElement('div');
    wordWrapper.style.display = 'flex';
    wordWrapper.style.flexDirection = 'column';
    wordWrapper.style.gap = '4px';
    
    const wordSpan = document.createElement('span');
    wordSpan.className = 'cursoriq-word';
    wordSpan.textContent = currentWord || wordInfo.word;
    wordWrapper.appendChild(wordSpan);
    
    // Phonetic breakdown (pronunciation) - only show if setting enabled
    if (modalSettings.showPhonetic && pronunciation) {
      const phoneticSpan = document.createElement('span');
      phoneticSpan.className = 'cursoriq-phonetic';
      phoneticSpan.textContent = pronunciation;
      wordWrapper.appendChild(phoneticSpan);
    }
    
    wordContainer.appendChild(wordWrapper);
    
    // Button container for TTS and Copy buttons - stack them together
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.alignItems = 'center';
    buttonContainer.style.gap = '6px';
    buttonContainer.style.flexShrink = '0';
    buttonContainer.style.marginLeft = 'auto';
    
    // Text-to-speech button
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'cursoriq-tts-btn';
    ttsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"></path></svg>';
    ttsBtn.setAttribute('aria-label', 'Pronounce word');
    ttsBtn.setAttribute('title', 'Pronounce word');
    ttsBtn.style.cssText = 'width: 28px; height: 28px; padding: 0; background: transparent; border: none; color: #64748b; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0;';
    ttsBtn.addEventListener('mouseenter', () => {
      ttsBtn.style.opacity = '1';
      ttsBtn.style.color = '#475569';
      ttsBtn.style.transform = 'scale(1.1)';
    });
    ttsBtn.addEventListener('mouseleave', () => {
      if (!ttsBtn.classList.contains('playing')) {
        ttsBtn.style.opacity = '0.7';
        ttsBtn.style.color = '#64748b';
        ttsBtn.style.transform = 'scale(1)';
      }
    });
    ttsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      if (ttsBtn.classList.contains('playing')) {
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        ttsBtn.classList.remove('playing');
        ttsBtn.style.color = '#64748b';
        ttsBtn.style.transform = 'scale(1)';
        return;
      }
      
      ttsBtn.classList.add('playing');
      ttsBtn.style.color = '#1e3a8a';
      ttsBtn.style.opacity = '1';
      ttsBtn.style.transform = 'scale(1.15)';
      
      const wordToSpeak = currentWord || wordInfo.word;
      
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(wordToSpeak);
        
        chrome.storage.local.get(['settings'], (result) => {
          const lang = result.settings?.dictionaryLanguage || 'en';
          const langMap = {
            'en': 'en-US', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE', 'it': 'it-IT',
            'pt': 'pt-PT', 'ru': 'ru-RU', 'ja': 'ja-JP', 'zh': 'zh-CN', 'ko': 'ko-KR',
            'ar': 'ar-SA', 'hi': 'hi-IN', 'nl': 'nl-NL', 'sv': 'sv-SE', 'pl': 'pl-PL'
          };
          utterance.lang = langMap[lang] || 'en-US';
          
          utterance.onend = () => {
            ttsBtn.classList.remove('playing');
            ttsBtn.style.color = '#64748b';
            ttsBtn.style.opacity = '0.7';
            ttsBtn.style.transform = 'scale(1)';
          };
          
          utterance.onerror = () => {
            ttsBtn.classList.remove('playing');
            ttsBtn.style.color = '#64748b';
            ttsBtn.style.opacity = '0.7';
            ttsBtn.style.transform = 'scale(1)';
          };
          
          window.speechSynthesis.speak(utterance);
        });
      } else {
        console.warn('CursorIQ: Text-to-speech not supported');
        ttsBtn.classList.remove('playing');
        ttsBtn.style.color = '#64748b';
        ttsBtn.style.transform = 'scale(1)';
      }
    });
    buttonContainer.appendChild(ttsBtn);
    
    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cursoriq-copy-btn';
    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyBtn.setAttribute('aria-label', 'Copy word');
    copyBtn.setAttribute('title', 'Copy word');
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const wordToCopy = currentWord || wordInfo.word;
      
      // Add click animation
      copyBtn.classList.add('copied');
      
      try {
        await navigator.clipboard.writeText(wordToCopy);
      } catch (err) {
        console.error('CursorIQ: Failed to copy word', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = wordToCopy;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (e) {
          console.error('CursorIQ: Fallback copy failed', e);
        }
        document.body.removeChild(textArea);
      }
      
      // Remove animation class after transition
      setTimeout(() => {
        copyBtn.classList.remove('copied');
      }, 300);
    });
    buttonContainer.appendChild(copyBtn);
    
    wordContainer.appendChild(buttonContainer);
    
    header.appendChild(wordContainer);
    tooltipEl.appendChild(header);

    // Main explanation text container
    const explanationContainer = document.createElement('div');
    explanationContainer.style.position = 'relative';
    explanationContainer.style.padding = '0 18px 16px';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'cursoriq-explanation';
    textDiv.textContent = text;
    textDiv.style.userSelect = 'text';
    textDiv.style.webkitUserSelect = 'text';
    textDiv.style.mozUserSelect = 'text';
    textDiv.style.msUserSelect = 'text';
    textDiv.style.cursor = 'text';
    textDiv.style.padding = '0 36px 0 0'; // Add right padding to prevent text from going under copy button
    textDiv.style.margin = '0';
    explanationContainer.appendChild(textDiv);
    
    // Add copy button for explanation text
    const copyExplanationBtn = document.createElement('button');
    copyExplanationBtn.className = 'cursoriq-copy-explanation-btn';
    copyExplanationBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>';
    copyExplanationBtn.setAttribute('aria-label', 'Copy explanation');
    copyExplanationBtn.setAttribute('title', 'Copy explanation');
    copyExplanationBtn.style.cssText = 'position: absolute; top: 0; right: 18px; width: 24px; height: 24px; padding: 0; background: rgba(241, 245, 249, 0.8); border: 1px solid rgba(226, 232, 240, 0.8); border-radius: 6px; color: #64748b; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: all 0.2s ease; z-index: 10;';
    copyExplanationBtn.addEventListener('mouseenter', () => {
      copyExplanationBtn.style.opacity = '1';
      copyExplanationBtn.style.background = 'rgba(241, 245, 249, 1)';
      copyExplanationBtn.style.borderColor = '#cbd5e1';
    });
    copyExplanationBtn.addEventListener('mouseleave', () => {
      if (!copyExplanationBtn.classList.contains('copied')) {
        copyExplanationBtn.style.opacity = '0.7';
        copyExplanationBtn.style.background = 'rgba(241, 245, 249, 0.8)';
        copyExplanationBtn.style.borderColor = 'rgba(226, 232, 240, 0.8)';
      }
    });
      copyExplanationBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      copyExplanationBtn.classList.add('copied');
      copyExplanationBtn.style.color = '#10b981';
      copyExplanationBtn.style.opacity = '1';
      
      // Get current text from the explanation div by querying the DOM
      const explanationDivCurrent = tooltipEl.querySelector('.cursoriq-explanation');
      const currentText = explanationDivCurrent ? explanationDivCurrent.textContent.trim() : text;
      
      console.log('CursorIQ: Copying explanation text:', currentText.substring(0, 50) + '...');
      
      try {
        await navigator.clipboard.writeText(currentText);
      } catch (err) {
        console.error('CursorIQ: Failed to copy explanation', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = currentText;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (e) {
          console.error('CursorIQ: Fallback copy failed', e);
        }
        document.body.removeChild(textArea);
      }
      
      setTimeout(() => {
        copyExplanationBtn.classList.remove('copied');
        copyExplanationBtn.style.color = '#64748b';
        copyExplanationBtn.style.opacity = '0.7';
      }, 2000);
    });
    explanationContainer.appendChild(copyExplanationBtn);
    tooltipEl.appendChild(explanationContainer);

    // Examples section (if available and setting enabled)
    if (modalSettings.showExamples && examples && Array.isArray(examples) && examples.length > 0) {
      const examplesDiv = document.createElement('div');
      examplesDiv.className = 'cursoriq-examples-container';
      const examplesLabel = document.createElement('div');
      examplesLabel.className = 'cursoriq-examples-label';
      examplesLabel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Examples';
      examplesDiv.appendChild(examplesLabel);
      
      const examplesList = document.createElement('div');
      examplesList.className = 'cursoriq-examples-list';
      examples.forEach(example => {
        const exampleItem = document.createElement('div');
        exampleItem.className = 'cursoriq-example-item';
        exampleItem.textContent = example;
        examplesList.appendChild(exampleItem);
      });
      examplesDiv.appendChild(examplesList);
      tooltipEl.appendChild(examplesDiv);
    }

    // Synonyms section
    console.log('CursorIQ: showTooltip called with synonyms:', synonyms);
    console.log('CursorIQ: synonyms type:', typeof synonyms, 'isArray:', Array.isArray(synonyms), 'length:', synonyms?.length);
    if (synonyms && Array.isArray(synonyms) && synonyms.length > 0) {
      console.log('CursorIQ: Rendering synonyms section with', synonyms.length, 'synonyms');
      const synonymsDiv = document.createElement('div');
      synonymsDiv.className = 'cursoriq-synonyms-container';
      const synonymsLabel = document.createElement('div');
      synonymsLabel.className = 'cursoriq-synonyms-label';
      synonymsLabel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg> Synonyms';
      synonymsDiv.appendChild(synonymsLabel);

      const synonymsScroll = document.createElement('div');
      synonymsScroll.className = 'cursoriq-synonyms-scroll';
      synonyms.forEach(synonym => {
        const tag = document.createElement('span');
        tag.className = 'cursoriq-synonym-tag';
        tag.textContent = synonym;
        tag.addEventListener('click', (e) => {
          e.stopPropagation();
          // Replace current tooltip content instead of opening new modal
          replaceTooltipWithSynonym(synonym);
        });
        synonymsScroll.appendChild(tag);
      });
      synonymsDiv.appendChild(synonymsScroll);
      tooltipEl.appendChild(synonymsDiv);
    } else {
      console.log('CursorIQ: No synonyms to display');
    }

    // Action buttons container - bottom right icons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'cursoriq-actions';

    // Favorite button - icon only
    const favBtn = document.createElement('button');
    favBtn.className = 'cursoriq-fav-btn-icon';
    favBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    favBtn.setAttribute('aria-label', 'Add to favorites');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(currentWord || wordInfo.word);
      updateFavoriteButtonIcon(favBtn, currentWord || wordInfo.word);
    });
    actionsDiv.appendChild(favBtn);

    // Search button - icon only
    const searchBtn = document.createElement('button');
    searchBtn.className = 'cursoriq-search-btn-icon';
    searchBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>';
    searchBtn.setAttribute('aria-label', 'Search');
    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(currentWord || wordInfo.word)}`;
      window.open(searchUrl, '_blank');
    });
    actionsDiv.appendChild(searchBtn);
    tooltipEl.appendChild(actionsDiv);
    
    // Update favorite button state
    updateFavoriteButtonIcon(favBtn, currentWord || wordInfo.word);

    document.body.appendChild(tooltipEl);

    // Position tooltip based on settings
    positionTooltip(wordInfo);
  }
  
  // Show email modal (simplified version for email addresses)
  function showEmailModal(email, range) {
    manuallyClosed = false;
    removeTooltip();
    
    // Load settings for positioning
    loadModalSettings();
    
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cursoriq-tooltip cursoriq-email-modal';
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cursoriq-close-btn';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      manuallyClosed = true;
      if (selectionTimer) {
        clearTimeout(selectionTimer);
        selectionTimer = null;
      }
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
      removeTooltip();
    });
    tooltipEl.appendChild(closeBtn);
    
    // Header with email
    const header = document.createElement('div');
    header.className = 'cursoriq-header';
    
    const emailContainer = document.createElement('div');
    emailContainer.style.display = 'flex';
    emailContainer.style.alignItems = 'center';
    emailContainer.style.gap = '8px';
    
    const emailSpan = document.createElement('span');
    emailSpan.className = 'cursoriq-word';
    emailSpan.textContent = email;
    emailContainer.appendChild(emailSpan);
    
    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cursoriq-copy-btn';
    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyBtn.setAttribute('aria-label', 'Copy email');
    copyBtn.setAttribute('title', 'Copy email');
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(email);
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = email;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (e) {
          console.error('CursorIQ: Fallback copy failed', e);
        }
        document.body.removeChild(textArea);
      }
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      }, 300);
    });
    emailContainer.appendChild(copyBtn);
    
    header.appendChild(emailContainer);
    tooltipEl.appendChild(header);
    
    // Action buttons container - bottom right icons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'cursoriq-actions';
    
    // Search button - icon only
    const searchBtn = document.createElement('button');
    searchBtn.className = 'cursoriq-search-btn-icon';
    searchBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>';
    searchBtn.setAttribute('aria-label', 'Search email');
    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(email)}`;
      window.open(searchUrl, '_blank');
    });
    actionsDiv.appendChild(searchBtn);
    
    tooltipEl.appendChild(actionsDiv);
    
    // Append to body
    document.body.appendChild(tooltipEl);
    
    // Position the email modal
    positionEmailModal(email, range);
  }
  
  // Position email modal (similar to positionTooltip but simpler)
  function positionEmailModal(email, range) {
    if (!tooltipEl || !range) return;
    
    const rect = range.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left, top;
    
    // Simple positioning - prefer above, then below, then center
    const spaceAbove = rect.top;
    const spaceBelow = viewportHeight - rect.bottom;
    
    if (spaceAbove > tooltipRect.height + 20) {
      // Position above
      top = rect.top - tooltipRect.height - 12;
      left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    } else if (spaceBelow > tooltipRect.height + 20) {
      // Position below
      top = rect.bottom + 12;
      left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    } else {
      // Center on screen
      left = (viewportWidth / 2) - (tooltipRect.width / 2);
      top = (viewportHeight / 2) - (tooltipRect.height / 2);
    }
    
    // Keep within viewport
    left = Math.max(12, Math.min(left, viewportWidth - tooltipRect.width - 12));
    top = Math.max(12, Math.min(top, viewportHeight - tooltipRect.height - 12));
    
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
    tooltipEl.style.position = 'fixed';
    tooltipEl.style.display = 'block';
    tooltipEl.style.visibility = 'visible';
    tooltipEl.style.opacity = '1';
  }
  
  // Position tooltip based on placement setting
  function positionTooltip(wordInfo) {
    // Only use saved position if placement is explicitly set to 'custom'
    // Otherwise, always use placement-based positioning for new word selections
    chrome.storage.local.get(['modalPosition'], (result) => {
      // Only use saved position if placement is 'custom'
      if (modalSettings.placement === 'custom' && result.modalPosition && result.modalPosition.x && result.modalPosition.y) {
        tooltipEl.style.position = 'fixed';
        tooltipEl.style.left = result.modalPosition.x + 'px';
        tooltipEl.style.top = result.modalPosition.y + 'px';
        tooltipEl.style.transform = 'none';
        tooltipEl.style.margin = '0';
        tooltipEl.style.zIndex = '2147483647';
        tooltipEl.style.display = 'block';
        tooltipEl.style.visibility = 'visible';
        tooltipEl.style.opacity = '1';
        return; // Skip normal positioning if using saved position
      }
      
      // Normal placement-based positioning (always use for non-custom placements)
      let rect = null;
      try { 
        if (wordInfo && wordInfo.range) {
          rect = wordInfo.range.getBoundingClientRect();
        }
      } catch(e){ 
        rect = null;
      }
      
      if (!rect) {
        // Fallback to selection
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          try {
            rect = selection.getRangeAt(0).getBoundingClientRect();
          } catch(e) {}
        }
      }
      
      if (!rect) {
        rect = { left: 100, top: 100, height: 20, width: 40 };
      }
      
      performPlacementPositioning(wordInfo, rect);
    });
  }
  
  function performPlacementPositioning(wordInfo, rect) {
    const padding = 12;
    const tooltipWidth = 420; // max-width from CSS
    const tooltipHeight = 250; // estimated height
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left, top;
    
    // Calculate position based on placement setting
    switch (modalSettings.placement) {
      case 'top':
        left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        top = rect.top - tooltipHeight - padding;
        break;
      case 'bottom':
        left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        top = rect.bottom + padding;
        break;
      case 'left':
        left = rect.left - tooltipWidth - padding;
        top = rect.top + (rect.height / 2) - (tooltipHeight / 2);
        break;
      case 'right':
        left = rect.right + padding;
        top = rect.top + (rect.height / 2) - (tooltipHeight / 2);
        break;
      case 'center':
        left = (viewportWidth / 2) - (tooltipWidth / 2);
        top = (viewportHeight / 2) - (tooltipHeight / 2);
        break;
      case 'custom':
        // For custom, default to center - user can drag to preferred position
        // Saved position will be loaded in positionTooltip function
        left = (viewportWidth / 2) - (tooltipWidth / 2);
        top = (viewportHeight / 2) - (tooltipHeight / 2);
        break;
      case 'intuitive':
      default:
        // Default behavior: below selection, centered horizontally
        left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
        top = rect.bottom + padding;
        
        // If no room below, put it above
        if (top + tooltipHeight > viewportHeight - 10) {
          top = rect.top - tooltipHeight - padding;
          if (top < 10) {
            // Still no room, center vertically
            top = (viewportHeight / 2) - (tooltipHeight / 2);
          }
        }
        break;
    }
    
    // Keep tooltip on screen - adjust if off-screen
    // Horizontal positioning - ensure it's visible
    if (left < 10) {
      left = 10;
    } else if (left + tooltipWidth > viewportWidth - 10) {
      left = viewportWidth - tooltipWidth - 10;
    }
    
    // Vertical positioning - ensure it's visible
    if (top < 10) {
      top = 10;
    } else if (top + tooltipHeight > viewportHeight - 10) {
      top = viewportHeight - tooltipHeight - 10;
    }
    
    // Use fixed positioning (relative to viewport, not document)
    tooltipEl.style.position = 'fixed';
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.zIndex = '2147483647';
    
    console.log('CursorIQ: Tooltip positioned at', left, top, 'viewport:', viewportWidth, viewportHeight, 'rect:', rect);
    
    // Force visibility - make absolutely sure it's visible
    tooltipEl.style.display = 'block';
    tooltipEl.style.visibility = 'visible';
    tooltipEl.style.opacity = '1';
    tooltipEl.style.pointerEvents = 'auto';
    
    // Force visibility check and fix if needed
    setTimeout(() => {
      if (tooltipEl && tooltipEl.parentNode) {
        const tooltipRect = tooltipEl.getBoundingClientRect();
        const styles = window.getComputedStyle(tooltipEl);
        const isVisible = tooltipRect.width > 0 && tooltipRect.height > 0;
        
        console.log('CursorIQ: Tooltip check:', {
          exists: !!tooltipEl,
          inDOM: !!tooltipEl.parentNode,
          visible: isVisible,
          position: { left: tooltipRect.left, top: tooltipRect.top },
          size: { width: tooltipRect.width, height: tooltipRect.height },
          styles: {
            display: styles.display,
            visibility: styles.visibility,
            opacity: styles.opacity,
            zIndex: styles.zIndex
          }
        });
        
        // If tooltip has no size or is off-screen, force it visible
        if (!isVisible || tooltipRect.width === 0 || tooltipRect.height === 0) {
          console.error('CursorIQ: Tooltip not visible! Forcing...');
          tooltipEl.style.display = 'block';
          tooltipEl.style.visibility = 'visible';
          tooltipEl.style.opacity = '1';
          tooltipEl.style.left = `${(viewportWidth - tooltipWidth) / 2}px`;
          tooltipEl.style.top = `${(viewportHeight - tooltipHeight) / 2}px`;
        }
      } else {
        console.error('CursorIQ: Tooltip was removed before check!');
      }
    }, 100);

    // Don't remove on scroll immediately - wait a bit
    let scrollTimeout = null;
    document.addEventListener('scroll', () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        removeTooltip();
      }, 200);
    }, { once: false });
    
    // Keep tooltip visible - don't remove when clicking or hovering
    tooltipEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    
    tooltipEl.addEventListener('mouseenter', () => {
      // Clear any pending removal timers when hovering over tooltip
      if (selectionTimer) {
        clearTimeout(selectionTimer);
        selectionTimer = null;
      }
    });
  }

  function removeTooltip() {
    // Clear any pending timers
    if (selectionTimer) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }
    
    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
    }
    tooltipEl = null;
    currentWord = null;
    currentSynonyms = [];
    lastSelection = ''; // Reset so same word can be selected again
    
    // Clear text selection AFTER removing tooltip to avoid triggering events
    if (!manuallyClosed) {
      try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          selection.removeAllRanges();
        }
      } catch (e) {
        // Some sites may block selection clearing, that's okay
      }
    }
    
    // Reset manuallyClosed flag after a short delay to allow new selections
    setTimeout(() => {
      manuallyClosed = false;
    }, 500);
  }

  function toggleFavorite(word) {
    if (!word) return;
    
    try {
      if (!chrome || !chrome.storage) return;
      
      chrome.storage.local.get(['favorites'], (res) => {
        if (chrome.runtime.lastError) {
          console.warn('CursorIQ: Error getting favorites', chrome.runtime.lastError);
          return;
        }
        
        const favorites = res.favorites || [];
        const index = favorites.indexOf(word);
        let wasFavorited = index > -1;
        
        if (index > -1) {
          // Remove from favorites
          favorites.splice(index, 1);
          console.log('CursorIQ: Removed', word, 'from favorites');
        } else {
          // Add to favorites
          favorites.push(word);
          console.log('CursorIQ: Added', word, 'to favorites');
        }
        
        safeStorageSet({ favorites }, () => {
          // Update button after storage is saved
          const favBtn = tooltipEl?.querySelector('.cursoriq-fav-btn-icon');
          if (favBtn) {
            updateFavoriteButtonIcon(favBtn, word);
          }
        });
        
        // Also save to recent searches
        saveToRecent(word);
      });
    } catch (e) {
      console.warn('CursorIQ: Error toggling favorite', e);
    }
  }

  function updateFavoriteButton(btn, word) {
    if (!word || !btn) return;
    
    try {
      if (!chrome || !chrome.storage) return;
      
      chrome.storage.local.get(['favorites'], (res) => {
        if (chrome.runtime.lastError) return;
        
        const favorites = res.favorites || [];
        const isFavorited = favorites.includes(word);
        
        if (isFavorited) {
          btn.classList.add('favorited');
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Favorited';
        } else {
          btn.classList.remove('favorited');
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Favorite';
        }
      });
    } catch (e) {
      console.warn('CursorIQ: Error updating favorite button', e);
    }
  }

  function updateFavoriteButtonIcon(btn, word) {
    if (!word || !btn) return;
    
    try {
      if (!chrome || !chrome.storage) return;
      
      chrome.storage.local.get(['favorites'], (res) => {
        if (chrome.runtime.lastError) {
          console.warn('CursorIQ: Error getting favorites', chrome.runtime.lastError);
          return;
        }
        
        const favorites = res.favorites || [];
        const isFav = favorites.indexOf(word) > -1;
        
        console.log('CursorIQ: Updating favorite button for', word, 'isFav:', isFav);
        
        if (isFav) {
          btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
          btn.style.color = '#dc2626';
          btn.style.opacity = '1';
        } else {
          btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
          btn.style.color = '#64748b';
          btn.style.opacity = '0.7';
        }
      });
    } catch (e) {
      console.warn('CursorIQ: Error updating favorite button icon', e);
    }
  }

  function saveToRecent(word) {
    if (!word) return;
    
    try {
      // Check if we're in incognito mode - don't save if so
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
      
      // Send message to background to check incognito status
      chrome.runtime.sendMessage({ action: 'checkIncognito' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('CursorIQ: Error checking incognito status', chrome.runtime.lastError);
          // If we can't check, proceed anyway (safer to save than not)
        } else if (response && response.isIncognito) {
          console.log('CursorIQ: Incognito mode detected, not saving to recent');
          return;
        }
        
        // Not in incognito, proceed with saving
        if (!chrome || !chrome.storage) return;
        
        chrome.storage.local.get(['recentSearches'], (res) => {
          if (chrome.runtime.lastError) return;
          
          let recent = res.recentSearches || [];
          
          // Migrate old format (strings) to new format (objects with timestamp)
          if (recent.length > 0 && typeof recent[0] === 'string') {
            recent = recent.map(w => ({ word: w, timestamp: Date.now() }));
          }
          
          // Remove if already exists (check word property if object, or direct match if string)
          recent = recent.filter(item => {
            const itemWord = typeof item === 'string' ? item : item.word;
            return itemWord !== word;
          });
          
          // Add to front with timestamp
          recent.unshift({ word: word, timestamp: Date.now() });
          
          // Remove entries older than 3 days
          const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
          recent = recent.filter(item => {
            const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
            return timestamp > threeDaysAgo;
          });
          
          // Keep only last 50
          recent = recent.slice(0, 50);
          
          safeStorageSet({ recentSearches: recent });
        });
      });
    } catch (e) {
      console.warn('CursorIQ: Error saving to recent', e);
    }
  }

  function replaceTooltipWithSynonym(synonym) {
    if (!tooltipEl || !tooltipEl.parentNode) {
      // No tooltip exists, create a new one
      triggerExplain({ word: synonym, context: '', range: null, contextHash: 0 });
      return;
    }

    // Update current word
    currentWord = synonym;

    // Update header word
    const header = tooltipEl.querySelector('.cursoriq-header .cursoriq-word');
    if (header) {
      header.textContent = synonym;
    }

    // Update explanation text
    const explanationDiv = tooltipEl.querySelector('.cursoriq-explanation');
    if (explanationDiv) {
      explanationDiv.textContent = 'Loading explanation...';
      // Update copy button text reference if it exists
      const copyBtn = tooltipEl.querySelector('.cursoriq-copy-explanation-btn');
      if (copyBtn) {
        copyBtn.dataset.textToCopy = 'Loading explanation...';
      }
    }

    // Remove existing synonyms section
    const existingSynonyms = tooltipEl.querySelector('.cursoriq-synonyms-container');
    if (existingSynonyms) {
      existingSynonyms.remove();
    }

    // Update favorite button to reflect new word
    const favBtn = tooltipEl.querySelector('.cursoriq-fav-btn-icon');
    if (favBtn) {
      updateFavoriteButtonIcon(favBtn, synonym);
    }

    // Fetch explanation for synonym
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        if (explanationDiv) {
          explanationDiv.textContent = 'Extension context invalidated. Please refresh the page.';
          const copyBtn = tooltipEl.querySelector('.cursoriq-copy-explanation-btn');
          if (copyBtn) {
            copyBtn.dataset.textToCopy = 'Extension context invalidated. Please refresh the page.';
          }
        }
        return;
      }
      chrome.runtime.sendMessage({ type: 'explain', word: synonym, context: '' }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('CursorIQ: Error fetching synonym explanation:', chrome.runtime.lastError);
          if (explanationDiv) {
            const errorText = 'Error: ' + chrome.runtime.lastError.message;
            explanationDiv.textContent = errorText;
            const copyBtn = tooltipEl.querySelector('.cursoriq-copy-explanation-btn');
            if (copyBtn) {
              copyBtn.dataset.textToCopy = errorText;
            }
          }
          return;
        }
        console.log('CursorIQ: Got response for synonym:', resp);
        if (resp && !resp.error) {
          if (explanationDiv) {
            const explanationText = resp.explanation || 'No explanation available.';
            explanationDiv.textContent = explanationText;
            // Update copy button text reference
            const copyBtn = tooltipEl.querySelector('.cursoriq-copy-explanation-btn');
            if (copyBtn) {
              copyBtn.dataset.textToCopy = explanationText;
            }
          }
          // Add synonyms if available
          const newSynonyms = Array.isArray(resp.synonyms) ? resp.synonyms : [];
          console.log('CursorIQ: Adding synonyms to tooltip:', newSynonyms);
          if (newSynonyms.length > 0) {
            addSynonymsToTooltip(newSynonyms);
          } else {
            console.log('CursorIQ: No synonyms to add for synonym');
          }
        } else {
          if (explanationDiv) {
            const errorText = resp?.error || 'Error loading explanation.';
            explanationDiv.textContent = errorText;
            // Update copy button text reference
            const copyBtn = tooltipEl.querySelector('.cursoriq-copy-explanation-btn');
            if (copyBtn) {
              copyBtn.dataset.textToCopy = errorText;
            }
          }
        }
      });
    } catch (e) {
      if (explanationDiv) {
        const errorText = 'Error: ' + (e.message || 'Unknown error');
        explanationDiv.textContent = errorText;
        const copyBtn = tooltipEl.querySelector('.cursoriq-copy-explanation-btn');
        if (copyBtn) {
          copyBtn.dataset.textToCopy = errorText;
        }
      }
    }
  }

  function addSynonymsToTooltip(synonyms) {
    console.log('CursorIQ: addSynonymsToTooltip called with:', synonyms);
    if (!tooltipEl) {
      console.log('CursorIQ: No tooltip element');
      return;
    }
    if (!synonyms || !Array.isArray(synonyms) || synonyms.length === 0) {
      console.log('CursorIQ: No valid synonyms to add');
      return;
    }

    console.log('CursorIQ: Creating synonyms section with', synonyms.length, 'synonyms');

    // Create synonyms section
    const synonymsDiv = document.createElement('div');
    synonymsDiv.className = 'cursoriq-synonyms-container';
    const synonymsLabel = document.createElement('div');
    synonymsLabel.className = 'cursoriq-synonyms-label';
    synonymsLabel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg> Synonyms';
    synonymsDiv.appendChild(synonymsLabel);

    const synonymsScroll = document.createElement('div');
    synonymsScroll.className = 'cursoriq-synonyms-scroll';
    synonyms.forEach(synonym => {
      if (!synonym || typeof synonym !== 'string') return;
      const tag = document.createElement('span');
      tag.className = 'cursoriq-synonym-tag';
      tag.textContent = synonym;
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('CursorIQ: Synonym clicked:', synonym);
        replaceTooltipWithSynonym(synonym);
      });
      synonymsScroll.appendChild(tag);
    });
    synonymsDiv.appendChild(synonymsScroll);
    
    // Insert before actions div
    const actionsDiv = tooltipEl.querySelector('.cursoriq-actions');
    if (actionsDiv) {
      tooltipEl.insertBefore(synonymsDiv, actionsDiv);
    } else {
      tooltipEl.appendChild(synonymsDiv);
    }
    
    console.log('CursorIQ: Synonyms section added to tooltip');
  }

  function hashString(s) {
    if (!s || typeof s !== 'string') {
      return 0;
    }
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  // Use beforeunload instead of unload (more compatible)
  // But only if allowed - wrap in try-catch
  try {
    window.addEventListener('beforeunload', () => { 
      removeTooltip(); 
    }, { passive: true });
  } catch (e) {
    // Ignore if not allowed by permissions policy
    console.log('CursorIQ: beforeunload listener not allowed on this page');
  }

  // Test: Log when ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('CursorIQ: DOM ready');
    });
  } else {
    console.log('CursorIQ: DOM already ready');
  }
  
  // Load modal settings from storage
  function loadModalSettings() {
    chrome.storage.local.get(['settings'], (result) => {
      if (result.settings) {
        modalSettings.placement = result.settings.modalPlacement || 'intuitive';
        modalSettings.draggable = result.settings.modalDraggable !== false;
        modalSettings.showPhonetic = result.settings.showPhonetic !== false;
        modalSettings.showExamples = result.settings.showExamples !== false;
      }
    });
  }
  
  // Listen for settings updates from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'settingsUpdated' && message.settings) {
      modalSettings.placement = message.settings.modalPlacement || 'intuitive';
      modalSettings.draggable = message.settings.modalDraggable !== false;
      modalSettings.showPhonetic = message.settings.showPhonetic !== false;
      modalSettings.showExamples = message.settings.showExamples !== false;
      console.log('Nimbus: Settings updated', modalSettings);
    }
  });
  
  // Load settings on initialization
  loadModalSettings();

  // Open hub with person data
  function openHubWithPersonData(personData, searchTerm) {
    console.log('Nimbus: Opening hub with person data for:', searchTerm);
    console.log('Nimbus: Person data image:', personData.image ? 'YES - ' + personData.image : 'NO IMAGE');
    console.log('Nimbus: Full personData:', personData);
    
    // Store person data in chrome.storage for popup to retrieve
    chrome.storage.local.set({
      pendingSearch: {
        type: 'person',
        term: searchTerm,
        data: personData
      }
    }, () => {
      // Try to open the popup - note: this may not work if popup is already open
      // The popup will check for pendingSearch on load
      chrome.runtime.sendMessage({
        action: 'openPopup'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Nimbus: Could not open popup automatically, user will need to open manually');
        }
      });
    });
  }

  // Show person bio tooltip with image and details (kept for backward compatibility)
  function showPersonTooltip(wordInfo, personData) {
    // Remove any existing tooltip
    removeTooltip();

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cursoriq-tooltip cursoriq-person-tooltip';
    tooltipEl.style.cssText = 'max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;';
    
    // Make modal draggable if enabled
    if (modalSettings.draggable || modalSettings.placement === 'custom') {
      tooltipEl.style.cursor = 'move';
      let startX, startY, initialX, initialY;
      
      tooltipEl.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.closest('button') || e.target.closest('a')) {
          return;
        }
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        tooltipEl.style.cursor = 'grabbing';
        const rect = tooltipEl.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        initialX = rect.left;
        initialY = rect.top;
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', stopDrag);
      });
      
      function handleDrag(e) {
        if (!isDragging) return;
        e.preventDefault();
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const newX = initialX + deltaX;
        const newY = initialY + deltaY;
        const maxX = window.innerWidth - tooltipEl.offsetWidth;
        const maxY = window.innerHeight - tooltipEl.offsetHeight;
        const finalX = Math.max(0, Math.min(newX, maxX));
        const finalY = Math.max(0, Math.min(newY, maxY));
        tooltipEl.style.left = finalX + 'px';
        tooltipEl.style.top = finalY + 'px';
        tooltipEl.style.position = 'fixed';
        tooltipEl.style.transform = 'none';
        tooltipEl.style.margin = '0';
      }
      
      function stopDrag() {
        isDragging = false;
        tooltipEl.style.cursor = 'move';
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', stopDrag);
      }
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cursoriq-close-btn';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      manuallyClosed = true;
      if (selectionTimer) {
        clearTimeout(selectionTimer);
        selectionTimer = null;
      }
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
      removeTooltip();
    });
    tooltipEl.appendChild(closeBtn);

    // Person image - fixed at top
    if (personData.image) {
      const imageContainer = document.createElement('div');
      imageContainer.style.cssText = 'width: 100%; max-height: 200px; overflow: hidden; border-radius: 8px 8px 0 0; background: #f1f5f9; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
      const img = document.createElement('img');
      img.src = personData.image;
      img.alt = personData.name;
      img.style.cssText = 'width: 100%; height: auto; max-height: 200px; object-fit: cover; display: block;';
      img.onerror = () => {
        imageContainer.style.display = 'none';
      };
      imageContainer.appendChild(img);
      tooltipEl.appendChild(imageContainer);
    }

    // Person header with name - fixed
    const header = document.createElement('div');
    header.className = 'cursoriq-header';
    header.style.cssText = 'padding: 16px 18px; border-bottom: 1px solid rgba(226, 232, 240, 0.8); flex-shrink: 0;';
    
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between;';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'cursoriq-word';
    nameSpan.textContent = personData.name;
    nameSpan.style.cssText = 'font-size: 20px; font-weight: 700; color: #1e3a8a;';
    nameDiv.appendChild(nameSpan);
    
    // Copy button for name
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cursoriq-copy-btn';
    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyBtn.setAttribute('aria-label', 'Copy name');
    copyBtn.setAttribute('title', 'Copy name');
    copyBtn.style.cssText = 'width: 28px; height: 28px; padding: 0; background: rgba(241, 245, 249, 0.8); border: 1px solid rgba(226, 232, 240, 0.8); border-radius: 6px; color: #64748b; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: all 0.2s ease;';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      copyBtn.classList.add('copied');
      try {
        await navigator.clipboard.writeText(personData.name);
      } catch (err) {
        console.error('Failed to copy name', err);
      }
      setTimeout(() => copyBtn.classList.remove('copied'), 300);
    });
    nameDiv.appendChild(copyBtn);
    header.appendChild(nameDiv);
    tooltipEl.appendChild(header);

    // Person details container - scrollable
    const detailsContainer = document.createElement('div');
    detailsContainer.style.cssText = 'padding: 16px 18px; overflow-y: auto; overflow-x: hidden; flex: 1; min-height: 0;';
    
    // Bio/Summary
    if (personData.bio || personData.summary) {
      const bioDiv = document.createElement('div');
      bioDiv.className = 'cursoriq-explanation';
      bioDiv.textContent = personData.bio || personData.summary;
      bioDiv.style.cssText = 'margin-bottom: 16px; line-height: 1.6; color: #334155;';
      detailsContainer.appendChild(bioDiv);
    }

    // Person metadata
    const metadataDiv = document.createElement('div');
    metadataDiv.style.cssText = 'display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #64748b; margin-bottom: 16px;';
    
    if (personData.birthDate) {
      const birthDiv = document.createElement('div');
      birthDiv.innerHTML = `<strong style="color: #1e3a8a;">Born:</strong> ${personData.birthDate}`;
      metadataDiv.appendChild(birthDiv);
    }
    
    if (personData.occupation) {
      const occDiv = document.createElement('div');
      occDiv.innerHTML = `<strong style="color: #1e3a8a;">Occupation:</strong> ${personData.occupation}`;
      metadataDiv.appendChild(occDiv);
    }
    
    if (personData.nationality) {
      const natDiv = document.createElement('div');
      natDiv.innerHTML = `<strong style="color: #1e3a8a;">Nationality:</strong> ${personData.nationality}`;
      metadataDiv.appendChild(natDiv);
    }
    
    if (metadataDiv.children.length > 0) {
      detailsContainer.appendChild(metadataDiv);
    }

    // Wikipedia link
    if (personData.wikipediaUrl) {
      const wikiLink = document.createElement('a');
      wikiLink.href = personData.wikipediaUrl;
      wikiLink.target = '_blank';
      wikiLink.rel = 'noopener noreferrer';
      wikiLink.textContent = 'Read more on Wikipedia';
      wikiLink.style.cssText = 'display: inline-block; margin-bottom: 16px; color: #1e3a8a; text-decoration: none; font-size: 13px; font-weight: 600; border-bottom: 1px solid #1e3a8a;';
      wikiLink.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      detailsContainer.appendChild(wikiLink);
    }

    // Recent News section
    if (personData.newsArticles && personData.newsArticles.length > 0) {
      const newsSection = document.createElement('div');
      newsSection.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(226, 232, 240, 0.8);';
      
      const newsTitle = document.createElement('div');
      newsTitle.style.cssText = 'font-size: 16px; font-weight: 700; color: #1e3a8a; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;';
      newsTitle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path><rect x="11" y="7" width="10" height="5" rx="1"></rect><rect x="11" y="14" width="7" height="5" rx="1"></rect></svg> Recent News';
      newsSection.appendChild(newsTitle);
      
      const newsList = document.createElement('div');
      newsList.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';
      
      personData.newsArticles.forEach((article, index) => {
        const newsItem = document.createElement('div');
        newsItem.style.cssText = 'padding: 12px; background: rgba(241, 245, 249, 0.5); border-radius: 8px; border: 1px solid rgba(226, 232, 240, 0.5); transition: all 0.2s ease; cursor: pointer;';
        
        newsItem.addEventListener('mouseenter', () => {
          newsItem.style.background = 'rgba(241, 245, 249, 0.8)';
          newsItem.style.borderColor = 'rgba(30, 58, 138, 0.3)';
          newsItem.style.transform = 'translateY(-1px)';
        });
        
        newsItem.addEventListener('mouseleave', () => {
          newsItem.style.background = 'rgba(241, 245, 249, 0.5)';
          newsItem.style.borderColor = 'rgba(226, 232, 240, 0.5)';
          newsItem.style.transform = 'translateY(0)';
        });
        
        const articleTitle = document.createElement('div');
        articleTitle.style.cssText = 'font-weight: 600; color: #1e3a8a; font-size: 14px; margin-bottom: 6px; line-height: 1.4;';
        articleTitle.textContent = article.title;
        newsItem.appendChild(articleTitle);
        
        if (article.description) {
          const articleDesc = document.createElement('div');
          articleDesc.style.cssText = 'font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 8px;';
          articleDesc.textContent = article.description;
          newsItem.appendChild(articleDesc);
        }
        
        if (article.date) {
          const articleDate = document.createElement('div');
          articleDate.style.cssText = 'font-size: 11px; color: #94a3b8; margin-top: 6px;';
          // Format date
          try {
            const date = new Date(article.date);
            articleDate.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          } catch (e) {
            articleDate.textContent = article.date;
          }
          newsItem.appendChild(articleDate);
        }
        
        newsItem.addEventListener('click', (e) => {
          e.stopPropagation();
          if (article.link) {
            window.open(article.link, '_blank', 'noopener,noreferrer');
          }
        });
        
        newsList.appendChild(newsItem);
      });
      
      newsSection.appendChild(newsList);
      detailsContainer.appendChild(newsSection);
    }

    tooltipEl.appendChild(detailsContainer);
    document.body.appendChild(tooltipEl);
    
    // Position the tooltip
    positionTooltip(tooltipEl, wordInfo);
    
    currentWord = personData.name;
  }

})();
