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
  let savedRange = null; // Store the selection range for tooltip positioning
  let modalSettings = {
    placement: 'intuitive',
    draggable: true,
    showPhonetic: true,
    showExamples: true
  };
  let isDragging = false;
  let isSelecting = false; // Track if user is actively selecting (mouse down + moving)
  let shiftKeyHeld = false; // If true, do not show tooltip — user may be extending selection
  let selectionStartTime = 0; // Track when selection started
  let mouseupSelectionTimeout = null; // Timeout after mouseup; cleared on mousedown so we only act after selection is really complete
  let iconModalTimer = null; // Timer for delayed icon-only modal
  let currentUtterance = null; // Current speech synthesis utterance
  let audioState = 'idle'; // 'idle', 'playing', 'paused'
  let pausedText = ''; // Text that was paused (for resume)
  let pasteToolbarEnabled = false;
  let pasteToolbarLastCopyAt = 0;
  let pasteToolbarTarget = null;
  let pasteToolbarEl = null;
  const PASTE_TOOLBAR_TIMEOUT_MS = 5 * 60 * 1000;

  // Function to find the best available voice for TTS (unified with popup.js)
  function getBestVoice(lang = 'en-US', voicePreference = 'auto') {
    if (!window.speechSynthesis) return null;
    
    // Ensure voices are loaded (they load asynchronously)
    let voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) {
      // Try to load voices if not already loaded
      window.speechSynthesis.getVoices();
      voices = window.speechSynthesis.getVoices();
    }
    if (!voices || voices.length === 0) return null;
    
    // Filter voices by language first
    const langCode = lang.split('-')[0];
    let matchingVoices = voices.filter(v => v.lang.startsWith(langCode));
    
    // If no exact language match, try broader match
    if (matchingVoices.length === 0) {
      matchingVoices = voices.filter(v => v.lang.includes(langCode));
    }
    
    // If still no match, use all voices
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

  function markExtensionCopy() {
    console.log('[PASTE] markExtensionCopy called');
    pasteToolbarEnabled = true;
    pasteToolbarLastCopyAt = Date.now();
    try {
      chrome.storage.local.set({ nimbusLastCopyAt: pasteToolbarLastCopyAt });
      chrome.runtime.sendMessage({ action: 'nimbusCopyAction', at: pasteToolbarLastCopyAt }, () => {});
      console.log('[PASTE] Copy state saved, timestamp:', pasteToolbarLastCopyAt);
    } catch (e) {
      console.error('[PASTE] Error saving copy state:', e);
    }
    // If user is already focused in an editable field, show immediately
    try {
      const active = document.activeElement;
      if (isEditableElement(active)) {
        console.log('[PASTE] Active element is editable, showing toolbar immediately');
        showPasteToolbar(active);
      }
    } catch (e) {
      console.error('[PASTE] Error checking active element:', e);
    }
  }

  // Track extension-initiated clipboard writes for paste toolbar
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => {
        console.log('[PASTE] clipboard.writeText intercepted');
        markExtensionCopy();
        return originalWriteText(text);
      };
    }
  } catch (e) {
    console.error('[PASTE] Error wrapping clipboard.writeText:', e);
  }

  // Also listen for copy events (catches execCommand('copy') and other methods)
  document.addEventListener('copy', (e) => {
    // Only mark if it's from a Nimbus copy button
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      // Check if copy was triggered by a Nimbus button
      const activeEl = document.activeElement;
      if (isNimbusCopyButton(activeEl) || activeEl?.closest('.cursoriq-copy-btn, .cursoriq-copy-explanation-btn, .cursoriq-summary-copy')) {
        console.log('[PASTE] Copy event from Nimbus button');
        markExtensionCopy();
      }
    }
  }, true);

  // Translate modal: from/to languages (matches background + Turkish)
  const TRANSLATE_LANGS = [
    { v: 'auto', l: 'Auto-detect' },
    { v: 'en', l: 'English' }, { v: 'es', l: 'Español' }, { v: 'fr', l: 'Français' }, { v: 'de', l: 'Deutsch' },
    { v: 'it', l: 'Italiano' }, { v: 'pt', l: 'Português' }, { v: 'ru', l: 'Русский' }, { v: 'ja', l: '日本語' },
    { v: 'zh', l: '中文' }, { v: 'ko', l: '한국어' }, { v: 'ar', l: 'العربية' }, { v: 'hi', l: 'हिन्दी' },
    { v: 'nl', l: 'Nederlands' }, { v: 'sv', l: 'Svenska' }, { v: 'pl', l: 'Polski' }, { v: 'tr', l: 'Türkçe' }
  ];
  const TRANSLATE_LANGS_TO = TRANSLATE_LANGS.filter((x) => x.v !== 'auto');

  function createTranslateModal(opts) {
    const { onTranslate, onCancel, defaultFrom = 'auto', defaultTo = 'en' } = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'cursoriq-translate-modal';

    const fromLbl = TRANSLATE_LANGS.find((x) => x.v === defaultFrom)?.l || 'Auto-detect';
    const toLbl = TRANSLATE_LANGS_TO.find((x) => x.v === defaultTo)?.l || 'English';

    const row1 = document.createElement('div');
    row1.className = 'cursoriq-translate-row';
    const label1 = document.createElement('label');
    label1.className = 'cursoriq-translate-label';
    label1.textContent = 'From';
    const fromDd = document.createElement('div');
    fromDd.className = 'cursoriq-translate-dropdown';
    fromDd.dataset.value = defaultFrom;
    const fromSel = document.createElement('div');
    fromSel.className = 'cursoriq-translate-dropdown-selected';
    const fromText = document.createElement('span');
    fromText.className = 'cursoriq-translate-dropdown-text';
    fromText.textContent = fromLbl;
    const fromArrow = document.createElement('span');
    fromArrow.className = 'cursoriq-translate-dropdown-arrow';
    fromArrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';
    fromSel.appendChild(fromText);
    fromSel.appendChild(fromArrow);
    fromDd.appendChild(fromSel);
    const fromOpts = document.createElement('div');
    fromOpts.className = 'cursoriq-translate-dropdown-options';
    TRANSLATE_LANGS.forEach((o) => {
      const opt = document.createElement('div');
      opt.className = 'cursoriq-translate-dropdown-option';
      opt.dataset.value = o.v;
      opt.textContent = o.l;
      fromOpts.appendChild(opt);
    });
    fromDd.appendChild(fromOpts);

    const row2 = document.createElement('div');
    row2.className = 'cursoriq-translate-row';
    const label2 = document.createElement('label');
    label2.className = 'cursoriq-translate-label';
    label2.textContent = 'To';
    const toDd = document.createElement('div');
    toDd.className = 'cursoriq-translate-dropdown';
    toDd.dataset.role = 'to-dd';
    toDd.dataset.value = defaultTo;
    const toSel = document.createElement('div');
    toSel.className = 'cursoriq-translate-dropdown-selected';
    const toText = document.createElement('span');
    toText.className = 'cursoriq-translate-dropdown-text';
    toText.textContent = toLbl;
    const toArrow = document.createElement('span');
    toArrow.className = 'cursoriq-translate-dropdown-arrow';
    toArrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';
    toSel.appendChild(toText);
    toSel.appendChild(toArrow);
    toDd.appendChild(toSel);
    const toOpts = document.createElement('div');
    toOpts.className = 'cursoriq-translate-dropdown-options';
    TRANSLATE_LANGS_TO.forEach((o) => {
      const opt = document.createElement('div');
      opt.className = 'cursoriq-translate-dropdown-option';
      opt.dataset.value = o.v;
      opt.textContent = o.l;
      toOpts.appendChild(opt);
    });
    toDd.appendChild(toOpts);

    fromSel.addEventListener('click', (e) => {
      e.stopPropagation();
      toDd.classList.remove('active');
      fromDd.classList.toggle('active');
    });
    toSel.addEventListener('click', (e) => {
      e.stopPropagation();
      fromDd.classList.remove('active');
      toDd.classList.toggle('active');
    });
    fromOpts.querySelectorAll('.cursoriq-translate-dropdown-option').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        fromDd.dataset.value = opt.dataset.value;
        fromText.textContent = opt.textContent;
        fromDd.classList.remove('active');
        toDd.classList.remove('active');
      });
    });
    toOpts.querySelectorAll('.cursoriq-translate-dropdown-option').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        toDd.dataset.value = opt.dataset.value;
        toText.textContent = opt.textContent;
        fromDd.classList.remove('active');
        toDd.classList.remove('active');
      });
    });

    row1.appendChild(label1);
    row1.appendChild(fromDd);
    row2.appendChild(label2);
    row2.appendChild(toDd);

    const actions = document.createElement('div');
    actions.className = 'cursoriq-translate-actions';
    const btnDo = document.createElement('button');
    btnDo.type = 'button';
    btnDo.className = 'cursoriq-translate-btn-do';
    btnDo.textContent = 'Translate';
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'cursoriq-translate-btn-cancel';
    btnCancel.textContent = 'Cancel';

    btnDo.addEventListener('click', () => {
      const src = fromDd.dataset.value || 'auto';
      const tgt = toDd.dataset.value || 'en';
      if (src === tgt && src !== 'auto') return;
      if (onTranslate) onTranslate(src, tgt);
    });
    btnCancel.addEventListener('click', () => { if (onCancel) onCancel(); });

    actions.appendChild(btnDo);
    actions.appendChild(btnCancel);
    wrap.appendChild(row1);
    wrap.appendChild(row2);
    wrap.appendChild(actions);

    return wrap;
  }

  // If text is 500+ chars (or API returns query length error), open Google Translate in a new tab instead.
  function openInGoogleTranslate(text, source, target, onRestore) {
    const sl = source === 'auto' ? 'auto' : source;
    const tl = target || 'en';
    const encoded = encodeURIComponent(text);
    let url = 'https://translate.google.com/#view=home&op=translate&sl=' + sl + '&tl=' + tl + '&text=' + encoded;
    if (url.length <= 2000) {
      chrome.runtime.sendMessage({ type: 'openTab', url: url }, () => {});
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
      url = 'https://translate.google.com/';
      chrome.runtime.sendMessage({ type: 'openTab', url: url }, () => {});
    }
    if (onRestore) onRestore();
  }

  function isQueryLengthError(err) {
    return err && (String(err).includes('QUERY LENGTH') || String(err).toUpperCase().includes('500 CHARS'));
  }

  // Initialize subscription status
  let subscriptionActive = false;
  const SUBSCRIPTION_ID = 'nimbus_yearly_subscription';
  let usage = { used: 0, date: new Date().toISOString().slice(0,10), limit: 999999 };
  
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
  
  // When in an iframe, append tooltips to the top document to avoid clipping by iframe overflow/size.
  // Returns { body, inIframe, frameOffset: { left, top }, viewport: { w, h } }.
  function getTooltipRoot() {
    let body = document.body;
    let inIframe = false;
    let frameOffset = { left: 0, top: 0 };
    let viewport = { w: window.innerWidth, h: window.innerHeight };
    try {
      if (window.self !== window.top) {
        const topWin = window.top;
        const fe = window.frameElement;
        if (fe && topWin.document && topWin.document.body) {
          body = topWin.document.body;
          inIframe = true;
          const r = fe.getBoundingClientRect();
          frameOffset = { left: r.left, top: r.top };
          viewport = { w: topWin.innerWidth, h: topWin.innerHeight };
        }
      }
    } catch (e) {
      // cross-origin or other: keep defaults
    }
    return { body, inIframe, frameOffset, viewport };
  }

  // Load unpacked gets a different runtime ID; Chrome Web Store install uses this fixed ID.
  const STORE_EXTENSION_ID = 'abmihilkdbamlelkmpfegjfimcjpcihh';
  function isDeveloperMode() {
    try {
      return chrome.runtime.id !== STORE_EXTENSION_ID;
    } catch (e) {
      return false;
    }
  }
  
  async function checkSubscription() {
    try {
      if (isDeveloperMode()) {
        subscriptionActive = true;
        return true;
      }
    } catch (e) { /* fall through to normal check */ }
    try {
      // First check if subscriptionActive is set in storage (set by popup/background)
      const storageResult = await new Promise((resolve) => {
        chrome.storage.local.get(['subscriptionActive', 'subscriptionId', 'subscriptionExpiry', 'userEmail'], resolve);
      });

      // If subscriptionActive is explicitly set to true in storage, trust it (but still verify expiry)
      if (storageResult.subscriptionActive === true) {
        const expiry = storageResult.subscriptionExpiry;
        if (expiry && new Date(expiry) > new Date()) {
          subscriptionActive = true;
          console.log('Nimbus: Subscription active from storage');
          return true;
        } else if (!expiry) {
          // No expiry date, but marked as active - verify with API
          console.log('Nimbus: Subscription marked active but no expiry, verifying...');
        } else {
          // Expired
          subscriptionActive = false;
          chrome.storage.local.remove(['subscriptionId', 'subscriptionExpiry', 'subscriptionActive']);
          return false;
        }
      }

      // Get subscription ID from storage
      const subscriptionId = storageResult.subscriptionId;
      const expiry = storageResult.subscriptionExpiry;
      const userEmail = storageResult.userEmail;

      if (!subscriptionId && !userEmail) {
        subscriptionActive = false;
        return false;
      }

      // Check if expired locally
      if (expiry && new Date(expiry) < new Date()) {
        subscriptionActive = false;
        chrome.storage.local.remove(['subscriptionId', 'subscriptionExpiry', 'subscriptionActive']);
        return false;
      }

      // Verify with API - try subscriptionId first, then email
      try {
        const licenseKey = subscriptionId || userEmail;
        if (!licenseKey) {
          subscriptionActive = false;
          return false;
        }

        const response = await fetch('https://nimbus-api-ten.vercel.app/api/verify-license', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey }),
        });

        if (!response.ok) {
          subscriptionActive = false;
          return false;
        }

        const data = await response.json();
        if (data.valid) {
          subscriptionActive = true;
          // Update storage with latest info
          chrome.storage.local.set({
            subscriptionActive: true,
            subscriptionExpiry: data.expiryDate,
            subscriptionId: data.subscriptionId,
          });
          console.log('Nimbus: Subscription verified and active');
          return true;
        } else {
          subscriptionActive = false;
          chrome.storage.local.remove(['subscriptionId', 'subscriptionExpiry', 'subscriptionActive']);
          return false;
        }
      } catch (apiError) {
        // If API fails but expiry is still valid, allow access
        if (expiry && new Date(expiry) > new Date()) {
          subscriptionActive = true;
          return true;
        }
        subscriptionActive = false;
        return false;
      }
    } catch (e) {
      console.error('Nimbus: Error checking subscription:', e);
      subscriptionActive = false;
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
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
          if (changes.nimbusLastCopyAt && changes.nimbusLastCopyAt.newValue) {
            pasteToolbarLastCopyAt = changes.nimbusLastCopyAt.newValue;
            pasteToolbarEnabled = true;
          }
          if (changes.usage) {
            usage = changes.usage.newValue || usage;
          }
          // Re-check subscription when subscription data changes
          if (changes.subscriptionId || changes.subscriptionExpiry || changes.subscriptionActive || changes.userEmail) {
            console.log('Nimbus: Subscription storage changed, re-checking...', changes);
            checkSubscription().then((isActive) => {
              console.log('Nimbus: Subscription re-check result:', isActive);
              // If subscription just became active, close any upgrade prompts and reset modal counter
              if (isActive) {
                chrome.storage.local.set({ subscriptionModalShowCount: 0 }, () => {
                  console.log('Nimbus: Subscription activated, resetting modal show count');
                });
                if (tooltipEl) {
                const upgradePrompt = tooltipEl.querySelector('[style*="Subscribe to Unlock"]');
                if (upgradePrompt) {
                  console.log('Nimbus: Subscription activated, closing upgrade prompt');
                  hideTooltip();
                  }
                }
              }
            });
          }
        }
      });
    }
  } catch (e) {
    console.warn('Nimbus: Could not set up storage listener', e);
  }
  
  // Also listen for messages from background/popup
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.action === 'nimbusCopyAction') {
          pasteToolbarEnabled = true;
          pasteToolbarLastCopyAt = msg.at || Date.now();
          return true;
        }
        if (msg && msg.action === 'subscriptionActivated') {
          console.log('Nimbus: Received subscription activation message');
          checkSubscription().then((isActive) => {
            if (isActive) {
              chrome.storage.local.set({ subscriptionModalShowCount: 0 }, () => {
                console.log('Nimbus: Subscription activated via message, resetting modal show count');
              });
              if (tooltipEl) {
              const upgradePrompt = tooltipEl.querySelector('[style*="Subscribe to Unlock"]');
              if (upgradePrompt) {
                console.log('Nimbus: Subscription activated via message, closing upgrade prompt');
                hideTooltip();
                }
              }
            }
          });
        }
        return true; // Keep channel open for async response
      });
    }
  } catch (e) {
    console.warn('Nimbus: Message listener setup failed', e);
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

  // Track when user starts selecting (mousedown) — clear any blocking UI so native selection/scroll work; cancel pending "selection complete"
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.cursoriq-tooltip') || e.target.closest('#cursoriq-float-toolbar') || e.target.closest('.cursoriq-float-toolbar')) return;
    if (mouseupSelectionTimeout) { clearTimeout(mouseupSelectionTimeout); mouseupSelectionTimeout = null; }
    if (selectionTimer) { clearTimeout(selectionTimer); selectionTimer = null; }
    if (e.shiftKey) {
      isSelecting = true;
      selectionStartTime = Date.now();
      return; // shift+click: don't touch DOM or styles so native extend-selection works
    }
    clearTooltipElementOnly();
    const tb = document.getElementById('cursoriq-float-toolbar');
    if (tb) tb.style.pointerEvents = 'none';
    isSelecting = true;
    selectionStartTime = Date.now();
  });

  // Track mouse movement during selection (no action — just keep flag)
  document.addEventListener('mousemove', (e) => {
    if (isSelecting) isSelecting = true;
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftKeyHeld = true; });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftKeyHeld = false; });

  // Act only after selection is complete: delay after mouseup, and a follow-up mousedown cancels us. If Shift held (extending selection), use longer delay so second shift+click can happen first.
  document.addEventListener('mouseup', (e) => {
    if (mouseupSelectionTimeout) clearTimeout(mouseupSelectionTimeout);
    const delay = e.shiftKey ? 400 : 100; // shift+click: wait longer so user can do second shift+click before we run
    mouseupSelectionTimeout = setTimeout(() => {
      mouseupSelectionTimeout = null;
      isSelecting = false;
      const tb = document.getElementById('cursoriq-float-toolbar');
      if (tb) tb.style.pointerEvents = '';
      if (shiftKeyHeld) return; // user still holding shift — do not show tooltip at all
      handleSelection(e);
    }, delay);
  });
  
  // Update tooltip position on scroll if tooltip is visible (not while user is actively selecting)
  document.addEventListener('scroll', () => {
    if (isSelecting) return;
    if (tooltipEl && savedRange) {
      try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (!range.collapsed) {
            savedRange = range.cloneRange();
            // Reposition tooltip based on current selection
            const rect = savedRange.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && currentWord) {
              positionTooltip({ range: savedRange, word: currentWord });
            }
          }
        }
      } catch (e) {
        // Ignore errors during scroll
      }
    }
  }, { passive: true });
  
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

  function handleSelection(e) {
    // QUICK CHECK: If click happened on tooltip/modal, ignore completely
    if (e && e.target) {
      const clickedElement = e.target;
      // Check if click is on tooltip or any of its children
      if (tooltipEl && (tooltipEl === clickedElement || tooltipEl.contains(clickedElement))) {
        return; // Clicked on tooltip, ignore selection
      }
    }
    
    // QUICK CHECK: only skip when focus is clearly in a form field (input/textarea by tag)
    // contenteditable and role=textbox are handled later by isInsideInput for the selection range
    const activeEl = document.activeElement;
    if (activeEl) {
      const tag = activeEl.tagName && activeEl.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        return;
      }
    }
    
    // If tooltip is currently visible, don't process new selections
    if (tooltipEl && document.body && document.body.contains(tooltipEl)) {
      return;
    }
    
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

      // Get the range early for positioning and save it to maintain highlight
      let range = null;
      try {
        if (selection.rangeCount > 0) {
          range = selection.getRangeAt(0);
          
          // Validate that this is a valid text selection (not images, links, etc.)
          if (!isValidTextSelection(selection, range)) {
            // Not a valid text selection - let Chrome handle it normally
            return;
          }
          
          // Clone and save the range to maintain highlight
          savedRange = range.cloneRange();
        }
      } catch (e) {
        console.warn('CursorIQ: Error getting range', e);
        savedRange = null;
      }

      // Check if selection is an email address
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(selectedText)) {
        // It's an email - show email modal instead
        showEmailModal(selectedText, range);
        return;
      }

      // Don't return early for locations - let the word tooltip show but with location buttons

      // Check if selection is inside an input, textarea, or search field - DO THIS FIRST
      // Helper function to check if a node is inside an input/textarea
      const isInsideInput = (node) => {
        if (!node) return false;
        
        let current = node;
        let depth = 0;
        const maxDepth = 50; // Increased depth for very complex nested structures like Reddit
        
        while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
          depth++;
          
          // Check if it's an input/textarea element
          if (current.nodeType === Node.ELEMENT_NODE) {
            const tagName = current.tagName?.toLowerCase();
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'search') {
              return true;
            }
            // Check for contenteditable - but ONLY if it's actually an input field
            // Don't block contenteditable divs that are just page content (like Reddit posts)
            if (current.contentEditable === 'true' || current.isContentEditable) {
              // Only block if it has input-like attributes (placeholder, role, etc.)
              const role = current.getAttribute?.('role');
              const placeholder = current.getAttribute?.('placeholder') || '';
              const ariaLabel = current.getAttribute?.('aria-label') || '';
              const type = current.getAttribute?.('type');
              const id = current.getAttribute?.('id') || '';
              const className = current.className || '';
              const dataTestid = current.getAttribute?.('data-testid') || '';
              
              // Check for Reddit search bar specifically
              const isRedditSearch = (
                id.toLowerCase().includes('search') ||
                className.toLowerCase().includes('search') ||
                dataTestid.toLowerCase().includes('search') ||
                ariaLabel.toLowerCase().includes('search reddit') ||
                ariaLabel.toLowerCase().includes('search posts')
              ) && (
                className.toLowerCase().includes('input') ||
                className.toLowerCase().includes('field') ||
                className.toLowerCase().includes('box') ||
                placeholder.toLowerCase().includes('search')
              );
              
              // Only block if it's clearly an input field
              if (role === 'textbox' || role === 'searchbox' || role === 'combobox' || 
                  type === 'search' || type === 'text' ||
                  placeholder.length > 0 || 
                  ariaLabel.toLowerCase().includes('search') ||
                  ariaLabel.toLowerCase().includes('input') ||
                  isRedditSearch) {
                return true;
              }
              
              // Check if it's inside a form or has input-like parent
              let parent = current.parentElement;
              let parentDepth = 0;
              while (parent && parent !== document.body && parentDepth < 5) {
                const parentTag = parent.tagName?.toLowerCase();
                const parentRole = parent.getAttribute?.('role');
                const parentId = parent.getAttribute?.('id') || '';
                const parentClass = parent.className || '';
                
                // Check for Reddit search container
                const isRedditSearchContainer = (
                  parentId.toLowerCase().includes('search') ||
                  parentClass.toLowerCase().includes('search')
                ) && (
                  parentClass.toLowerCase().includes('input') ||
                  parentClass.toLowerCase().includes('field') ||
                  parentClass.toLowerCase().includes('box') ||
                  parentRole === 'search'
                );
                
                if (parentTag === 'form' || 
                    parentTag === 'input' ||
                    parentRole === 'search' ||
                    isRedditSearchContainer) {
                  return true;
                }
                parent = parent.parentElement;
                parentDepth++;
              }
              // If contenteditable doesn't have input attributes, don't block it
              // (it's probably just page content like Reddit posts/comments)
            }
          }
          
          // Move up the tree
          current = current.parentElement || current.parentNode;
        }
        return false;
      };
      
      try {
        // Simple check: Is selection inside an input/textarea?
        if (selection.rangeCount > 0 && range) {
          const startContainer = range.startContainer;
          const endContainer = range.endContainer;
          const commonAncestor = range.commonAncestorContainer;
          
          // Check if active element is an input and contains the selection
          const activeElement = document.activeElement;
          if (activeElement && activeElement !== document.body) {
            const activeTag = activeElement.tagName?.toLowerCase();
            if ((activeTag === 'input' || activeTag === 'textarea') && 
                range && (activeElement.contains(commonAncestor) || activeElement === commonAncestor)) {
              return; // Selection is in active input, ignore
            }
            const activeRole = activeElement.getAttribute?.('role');
            if ((activeRole === 'textbox' || activeRole === 'searchbox' || activeRole === 'combobox' || activeRole === 'search') &&
                range && (activeElement.contains(commonAncestor) || activeElement === commonAncestor)) {
              return; // Selection is in active searchbox, ignore
            }
            if ((activeElement.contentEditable === 'true' || activeElement.isContentEditable) &&
                range && (activeElement.contains(commonAncestor) || activeElement === commonAncestor)) {
              const activeRole = activeElement.getAttribute?.('role');
              const activePlaceholder = activeElement.getAttribute?.('placeholder') || '';
              if (activeRole === 'textbox' || activeRole === 'searchbox' || activePlaceholder.length > 0) {
                return; // Selection is in contenteditable input, ignore
              }
            }
          }
          
          // Check if selection containers are inside input elements
          if (isInsideInput(startContainer) || isInsideInput(endContainer) || isInsideInput(commonAncestor)) {
            return; // Selection is in input, ignore
          }
        }
      } catch (e) {
        // If check fails, continue anyway
      }

      // Check word count - split and filter
      const words = selectedText.split(/\s+/).filter(w => w.trim().length > 0);
      
      // Anything OVER 2 words (3+ words) - show icon-only modal with delay to allow scrolling
      if (words.length > 2) {
        console.log('CursorIQ: 3+ words selected, scheduling icon-only modal:', selectedText);
        // Clear any existing timers
        if (selectionTimer) {
          clearTimeout(selectionTimer);
          selectionTimer = null;
        }
        if (iconModalTimer) {
          clearTimeout(iconModalTimer);
          iconModalTimer = null;
        }
        
        // Don't show modal if user is actively selecting (mouse might still be down)
        // Wait a bit to see if selection is complete
        iconModalTimer = setTimeout(() => {
          // Check if user is still actively selecting
          if (isSelecting) {
            // User is still selecting, wait a bit more
            iconModalTimer = setTimeout(() => {
              if (!isSelecting) {
                console.log('CursorIQ: Selection complete, showing icon-only modal');
        lastSelection = '';
        showIconOnlyModal(selectedText, range);
              }
            }, 300);
          } else {
            console.log('CursorIQ: Showing icon-only modal after delay');
            lastSelection = '';
            showIconOnlyModal(selectedText, range);
          }
        }, 500); // Delay to allow scrolling while selecting
        return;
      }

    // Don't process if same selection AND tooltip is already showing
    // But allow if tooltip was just closed (lastSelection is empty)
    if (selectedText === lastSelection && tooltipEl) {
      return;
    }

    // Update lastSelection - this allows re-selecting after closing
    lastSelection = selectedText;

      // Get context (range already obtained earlier)
      let context = selectedText;
      
      try {
        if (range && range.commonAncestorContainer) {
          const parent = range.commonAncestorContainer.parentElement;
          if (parent && parent.innerText) {
            context = parent.innerText;
          }
        }
      } catch (e) {
        console.warn('CursorIQ: Error getting context', e);
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

    // Check if a location tooltip is currently showing - if so, don't show word tooltip
    if (tooltipEl && tooltipEl.classList.contains('cursoriq-location-tooltip')) {
      return; // Location tooltip is showing, don't show word tooltip
    }

    // Check if this is an address (not a place name) - addresses should show tooltip with map buttons
    // Place names (like "Sydney", "London") will be detected as entities by background script and go to hub
    const selectedText = wordInfo.word || '';
    const isAddress = detectLocation(selectedText);
    
    // If it's an address (has postcode, street name, etc.), we'll handle it after getting the response
    // Don't block here - let it flow through to check if it's a place name entity first

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
        
        chrome.runtime.sendMessage({ type: 'explain', word: wordInfo.word, context: wordInfo.context, detailed: true }, (resp) => {
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
        
        // Person/place/org: open hub only. One explain fetch, one display — no tooltip (avoids duplicate and extra UI).
        if (resp.isPerson && resp.personData) {
          removeTooltip();
          openHubWithEntityData(resp.personData, wordInfo.word, 'person');
        } else if (resp.isOrganization && resp.organizationData) {
          removeTooltip();
          openHubWithEntityData(resp.organizationData, wordInfo.word, 'organization');
        } else if (resp.isPlace && resp.placeData) {
          removeTooltip();
          openHubWithEntityData(resp.placeData, wordInfo.word, 'place');
        } else if (resp.isPartialName && resp.partialNameData && resp.partialNameData.explanation) {
          // Partial name with AI explanation - show in tooltip with links
          removeTooltip();
          showPartialNameTooltip(wordInfo, resp.partialNameData);
        } else if (resp.isPartialNameFallback && resp.partialNameData) {
          // Partial name without AI - open hub with news articles
          removeTooltip();
          openHubWithPartialNameData(resp.partialNameData, wordInfo.word);
        } else if (isAddress) {
          // It's an address (not a place name entity) - show tooltip with map/search buttons
          showTooltip(wordInfo, resp.explanation || selectedText, false, synonyms, resp.pronunciation, resp.examples || [], false, true);
        } else {
          // Normal word definition
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
    }).catch((e) => {
      console.error('Nimbus: checkSubscription failed', e);
      showTooltip(wordInfo, "Error checking subscription. Please try again.", true);
    });
  }

  // Show upgrade prompt when subscription is not active - Branded subscribe tooltip with blue background
  function showUpgradePrompt(wordInfo) {
    if (isDeveloperMode()) return;
    // Check if we've shown the modal 3 times already
    chrome.storage.local.get(['subscriptionModalShowCount'], (result) => {
      const showCount = result.subscriptionModalShowCount || 0;
      
      // If already shown 3 times, don't show again
      if (showCount >= 3) {
        console.log('Nimbus: Subscription modal already shown 3 times, not showing again');
        return;
      }
      
      // Increment the counter
      chrome.storage.local.set({ subscriptionModalShowCount: showCount + 1 }, () => {
        console.log('Nimbus: Subscription modal show count:', showCount + 1);
      });
      
    // Create a proper branded subscribe tooltip with blue gradient background
    const tooltipContent = `
        <div style="text-align: center; padding: 30px 25px; background: linear-gradient(135deg, #05007f 0%, #0a0a9e 30%, #1f7fff 60%, #4d9aff 100%); border-radius: 12px; position: relative;">
        <img src="${chrome.runtime.getURL('NimbusLogo.svg')}" alt="Nimbus" style="height: 36px; margin-bottom: 18px; filter: brightness(0) invert(1);" onerror="this.style.display='none'">
        <h3 style="margin: 0 0 12px 0; color: #ffffff; font-size: 20px; font-weight: 700;">Subscribe to Unlock</h3>
        <p style="margin: 0 0 8px 0; color: #e2e8f0; font-size: 14px; line-height: 1.6;">Get instant definitions, AI explanations, and context for any word or phrase</p>
        <div style="background: rgba(255,255,255,0.2); padding: 8px 12px; border-radius: 6px; margin: 0 0 22px 0; display: inline-block;">
          <span style="color: #ffffff; font-size: 13px; font-weight: 600;">✨ 3-Day Free Trial</span>
        </div>
        <div style="background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); padding: 18px; border-radius: 10px; margin-bottom: 22px; border: 1px solid rgba(255,255,255,0.2);">
            <div style="font-size: 32px; font-weight: 700; color: #ffffff; margin-bottom: 5px;">£2.99</div>
          <div style="font-size: 13px; color: #cbd5e1;">per year</div>
        </div>
        <button id="nimbus-upgrade-btn" style="background: #ffffff; color: #05007f; border: none; padding: 14px 28px; border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 600; width: 100%; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          Start Free Trial
        </button>
        <p style="margin: 18px 0 0 0; color: #94a3b8; font-size: 11px;">Click to open payment in extension</p>
      </div>
    `;
    
    // Use showTooltip with HTML flag to render properly
    showTooltip(wordInfo, tooltipContent, false, [], null, [], true);
    
    // Add click handler for upgrade button
    setTimeout(() => {
      const upgradeBtn = document.getElementById('nimbus-upgrade-btn');
      if (upgradeBtn) {
        upgradeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Open extension popup for payment
          chrome.runtime.sendMessage({ action: 'openPayment' }, (response) => {
            if (chrome.runtime.lastError) {
              // Fallback: try to open popup directly
              chrome.runtime.sendMessage({ action: 'openPopup' });
            }
          });
        });
        
        // Hover effect
        upgradeBtn.addEventListener('mouseenter', () => {
          upgradeBtn.style.background = '#f1f5f9';
          upgradeBtn.style.transform = 'scale(1.02)';
        });
        upgradeBtn.addEventListener('mouseleave', () => {
          upgradeBtn.style.background = '#ffffff';
          upgradeBtn.style.transform = 'scale(1)';
        });
      }
    }, 100);
    });
  }

  function showTooltip(wordInfo, text, isWarning=false, synonyms=[], pronunciation=null, examples=[], isHtml=false, isLocation=false) {
    // Reset manually closed flag when showing new tooltip
    manuallyClosed = false;
    stopAllAudio(); // Stop any playing audio when new tooltip appears
    removeTooltip();
    currentSynonyms = synonyms;
    
    // Check if this is a location - if so, we'll show location buttons instead of word buttons
    const detectedAsLocation = detectLocation(wordInfo.word || text || '');
    
    // Store the range for positioning (but don't clear selection yet - preserve native highlighting)
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      // Store the range for positioning if we have it
      if (wordInfo.range) {
        savedRange = wordInfo.range.cloneRange();
      } else {
        savedRange = selection.getRangeAt(0).cloneRange();
      }
      // Only clear visual selection AFTER tooltip is created and positioned
      // This preserves native highlighting for normal use cases
    }
    
    // Load settings (refresh in case they changed)
    loadModalSettings();

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cursoriq-tooltip';
    if (isWarning) tooltipEl.classList.add('warning');
    
    // Prevent clicks on tooltip buttons from triggering selection detection
    // But allow dragging on the tooltip itself
    tooltipEl.addEventListener('mouseup', (e) => {
      // Only stop propagation for buttons and interactive elements
      if (e.target.tagName === 'BUTTON' || 
          e.target.tagName === 'A' || 
          e.target.closest('button') || 
          e.target.closest('a') ||
          e.target.closest('.cursoriq-icon-btn') ||
          e.target.closest('.cursoriq-copy-btn')) {
        e.stopPropagation();
      }
    });
    tooltipEl.addEventListener('click', (e) => {
      // Stop propagation for all clicks on tooltip to prevent selection detection
      e.stopPropagation();
    });
    
    // Make entire modal draggable if enabled
    if (modalSettings.draggable || modalSettings.placement === 'custom') {
      tooltipEl.style.cursor = 'move';
      
      let startX, startY, initialX, initialY;
      
      // Make modal draggable by clicking anywhere on it (but not on interactive elements)
      tooltipEl.addEventListener('mousedown', (e) => {
        // Don't start drag if clicking on buttons, links, selects, inputs, translate modal, or interactive elements
        if (e.target.tagName === 'BUTTON' || 
            e.target.tagName === 'A' || 
            e.target.closest('button') || 
            e.target.closest('a') ||
            e.target.closest('select') ||
            e.target.closest('input') ||
            e.target.closest('.cursoriq-translate-modal') ||
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

    // Close button - positioned in top right corner, halfway out (only for non-subscribe prompts)
    if (!isHtml) {
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
    }

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
    
    // Button container for TTS, Copy, and Location buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.alignItems = 'center';
    buttonContainer.style.gap = '6px';
    buttonContainer.style.flexShrink = '0';
    buttonContainer.style.marginLeft = 'auto';
    
    // Text-to-speech button (always show)
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'cursoriq-tts-btn';
    ttsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"></path></svg>';
    ttsBtn.setAttribute('aria-label', 'Pronounce word');
    ttsBtn.setAttribute('title', 'Pronounce word');
    ttsBtn.style.cssText = 'width: 28px; height: 28px; padding: 0; background: transparent; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.9; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0;';
    ttsBtn.addEventListener('mouseenter', () => {
      ttsBtn.style.opacity = '1';
      ttsBtn.style.color = '#e2e8f0';
      ttsBtn.style.transform = 'scale(1.1)';
    });
    ttsBtn.addEventListener('mouseleave', () => {
      if (!ttsBtn.classList.contains('playing') && !ttsBtn.classList.contains('paused')) {
        ttsBtn.style.opacity = '0.9';
        ttsBtn.style.color = '#94a3b8';
        ttsBtn.style.transform = 'scale(1)';
      }
    });
    ttsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      if (!('speechSynthesis' in window)) {
        console.warn('CursorIQ: Text-to-speech not supported');
        return;
      }
      
      // If playing, pause it (stop and show play icon)
      if (audioState === 'playing') {
        const wordToSpeak = currentWord || wordInfo.word;
        window.speechSynthesis.cancel();
        audioState = 'paused';
        pausedText = wordToSpeak;
        updateSoundButtonIcon(ttsBtn, 'paused');
        ttsBtn.classList.remove('playing');
        ttsBtn.classList.add('paused');
        ttsBtn.style.color = '#94a3b8';
        ttsBtn.style.opacity = '0.9';
        ttsBtn.style.transform = 'scale(1)';
        return;
      }
      
      // If paused, restart from beginning
      if (audioState === 'paused' && pausedText) {
        const wordToSpeak = pausedText;
        pausedText = '';
        
        audioState = 'playing';
        updateSoundButtonIcon(ttsBtn, 'playing');
      ttsBtn.classList.add('playing');
      ttsBtn.style.color = '#60a5fa';
      ttsBtn.style.opacity = '1';
      ttsBtn.style.transform = 'scale(1.15)';
      
        chrome.storage.local.get(['settings'], (result) => {
          const lang = result.settings?.dictionaryLanguage || 'en';
          const voicePreference = result.settings?.voicePreference || 'auto'; // 'auto', 'male', 'female'
          const langMap = {
            'en': 'en-US', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE', 'it': 'it-IT',
            'pt': 'pt-PT', 'ru': 'ru-RU', 'ja': 'ja-JP', 'zh': 'zh-CN', 'ko': 'ko-KR',
            'ar': 'ar-SA', 'hi': 'hi-IN', 'nl': 'nl-NL', 'sv': 'sv-SE', 'pl': 'pl-PL'
          };
          const langCode = langMap[lang] || 'en-US';
          
          const speakWithBestVoice = () => {
            const utterance = new SpeechSynthesisUtterance(wordToSpeak);
            utterance.lang = langCode;
            const bestVoice = getBestVoice(langCode, voicePreference);
            if (bestVoice) {
              utterance.voice = bestVoice;
              utterance.lang = bestVoice.lang;
            }
            utterance.rate = 0.95;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;
            
            utterance.onend = () => {
              stopAllAudio();
              updateSoundButtonIcon(ttsBtn, 'idle');
            };
            
            utterance.onerror = () => {
              stopAllAudio();
              updateSoundButtonIcon(ttsBtn, 'idle');
            };
            
            currentUtterance = utterance;
            window.speechSynthesis.speak(utterance);
          };
          
          if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.addEventListener('voiceschanged', speakWithBestVoice, { once: true });
            window.speechSynthesis.getVoices();
          } else {
            speakWithBestVoice();
          }
        });
        return;
      }
      
      // Start playing
      const wordToSpeak = currentWord || wordInfo.word;
      audioState = 'playing';
      updateSoundButtonIcon(ttsBtn, 'playing');
      ttsBtn.classList.add('playing');
      ttsBtn.style.color = '#60a5fa';
      ttsBtn.style.opacity = '1';
      ttsBtn.style.transform = 'scale(1.15)';
      
      chrome.storage.local.get(['settings'], (result) => {
        const lang = result.settings?.dictionaryLanguage || 'en';
        const voicePreference = result.settings?.voicePreference || 'auto'; // 'auto', 'male', 'female'
        const langMap = {
          'en': 'en-US', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE', 'it': 'it-IT',
          'pt': 'pt-PT', 'ru': 'ru-RU', 'ja': 'ja-JP', 'zh': 'zh-CN', 'ko': 'ko-KR',
          'ar': 'ar-SA', 'hi': 'hi-IN', 'nl': 'nl-NL', 'sv': 'sv-SE', 'pl': 'pl-PL'
        };
        const langCode = langMap[lang] || 'en-US';
        
        const speakWithBestVoice = () => {
          const utterance = new SpeechSynthesisUtterance(wordToSpeak);
          utterance.lang = langCode;
          const bestVoice = getBestVoice(langCode, voicePreference);
          if (bestVoice) {
            utterance.voice = bestVoice;
            utterance.lang = bestVoice.lang;
          }
          utterance.rate = 0.95;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;
          
          utterance.onend = () => {
            stopAllAudio();
            updateSoundButtonIcon(ttsBtn, 'idle');
          };
          
          utterance.onerror = () => {
            stopAllAudio();
            updateSoundButtonIcon(ttsBtn, 'idle');
          };
          
          currentUtterance = utterance;
          window.speechSynthesis.speak(utterance);
        };
        
        if (window.speechSynthesis.getVoices().length === 0) {
          window.speechSynthesis.addEventListener('voiceschanged', speakWithBestVoice, { once: true });
          window.speechSynthesis.getVoices();
      } else {
          speakWithBestVoice();
      }
      });
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
      e.preventDefault();
      // Only handle if this is our button
      if (!e.target.closest('.cursoriq-tooltip')) return;
      
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
        textArea.style.pointerEvents = 'none';
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
    
    // Translate button (replaces Save for later; Favorites used for words)
    const translateBtn = document.createElement('button');
    translateBtn.className = 'cursoriq-translate-btn';
    translateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>';
    translateBtn.setAttribute('aria-label', 'Translate');
    translateBtn.setAttribute('title', 'Translate');
    translateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const expl = tooltipEl.querySelector('.cursoriq-explanation');
      if (!expl) return;
      const cont = expl.parentElement;
      const toHide = tooltipEl.querySelectorAll('.cursoriq-examples-container, .cursoriq-synonyms-container, .cursoriq-actions');
      const contOriginal = cont.innerHTML;
      toHide.forEach((el) => { el.style.display = 'none'; });
      const modalEl = createTranslateModal({
        defaultFrom: 'auto',
        defaultTo: 'en',
        onCancel: () => {
          cont.innerHTML = contOriginal;
          toHide.forEach((el) => { el.style.display = ''; });
        },
        onTranslate: (src, tgt) => {
          const text = (currentWord || wordInfo.word || '').trim();
          if (text.length >= 500) {
            openInGoogleTranslate(text, src, tgt, () => {
              cont.innerHTML = contOriginal;
              toHide.forEach((el) => { el.style.display = ''; });
            });
            return;
          }
          cont.removeChild(modalEl);
          const loading = document.createElement('div');
          loading.className = 'cursoriq-summary-loading';
          loading.textContent = 'Translating…';
          cont.appendChild(loading);
          chrome.runtime.sendMessage({ type: 'translate', text, source: src, target: tgt }, (resp) => {
            if (resp && resp.error && isQueryLengthError(resp.error)) {
              openInGoogleTranslate(text, src, tgt, () => {
                cont.removeChild(loading);
                cont.innerHTML = contOriginal;
                toHide.forEach((el) => { el.style.display = ''; });
              });
              return;
            }
            if (chrome.runtime.lastError) {
              loading.textContent = 'Error: ' + (chrome.runtime.lastError.message || 'Connection error');
              return;
            }
            if (resp && resp.error) {
              loading.textContent = 'Error: ' + resp.error;
              return;
            }
            const tr = (resp && resp.translation != null) ? resp.translation : (currentWord || wordInfo.word || '');
            cont.removeChild(loading);
            const wrap = document.createElement('div');
            wrap.className = 'cursoriq-summary-wrap';
            const resultText = document.createElement('div');
            resultText.className = 'cursoriq-summary-text';
            resultText.textContent = tr;
            const copyBtn = document.createElement('button');
            copyBtn.className = 'cursoriq-summary-copy';
            copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
            copyBtn.setAttribute('aria-label', 'Copy');
            copyBtn.setAttribute('title', 'Copy');
            copyBtn.addEventListener('click', () => {
              navigator.clipboard.writeText(tr).catch(() => {});
              copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
              copyBtn.setAttribute('aria-label', 'Copied');
              setTimeout(() => {
                copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                copyBtn.setAttribute('aria-label', 'Copy');
              }, 800);
            });
            wrap.appendChild(resultText);
            wrap.appendChild(copyBtn);
            cont.appendChild(wrap);
          });
        }
      });
      cont.innerHTML = '';
      cont.appendChild(modalEl);
      chrome.storage.local.get(['settings'], (r) => {
        const to = r.settings?.dictionaryLanguage || 'en';
        const toDd = modalEl.querySelector('[data-role="to-dd"]');
        if (toDd) {
          toDd.dataset.value = to;
          const t = toDd.querySelector('.cursoriq-translate-dropdown-text');
          if (t) t.textContent = TRANSLATE_LANGS_TO.find((x) => x.v === to)?.l || 'English';
        }
      });
    });
    buttonContainer.appendChild(translateBtn);
    
    // If it's a specific location (address), add map button only (map = Google Maps; copy already in row)
    if (detectedAsLocation) {
      const mapBtn = document.createElement('button');
      mapBtn.className = 'cursoriq-map-btn';
      mapBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
      mapBtn.setAttribute('aria-label', 'View on Google Maps');
      mapBtn.setAttribute('title', 'View on Google Maps');
      mapBtn.style.cssText = 'width: 28px; height: 28px; padding: 0; background: transparent; border: none; color: #60a5fa; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.9; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0;';
      mapBtn.addEventListener('mouseenter', () => { mapBtn.style.opacity = '1'; mapBtn.style.transform = 'scale(1.1)'; });
      mapBtn.addEventListener('mouseleave', () => { mapBtn.style.opacity = '0.7'; mapBtn.style.transform = 'scale(1)'; });
      mapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(currentWord || wordInfo.word)}`;
        chrome.runtime.sendMessage({ type: 'openTab', url: mapsUrl }, () => {});
        removeTooltip();
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      });
      buttonContainer.appendChild(mapBtn);
    }
    
    wordContainer.appendChild(buttonContainer);
    
    // For HTML content (subscribe prompt), don't show header - just show the content with blue background
    if (isHtml) {
      // Skip header for subscribe prompts - show content directly
      // Override tooltip background to blue gradient for subscribe prompts
      tooltipEl.style.background = 'radial-gradient(ellipse 115% 115% at 0% 0%, #05007f 0%, rgba(5,0,127,0.92) 15%, rgba(5,0,127,0.6) 32%, rgba(5,0,127,0.25) 50%, rgba(5,0,127,0) 68%), radial-gradient(ellipse 115% 115% at 100% 0%, #1f7fff 0%, rgba(31,127,255,0.92) 15%, rgba(31,127,255,0.6) 32%, rgba(31,127,255,0.25) 50%, rgba(31,127,255,0) 68%), linear-gradient(to bottom, transparent 0%, transparent 70%, rgba(0,0,0,0.3) 85%, rgba(0,0,0,0.6) 95%, rgba(0,0,0,0.85) 100%), #05007f !important';
      tooltipEl.style.border = 'none !important';
      tooltipEl.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1) !important';
      
      const contentDiv = document.createElement('div');
      contentDiv.innerHTML = text;
      contentDiv.style.padding = '0';
      contentDiv.style.margin = '0';
      tooltipEl.appendChild(contentDiv);
      
      // Add close button for subscription modal
      const closeBtn = document.createElement('button');
      closeBtn.className = 'cursoriq-close-btn';
      closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.style.cssText = 'position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; padding: 0; background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 8px; color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.8; transition: all 0.2s ease; z-index: 1000;';
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.opacity = '1';
        closeBtn.style.background = 'rgba(255, 255, 255, 0.3)';
        closeBtn.style.transform = 'scale(1.1)';
      });
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.opacity = '0.8';
        closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
        closeBtn.style.transform = 'scale(1)';
      });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        manuallyClosed = true;
        if (selectionTimer) {
          clearTimeout(selectionTimer);
          selectionTimer = null;
        }
        removeTooltip();
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
        }
      });
      tooltipEl.appendChild(closeBtn);
    } else {
      // Normal tooltip - show header and explanation
      header.appendChild(wordContainer);
      tooltipEl.appendChild(header);

      // Main explanation text container (skip for locations)
      if (!detectedAsLocation && text) {
      const explanationContainer = document.createElement('div');
      explanationContainer.style.position = 'relative';
      explanationContainer.style.padding = '16px 18px 16px';
      
      const textDiv = document.createElement('div');
      textDiv.className = 'cursoriq-explanation';
      textDiv.textContent = text;
      textDiv.style.userSelect = 'text';
      textDiv.style.webkitUserSelect = 'text';
      textDiv.style.mozUserSelect = 'text';
      textDiv.style.msUserSelect = 'text';
      textDiv.style.cursor = 'text';
      textDiv.style.padding = '0 36px 0 0';
      textDiv.style.margin = '0';
      explanationContainer.appendChild(textDiv);
    
      const copyExplanationBtn = document.createElement('button');
      copyExplanationBtn.className = 'cursoriq-copy-explanation-btn';
      copyExplanationBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>';
      copyExplanationBtn.setAttribute('aria-label', 'Copy explanation');
      copyExplanationBtn.setAttribute('title', 'Copy explanation');
      copyExplanationBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!tooltipEl || !tooltipEl.contains(e.target)) return;
        copyExplanationBtn.classList.add('copied');
        const explanationDivCurrent = tooltipEl.querySelector('.cursoriq-explanation');
        const currentText = explanationDivCurrent ? explanationDivCurrent.textContent.trim() : text;
        try {
          await navigator.clipboard.writeText(currentText);
        } catch (err) {
          const textArea = document.createElement('textarea');
          textArea.value = currentText;
          textArea.style.position = 'fixed';
          textArea.style.opacity = '0';
          textArea.style.pointerEvents = 'none';
          document.body.appendChild(textArea);
          textArea.select();
          try { document.execCommand('copy'); } catch (_) {}
          document.body.removeChild(textArea);
        }
        setTimeout(() => copyExplanationBtn.classList.remove('copied'), 300);
      });
      explanationContainer.appendChild(copyExplanationBtn);
      tooltipEl.appendChild(explanationContainer);
      }
    }

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

    // Action buttons container - bottom right icons (only show for non-subscribe prompts)
    if (!isHtml) {
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
    }

    setFloatingToolbarVisible(false);
    getTooltipRoot().body.appendChild(tooltipEl);

    // Position tooltip based on settings
    positionTooltip(wordInfo);
    
    // Clear selection AFTER tooltip is created and positioned (preserves native highlighting until now)
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    }, 50); // Small delay to ensure tooltip is fully rendered
  }
  
  // Show icon-only modal for text selections over 2 words (3+ words)
  function showIconOnlyModal(selectedText, range) {
    manuallyClosed = false;
    stopAllAudio(); // Stop any playing audio when new modal appears
    removeTooltip();
    
    // Check if selection is a location - if so, show location tooltip instead
    const isLocation = detectLocation(selectedText);
    if (isLocation) {
      showLocationTooltip(selectedText, range);
      return;
    }
    
    // Save the range for tooltip positioning (Chrome's native selection handles highlighting)
    if (range) {
      savedRange = range.cloneRange();
    }
    
    // Load settings for positioning
    loadModalSettings();
    
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cursoriq-tooltip cursoriq-icon-only-modal';
    
    // Prevent clicks on tooltip buttons from triggering selection detection
    tooltipEl.addEventListener('mouseup', (e) => {
      // Stop propagation for buttons and interactive elements
      if (e.target.tagName === 'BUTTON' || 
          e.target.closest('button') ||
          e.target.closest('.cursoriq-icon-btn')) {
        e.stopPropagation();
      }
    });
    tooltipEl.addEventListener('click', (e) => {
      // Stop propagation for all clicks on tooltip to prevent selection detection
      e.stopPropagation();
    });
    
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
    
    // Icon buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'cursoriq-icon-buttons';
    
    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cursoriq-icon-btn cursoriq-copy-icon-btn';
    copyBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyBtn.setAttribute('aria-label', 'Copy text');
    copyBtn.setAttribute('title', 'Copy text');
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Only handle if this is our button from our modal
      if (!tooltipEl || !tooltipEl.contains(e.target)) return;
      
      try {
        await navigator.clipboard.writeText(selectedText);
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.error('CursorIQ: Failed to copy text', err);
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = selectedText;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        textArea.style.pointerEvents = 'none';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (e) {
          console.error('CursorIQ: Fallback copy failed', e);
        }
        document.body.removeChild(textArea);
      }
    });
    buttonsContainer.appendChild(copyBtn);
    
    // Summarize button
    const sumBtn = document.createElement('button');
    sumBtn.className = 'cursoriq-icon-btn';
    sumBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    sumBtn.setAttribute('aria-label', 'Summarize');
    sumBtn.setAttribute('title', 'Summarize');
    sumBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!tooltipEl || !tooltipEl.contains(e.target)) return;
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'cursoriq-summary-loading';
      loadingDiv.textContent = 'Summarizing…';
      tooltipEl.replaceChild(loadingDiv, buttonsContainer);
      chrome.runtime.sendMessage({ type: 'summarize', text: selectedText }, (resp) => {
        if (chrome.runtime.lastError) {
          loadingDiv.textContent = 'Error: ' + (chrome.runtime.lastError.message || 'Connection error');
          return;
        }
        if (resp && resp.error) {
          loadingDiv.textContent = 'Error: ' + resp.error;
          return;
        }
        const wrap = document.createElement('div');
        wrap.className = 'cursoriq-summary-wrap';
        const resultText = document.createElement('div');
        resultText.className = 'cursoriq-summary-text';
        resultText.textContent = resp.explanation || 'No summary generated.';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'cursoriq-summary-copy';
        copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        copyBtn.setAttribute('aria-label', 'Copy');
        copyBtn.setAttribute('title', 'Copy');
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(resultText.textContent).catch(() => {});
          copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
          copyBtn.setAttribute('aria-label', 'Copied');
          setTimeout(() => {
            copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
            copyBtn.setAttribute('aria-label', 'Copy');
          }, 800);
        });
        wrap.appendChild(resultText);
        wrap.appendChild(copyBtn);
        tooltipEl.replaceChild(wrap, loadingDiv);
      });
    });
    buttonsContainer.appendChild(sumBtn);
    
    // Translate button — opens from/to modal under tooltip, then translates
    const translateBtn = document.createElement('button');
    translateBtn.className = 'cursoriq-icon-btn';
    translateBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>';
    translateBtn.setAttribute('aria-label', 'Translate');
    translateBtn.setAttribute('title', 'Translate');
    translateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!tooltipEl || !tooltipEl.contains(e.target)) return;
      const modalEl = createTranslateModal({
        defaultFrom: 'auto',
        defaultTo: 'en',
        onCancel: () => { tooltipEl.replaceChild(buttonsContainer, modalEl); },
        onTranslate: (src, tgt) => {
          const text = selectedText;
          if (text.length >= 500) {
            openInGoogleTranslate(text, src, tgt, () => { tooltipEl.replaceChild(buttonsContainer, modalEl); });
            return;
          }
          const loadingDiv = document.createElement('div');
          loadingDiv.className = 'cursoriq-summary-loading';
          loadingDiv.textContent = 'Translating…';
          tooltipEl.replaceChild(loadingDiv, modalEl);
          chrome.runtime.sendMessage({ type: 'translate', text, source: src, target: tgt }, (resp) => {
            if (resp && resp.error && isQueryLengthError(resp.error)) {
              openInGoogleTranslate(text, src, tgt, () => { tooltipEl.replaceChild(buttonsContainer, loadingDiv); });
              return;
            }
            if (chrome.runtime.lastError) {
              loadingDiv.textContent = 'Error: ' + (chrome.runtime.lastError.message || 'Connection error');
              return;
            }
            if (resp && resp.error) {
              loadingDiv.textContent = 'Error: ' + resp.error;
              return;
            }
            const wrap = document.createElement('div');
            wrap.className = 'cursoriq-summary-wrap';
            const resultText = document.createElement('div');
            resultText.className = 'cursoriq-summary-text';
            resultText.textContent = (resp && resp.translation != null) ? resp.translation : selectedText;
            const copyBtn = document.createElement('button');
            copyBtn.className = 'cursoriq-summary-copy';
            copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
            copyBtn.setAttribute('aria-label', 'Copy');
            copyBtn.setAttribute('title', 'Copy');
            copyBtn.addEventListener('click', () => {
              navigator.clipboard.writeText(resultText.textContent).catch(() => {});
              copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
              copyBtn.setAttribute('aria-label', 'Copied');
              setTimeout(() => {
                copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                copyBtn.setAttribute('aria-label', 'Copy');
              }, 800);
            });
            wrap.appendChild(resultText);
            wrap.appendChild(copyBtn);
            tooltipEl.replaceChild(wrap, loadingDiv);
          });
        }
      });
      tooltipEl.replaceChild(modalEl, buttonsContainer);
      chrome.storage.local.get(['settings'], (r) => {
        const to = r.settings?.dictionaryLanguage || 'en';
        const toDd = modalEl.querySelector('[data-role="to-dd"]');
        if (toDd) {
          toDd.dataset.value = to;
          const t = toDd.querySelector('.cursoriq-translate-dropdown-text');
          if (t) t.textContent = TRANSLATE_LANGS_TO.find((x) => x.v === to)?.l || 'English';
        }
      });
    });
    buttonsContainer.appendChild(translateBtn);
    
    // Sound/TTS button
    const soundBtn = document.createElement('button');
    soundBtn.className = 'cursoriq-icon-btn cursoriq-tts-icon-btn';
    soundBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
    soundBtn.setAttribute('aria-label', 'Read aloud');
    soundBtn.setAttribute('title', 'Read aloud');
    soundBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Only handle if this is our button from our modal
      if (!tooltipEl || !tooltipEl.contains(e.target)) return;
      
      if (!('speechSynthesis' in window)) {
        console.warn('CursorIQ: Text-to-speech not supported');
        return;
      }
      
      // If playing, pause it (stop and show play icon)
      if (audioState === 'playing') {
        window.speechSynthesis.cancel();
        audioState = 'paused';
        pausedText = selectedText;
        updateSoundButtonIcon(soundBtn, 'paused');
        soundBtn.classList.remove('playing');
        soundBtn.classList.add('paused');
        soundBtn.style.color = '';
        soundBtn.style.transform = '';
        return;
      }
      
      // If paused, restart from beginning
      if (audioState === 'paused' && pausedText) {
        const textToSpeak = pausedText;
        pausedText = '';
        
        audioState = 'playing';
        updateSoundButtonIcon(soundBtn, 'playing');
        soundBtn.classList.add('playing');
        soundBtn.style.color = '#60a5fa';
        soundBtn.style.transform = 'scale(1.1)';
        
        chrome.storage.local.get(['settings'], (result) => {
          const voicePreference = result.settings?.voicePreference || 'auto';
          const speakWithBestVoice = () => {
            const utterance = new SpeechSynthesisUtterance(textToSpeak);
            utterance.lang = 'en-US';
            const bestVoice = getBestVoice('en-US', voicePreference);
            if (bestVoice) {
              utterance.voice = bestVoice;
              utterance.lang = bestVoice.lang;
            }
          utterance.rate = 0.95;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;
          
          utterance.onend = () => {
            stopAllAudio();
            updateSoundButtonIcon(soundBtn, 'idle');
          };
          
            utterance.onerror = () => {
              stopAllAudio();
              updateSoundButtonIcon(soundBtn, 'idle');
            };
            
            currentUtterance = utterance;
            window.speechSynthesis.speak(utterance);
          };
          
          if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.addEventListener('voiceschanged', speakWithBestVoice, { once: true });
            window.speechSynthesis.getVoices();
          } else {
            speakWithBestVoice();
          }
        });
        return;
      }
      
      // Start playing
      audioState = 'playing';
      updateSoundButtonIcon(soundBtn, 'playing');
      soundBtn.classList.add('playing');
      soundBtn.style.color = '#60a5fa';
      soundBtn.style.transform = 'scale(1.1)';
      
      chrome.storage.local.get(['settings'], (result) => {
        const voicePreference = result.settings?.voicePreference || 'auto';
        const speakWithBestVoice = () => {
          const utterance = new SpeechSynthesisUtterance(selectedText);
          utterance.lang = 'en-US';
          const bestVoice = getBestVoice('en-US', voicePreference);
          if (bestVoice) {
            utterance.voice = bestVoice;
            utterance.lang = bestVoice.lang;
          }
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        utterance.onend = () => {
          stopAllAudio();
          updateSoundButtonIcon(soundBtn, 'idle');
        };
        
          utterance.onerror = () => {
            stopAllAudio();
            updateSoundButtonIcon(soundBtn, 'idle');
          };
          
          currentUtterance = utterance;
          window.speechSynthesis.speak(utterance);
        };
        
        if (window.speechSynthesis.getVoices().length === 0) {
          window.speechSynthesis.addEventListener('voiceschanged', speakWithBestVoice, { once: true });
          window.speechSynthesis.getVoices();
        } else {
          speakWithBestVoice();
        }
      });
    });
    buttonsContainer.appendChild(soundBtn);
    
    // Search button - opens hub and searches (using Nimbus icon)
    const searchBtn = document.createElement('button');
    searchBtn.className = 'cursoriq-icon-btn cursoriq-search-icon-btn';
    const hubIconImg = document.createElement('img');
    hubIconImg.src = chrome.runtime.getURL('Nimbus_Icon.svg');
    hubIconImg.style.width = '20px';
    hubIconImg.style.height = '20px';
    hubIconImg.style.display = 'block';
    hubIconImg.style.margin = 'auto';
    hubIconImg.style.objectFit = 'contain';
    searchBtn.appendChild(hubIconImg);
    searchBtn.setAttribute('aria-label', 'Search in hub');
    searchBtn.setAttribute('title', 'Search in hub');
    searchBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Only handle if this is our button from our modal
      if (!tooltipEl || !tooltipEl.contains(e.target)) return;
      
      const searchTerm = selectedText.trim();
      
      // Show thinking/loading until the hub has consumed pendingSearch and is ready
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'cursoriq-summary-loading';
      loadingDiv.textContent = 'Thinking…';
      tooltipEl.replaceChild(loadingDiv, buttonsContainer);
      
      let cleaned = false;
      let timeoutId;
      
      function cleanup() {
        if (cleaned) return;
        cleaned = true;
        try { chrome.storage.onChanged.removeListener(onStorageChange); } catch (_) {}
        if (timeoutId) clearTimeout(timeoutId);
        removeTooltip();
      }
      
      function onStorageChange(changes, areaName) {
        if (areaName !== 'local' || !changes.pendingSearch) return;
        // pendingSearch was removed — hub has consumed it and AI page is ready
        if (changes.pendingSearch.oldValue != null && (changes.pendingSearch.newValue === undefined || changes.pendingSearch.newValue === null)) {
          cleanup();
        }
      }
      
      chrome.storage.onChanged.addListener(onStorageChange);
      
      chrome.storage.local.set({
        pendingSearch: { type: 'search', term: searchTerm }
      }, () => {
        chrome.runtime.sendMessage({ action: 'openPopup' }, () => {});
      });
      
      // Fallback: close after 3s if hub didn't consume (e.g. popup didn't open)
      timeoutId = setTimeout(cleanup, 3000);
    });
    buttonsContainer.appendChild(searchBtn);
    
    tooltipEl.appendChild(buttonsContainer);
    
    // Make icon-only modal draggable (same as 1–2 word tooltip)
    if (modalSettings.draggable || modalSettings.placement === 'custom') {
      tooltipEl.style.cursor = 'move';
      let startX, startY, initialX, initialY;
      tooltipEl.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' ||
            e.target.closest('button') || e.target.closest('a') ||
            e.target.closest('select') || e.target.closest('input') ||
            e.target.closest('.cursoriq-translate-modal') ||
            e.target.closest('.cursoriq-icon-btn') || e.target.closest('.cursoriq-close-btn') ||
            e.target.closest('.cursoriq-summary-wrap')) return;
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        tooltipEl.style.cursor = 'grabbing';
        const rect = tooltipEl.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        initialX = rect.left; initialY = rect.top;
        document.addEventListener('mousemove', onIconModalDrag);
        document.addEventListener('mouseup', onIconModalStopDrag);
      });
      function onIconModalDrag(e) {
        if (!isDragging || !tooltipEl || !tooltipEl.parentNode) return;
        e.preventDefault();
        const dx = e.clientX - startX, dy = e.clientY - startY;
        let nx = initialX + dx, ny = initialY + dy;
        const maxX = window.innerWidth - tooltipEl.offsetWidth, maxY = window.innerHeight - tooltipEl.offsetHeight;
        nx = Math.max(0, Math.min(nx, maxX)); ny = Math.max(0, Math.min(ny, maxY));
        tooltipEl.style.left = nx + 'px'; tooltipEl.style.top = ny + 'px';
        tooltipEl.style.position = 'fixed'; tooltipEl.style.transform = 'none'; tooltipEl.style.margin = '0';
      }
      function onIconModalStopDrag() {
        isDragging = false;
        if (tooltipEl) tooltipEl.style.cursor = 'move';
        document.removeEventListener('mousemove', onIconModalDrag);
        document.removeEventListener('mouseup', onIconModalStopDrag);
        if (tooltipEl && tooltipEl.style.position === 'fixed' && modalSettings.placement === 'custom') {
          chrome.storage.local.set({ modalPosition: { x: parseInt(tooltipEl.style.left) || 0, y: parseInt(tooltipEl.style.top) || 0 } });
        }
      }
    }
    
    setFloatingToolbarVisible(false);
    getTooltipRoot().body.appendChild(tooltipEl);
    
    // Position tooltip
    positionTooltip({ range: range });
    
    // Clear selection AFTER tooltip is created and positioned (preserves native highlighting until now)
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    }, 50); // Small delay to ensure tooltip is fully rendered
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
      // Only handle if this is our button from our modal
      const emailModalEl = document.querySelector('.cursoriq-email-modal');
      if (!emailModalEl || !emailModalEl.contains(e.target)) return;
      
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
        textArea.style.pointerEvents = 'none';
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
    
    setFloatingToolbarVisible(false);
    getTooltipRoot().body.appendChild(tooltipEl);
    
    // Position the email modal
    positionEmailModal(email, range);
    
    // Clear selection AFTER tooltip is created and positioned (preserves native highlighting until now)
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    }, 50); // Small delay to ensure tooltip is fully rendered
  }
  
  // Position email modal (similar to positionTooltip but simpler)
  function positionEmailModal(email, range) {
    if (!tooltipEl || !range) return;
    
    const root = getTooltipRoot();
    let rect = range.getBoundingClientRect();
    if (root.inIframe) {
      rect = {
        left: rect.left + root.frameOffset.left,
        top: rect.top + root.frameOffset.top,
        right: rect.right + root.frameOffset.left,
        bottom: rect.bottom + root.frameOffset.top,
        width: rect.width,
        height: rect.height
      };
    }
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const viewportWidth = root.viewport.w;
    const viewportHeight = root.viewport.h;
    
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
        rect = { left: 100, top: 100, height: 20, width: 40, right: 140, bottom: 120 };
      }
      
      const root = getTooltipRoot();
      if (root.inIframe) {
        rect = {
          left: rect.left + root.frameOffset.left,
          top: rect.top + root.frameOffset.top,
          right: (rect.right != null ? rect.right : rect.left + rect.width) + root.frameOffset.left,
          bottom: (rect.bottom != null ? rect.bottom : rect.top + rect.height) + root.frameOffset.top,
          width: rect.width,
          height: rect.height
        };
      }
      performPlacementPositioning(wordInfo, rect, root.viewport);
    });
  }
  
  function performPlacementPositioning(wordInfo, rect, viewport) {
    const padding = 12;
    const tooltipWidth = 420; // max-width from CSS
    const tooltipHeight = 250; // estimated height
    
    const viewportWidth = viewport ? viewport.w : window.innerWidth;
    const viewportHeight = viewport ? viewport.h : window.innerHeight;
    
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


  // Stop all audio playback
  function stopAllAudio() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    currentUtterance = null;
    audioState = 'idle';
    pausedText = '';
    // Reset all sound button states
    const allSoundBtns = document.querySelectorAll('.cursoriq-tts-btn, .cursoriq-tts-icon-btn');
    allSoundBtns.forEach(btn => {
      btn.classList.remove('playing', 'paused');
      btn.style.color = '';
      btn.style.opacity = '';
      btn.style.transform = '';
      updateSoundButtonIcon(btn, 'idle');
    });
  }

  // Update sound button icon based on state
  function updateSoundButtonIcon(btn, state) {
    if (!btn) return;
    
    const isIconOnly = btn.classList.contains('cursoriq-tts-icon-btn');
    const size = isIconOnly ? '20' : '16';
    
    if (state === 'playing') {
      // Show stop icon (square)
      btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" ry="2"></rect></svg>`;
      btn.setAttribute('aria-label', 'Stop');
      btn.setAttribute('title', 'Stop');
    } else if (state === 'paused') {
      // Show play icon (triangle)
      btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      btn.setAttribute('aria-label', 'Resume');
      btn.setAttribute('title', 'Resume');
    } else {
      // Show sound icon (default)
      if (isIconOnly) {
        btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
      } else {
        btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"></path></svg>`;
      }
      btn.setAttribute('aria-label', isIconOnly ? 'Read aloud' : 'Pronounce word');
      btn.setAttribute('title', isIconOnly ? 'Read aloud' : 'Pronounce word');
    }
  }

  function setFloatingToolbarVisible(visible) {
    const t = document.getElementById('cursoriq-float-toolbar');
    if (t) t.style.visibility = visible ? 'visible' : 'hidden';
  }

  // Remove tooltip from DOM and clear state without touching the user's selection (so drag-to-select and scroll are not blocked)
  function clearTooltipElementOnly() {
    stopAllAudio();
    if (selectionTimer) { clearTimeout(selectionTimer); selectionTimer = null; }
    if (iconModalTimer) { clearTimeout(iconModalTimer); iconModalTimer = null; }
    if (tooltipEl && tooltipEl.parentNode) tooltipEl.parentNode.removeChild(tooltipEl);
    tooltipEl = null;
    savedRange = null;
    currentWord = null;
    currentSynonyms = [];
    setFloatingToolbarVisible(true);
  }

  function removeTooltip() {
    // Stop all audio when tooltip is removed
    stopAllAudio();
    
    // Clear any pending timers
    if (selectionTimer) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }
    if (iconModalTimer) {
      clearTimeout(iconModalTimer);
      iconModalTimer = null;
    }
    
    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
    }
    tooltipEl = null;
    currentWord = null;
    currentSynonyms = [];
    lastSelection = ''; // Reset so same word can be selected again

    setFloatingToolbarVisible(true);
    
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
          
          // Remove entries older than 14 days
          const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
          recent = recent.filter(item => {
            const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
            return timestamp > fourteenDaysAgo;
          });
          
          // Keep only last 100, auto-delete oldest when exceeded
          recent = recent.slice(0, 100);
          
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
    if (message.action === 'toggleFloatingToolbar') {
      const toolbar = document.getElementById('cursoriq-float-toolbar');
      if (message.hidden) {
        // Hide toolbar
        if (toolbar) {
          toolbar.style.display = 'none';
        }
      } else {
        // Show toolbar
        if (toolbar) {
          toolbar.style.display = 'flex';
        } else {
          // Toolbar doesn't exist, create it
          createFloatingToolbar();
        }
      }
    }
  });
  
  // Load settings on initialization
  loadModalSettings();

  // Restore recent copy state (for paste toolbar across tabs)
  try {
    chrome.storage.local.get(['nimbusLastCopyAt'], (res) => {
      const ts = res.nimbusLastCopyAt;
      if (ts && typeof ts === 'number') {
        pasteToolbarLastCopyAt = ts;
        pasteToolbarEnabled = true;
      }
    });
  } catch (e) {
    // Ignore storage errors
  }

  // Floating quick-action toolbar on every page
  let readerModeOn = false;

  function isNimbusCopyButton(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      '.cursoriq-copy-btn,' +
      '.cursoriq-copy-explanation-btn,' +
      '.cursoriq-summary-copy,' +
      '.cursoriq-copy-icon-btn,' +
      '.cursoriq-location-copy-btn,' +
      '.cursoriq-float-popover-copy'
    );
  }

  function canShowPasteToolbar() {
    if (!pasteToolbarEnabled) return false;
    if (Date.now() - pasteToolbarLastCopyAt > PASTE_TOOLBAR_TIMEOUT_MS) {
      pasteToolbarEnabled = false;
      return false;
    }
    return true;
  }

  function refreshPasteToolbarStateFromStorage(onDone) {
    try {
      chrome.storage.local.get(['nimbusLastCopyAt'], (res) => {
        const ts = res.nimbusLastCopyAt;
        if (ts && typeof ts === 'number') {
          pasteToolbarLastCopyAt = ts;
          pasteToolbarEnabled = true;
        }
        if (typeof onDone === 'function') onDone();
      });
    } catch (e) {
      if (typeof onDone === 'function') onDone();
    }
  }

  function isEditableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const blockedTypes = new Set([
        'button', 'submit', 'reset', 'checkbox', 'radio', 'file',
        'color', 'range', 'image', 'hidden'
      ]);
      return !blockedTypes.has(type);
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    const role = el.getAttribute && el.getAttribute('role');
    if (role && role.toLowerCase() === 'textbox') return true;
    // Google Docs specific: check for their contenteditable classes
    if (el.classList && (
      el.classList.contains('kix-lineview-content') ||
      el.classList.contains('kix-paragraphrenderer') ||
      el.closest('.kix-page-content-wrapper') ||
      el.closest('[contenteditable="true"]')
    )) return true;
    return false;
  }

  function ensurePasteToolbar() {
    if (pasteToolbarEl) return pasteToolbarEl;
    const bar = document.createElement('div');
    bar.id = 'cursoriq-paste-toolbar';
    bar.className = 'cursoriq-paste-toolbar';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cursoriq-paste-btn';
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H7a2 2 0 0 1-2-2V7"/><rect x="7" y="3" width="12" height="14" rx="2" ry="2"/><path d="M9 7h6"/><path d="M12 11v6"/><path d="M9 14h6"/></svg><span>Paste</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pasteFromClipboard(pasteToolbarTarget);
    });
    bar.appendChild(btn);
    bar.style.display = 'none';
    document.body.appendChild(bar);
    pasteToolbarEl = bar;
    return bar;
  }

  function positionPasteToolbar(target) {
    if (!pasteToolbarEl || !target) return;
    const rect = target.getBoundingClientRect();
    const toolbarRect = pasteToolbarEl.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + margin;
    let left = rect.left;
    if (top + toolbarRect.height > window.innerHeight - margin) {
      top = rect.top - toolbarRect.height - margin;
    }
    if (left + toolbarRect.width > window.innerWidth - margin) {
      left = window.innerWidth - toolbarRect.width - margin;
    }
    if (left < margin) left = margin;
    pasteToolbarEl.style.top = Math.max(margin, top) + 'px';
    pasteToolbarEl.style.left = left + 'px';
  }

  function showPasteToolbar(target) {
    console.log('[PASTE] showPasteToolbar called for:', target, 'canShow:', canShowPasteToolbar(), 'isEditable:', isEditableElement(target));
    if (!canShowPasteToolbar() || !isEditableElement(target)) {
      console.log('[PASTE] Cannot show toolbar - hiding');
      hidePasteToolbar();
      return;
    }
    ensurePasteToolbar();
    pasteToolbarTarget = target;
    pasteToolbarEl.style.display = 'flex';
    console.log('[PASTE] Toolbar shown, positioning...');
    requestAnimationFrame(() => positionPasteToolbar(target));
  }

  function hidePasteToolbar() {
    if (pasteToolbarEl) {
      pasteToolbarEl.style.display = 'none';
    }
    pasteToolbarTarget = null;
  }

  async function pasteFromClipboard(target) {
    const el = isEditableElement(target) ? target : document.activeElement;
    if (!isEditableElement(el)) return;
    let text = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch (e) {
      // Ignore readText errors, fall back below
    }
    if (!text) {
      try {
        el.focus();
        document.execCommand('paste');
      } catch (e) {
        // Some sites block programmatic paste
      }
      return;
    }
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') {
      const value = el.value || '';
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : value.length;
      el.value = value.slice(0, start) + text + value.slice(end);
      const newPos = start + text.length;
      if (el.setSelectionRange) el.setSelectionRange(newPos, newPos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      el.focus();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        el.textContent = (el.textContent || '') + text;
      }
    }
    showToast('Pasted');
  }

  function getPageTextForSummarize() {
    const el = document.querySelector('article, main, [role="main"], .post-content, .article-body, .entry-content, .content-column, [class*="article"]');
    const root = el || document.body;
    return (root.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 12000);
  }

  function createFloatingToolbar() {
    if (document.getElementById('cursoriq-float-toolbar')) return;
    
    // Check if toolbar should be hidden
    chrome.storage.local.get(['floatToolbarHidden'], (result) => {
      const isHidden = result.floatToolbarHidden || false;
      if (isHidden) {
        // Toolbar is hidden, don't create it
        return;
      }
      
      const bar = document.createElement('div');
      bar.id = 'cursoriq-float-toolbar';
      bar.className = 'cursoriq-float-toolbar';

      function btn(svg, title, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cursoriq-float-btn';
        b.innerHTML = svg;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
        return b;
      }

      function removePopover() {
        const p = document.getElementById('cursoriq-float-popover');
        if (p) p.remove();
      }

      function showPopoverWith(loadingHtml, onResp) {
        removePopover();
        const pop = document.createElement('div');
        pop.id = 'cursoriq-float-popover';
        pop.className = 'cursoriq-float-popover';
        pop.innerHTML = loadingHtml;
        bar.appendChild(pop);
        onResp(pop);
      }

      // Drag handle
      const grip = document.createElement('div');
      grip.className = 'cursoriq-float-grip';
      grip.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="8" r="1.5"/><circle cx="15" cy="8" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="16" r="1.5"/><circle cx="15" cy="16" r="1.5"/></svg>';
      grip.title = 'Drag to move';
      let isDragging = false, dragOffX = 0, dragOffY = 0;
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const r = bar.getBoundingClientRect();
        bar.style.right = 'auto';
        bar.style.left = r.left + 'px';
        bar.style.top = r.top + 'px';
        dragOffX = e.clientX - r.left;
        dragOffY = e.clientY - r.top;
        isDragging = true;
        const onMove = (e2) => {
          if (!isDragging) return;
          bar.style.left = (e2.clientX - dragOffX) + 'px';
          bar.style.top = (e2.clientY - dragOffY) + 'px';
        };
        const onUp = () => {
          isDragging = false;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const L = parseInt(bar.style.left, 10), T = parseInt(bar.style.top, 10);
          if (!isNaN(L) && !isNaN(T)) chrome.storage.local.set({ floatToolbarPosition: { left: L, top: T } });
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      bar.appendChild(grip);

      bar.appendChild(btn(
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
        'Open Nimbus',
        () => { chrome.runtime.sendMessage({ action: 'openPopup' }, () => {}); }
      ));
      bar.appendChild(btn(
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
        'Save this page',
        () => { savePageForLater(); showToast('Page saved'); }
      ));
      bar.appendChild(btn(
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
        'Summarize page',
        () => {
          const text = getPageTextForSummarize();
          if (!text || text.length < 50) { showToast('Not enough text on this page to summarize'); return; }
          showPopoverWith('<div class="cursoriq-float-popover-loading">Summarizing page…</div>', (pop) => {
            chrome.runtime.sendMessage({ type: 'summarize', text }, (resp) => {
              if (chrome.runtime.lastError) {
                pop.innerHTML = '<div class="cursoriq-float-popover-err">Error: ' + (chrome.runtime.lastError.message || 'Connection error') + '</div><button class="cursoriq-float-popover-close">Close</button>';
              } else if (resp && resp.error) {
                pop.innerHTML = '<div class="cursoriq-float-popover-err">' + resp.error + '</div><button class="cursoriq-float-popover-close">Close</button>';
              } else {
                const t = (resp && resp.explanation) ? resp.explanation : 'No summary generated.';
                pop.innerHTML = '<div class="cursoriq-float-popover-text"></div><button class="cursoriq-float-popover-copy">Copy</button><button class="cursoriq-float-popover-close">Close</button>';
                pop.querySelector('.cursoriq-float-popover-text').textContent = t;
                pop.querySelector('.cursoriq-float-popover-copy').onclick = () => { navigator.clipboard.writeText(t).catch(() => {}); pop.querySelector('.cursoriq-float-popover-copy').textContent = 'Copied'; setTimeout(() => { pop.querySelector('.cursoriq-float-popover-copy').textContent = 'Copy'; }, 600); };
              }
              pop.querySelector('.cursoriq-float-popover-close').onclick = removePopover;
            });
          });
        }
      ));
      bar.appendChild(btn(
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
        'Focus / Reader mode',
        () => {
          readerModeOn = !readerModeOn;
          document.documentElement.classList.toggle('nimbus-reader-mode', readerModeOn);
          showToast(readerModeOn ? 'Reader mode on' : 'Reader mode off');
        }
      ));

      document.body.appendChild(bar);

      // Restore or default position: top-right
      chrome.storage.local.get(['floatToolbarPosition'], (o) => {
        const pos = o.floatToolbarPosition;
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
          bar.style.right = 'auto';
          bar.style.left = pos.left + 'px';
          bar.style.top = pos.top + 'px';
        } else {
          bar.style.top = '16px';
          bar.style.right = '16px';
        }
      });
    });
  }

  setTimeout(createFloatingToolbar, 300);

  document.addEventListener('focusin', (e) => {
    console.log('[PASTE] focusin event on:', e.target, 'tag:', e.target.tagName, 'isEditable:', isEditableElement(e.target));
    if (isEditableElement(e.target)) {
      console.log('[PASTE] Focused editable element, checking paste toolbar state');
      if (canShowPasteToolbar()) {
        console.log('[PASTE] Can show toolbar, showing now');
        showPasteToolbar(e.target);
      } else {
        console.log('[PASTE] Cannot show yet, refreshing from storage...');
        refreshPasteToolbarStateFromStorage(() => {
          if (canShowPasteToolbar()) {
            console.log('[PASTE] After refresh, can show - showing toolbar');
            showPasteToolbar(e.target);
          } else {
            console.log('[PASTE] After refresh, still cannot show - hiding');
            hidePasteToolbar();
          }
        });
      }
    } else {
      // Don't hide if clicking on toolbar itself
      if (!pasteToolbarEl || !pasteToolbarEl.contains(e.target)) {
        hidePasteToolbar();
      }
    }
  }, true);

  // Also check on click into editable elements (for Google Docs and similar)
  document.addEventListener('click', (e) => {
    if (isNimbusCopyButton(e.target)) {
      console.log('[PASTE] Copy button clicked');
      markExtensionCopy();
      return;
    }
    // Check if clicking into an editable element (check target and parents)
    let editableEl = e.target;
    let checked = 0;
    while (editableEl && checked < 5) {
      if (isEditableElement(editableEl)) {
        console.log('[PASTE] Clicked into editable element:', editableEl);
        setTimeout(() => {
          if (canShowPasteToolbar()) {
            console.log('[PASTE] Clicked into editable, showing toolbar');
            showPasteToolbar(editableEl);
          } else {
            refreshPasteToolbarStateFromStorage(() => {
              if (canShowPasteToolbar()) {
                console.log('[PASTE] After refresh, showing toolbar');
                showPasteToolbar(editableEl);
              } else {
                console.log('[PASTE] Cannot show toolbar - state:', { enabled: pasteToolbarEnabled, lastCopy: pasteToolbarLastCopyAt, now: Date.now() });
              }
            });
          }
        }, 150);
        return;
      }
      editableEl = editableEl.parentElement;
      checked++;
    }
  }, true);

  // Also check activeElement periodically when user might be typing
  let pasteCheckInterval = null;
  function startPasteToolbarCheck() {
    if (pasteCheckInterval) return;
    pasteCheckInterval = setInterval(() => {
      const active = document.activeElement;
      if (active && isEditableElement(active)) {
        if (canShowPasteToolbar() && (!pasteToolbarTarget || pasteToolbarTarget !== active)) {
          console.log('[PASTE] Periodic check - active element is editable, showing toolbar');
          showPasteToolbar(active);
        } else if (!canShowPasteToolbar() && pasteToolbarEl && pasteToolbarEl.style.display !== 'none') {
          hidePasteToolbar();
        }
      }
    }, 500);
  }
  startPasteToolbarCheck();

  document.addEventListener('mousedown', (e) => {
    if (pasteToolbarEl && pasteToolbarEl.contains(e.target)) return;
    if (isEditableElement(e.target)) return;
    hidePasteToolbar();
  });

  document.addEventListener('scroll', () => {
    if (pasteToolbarTarget && pasteToolbarEl && pasteToolbarEl.style.display !== 'none') {
      positionPasteToolbar(pasteToolbarTarget);
    }
  }, true);

  window.addEventListener('resize', () => {
    if (pasteToolbarTarget && pasteToolbarEl && pasteToolbarEl.style.display !== 'none') {
      positionPasteToolbar(pasteToolbarTarget);
    }
  });

  // Only block when selection clearly contains media (img, video, iframe). Very permissive.
  function isValidTextSelection(selection, range) {
    if (!selection || !range) return false;
    if (!selection.toString().trim()) return false;
    try {
      var frag = range.cloneContents();
      if (frag.querySelectorAll('img, video, iframe').length > 0) return false;
      return true;
    } catch (e) {
      return true;
    }
  }

  function saveForLater(textToSave) {
    const t = (textToSave || '').toString().trim().slice(0, 500);
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      type: 'text',
      text: t,
      url: location.href,
      title: (document.title || location.href || 'Untitled').trim(),
      createdAt: Date.now()
    };
    chrome.storage.local.get(['savedForLater'], (r) => {
      let arr = r.savedForLater || [];
      arr.unshift(item);
      if (arr.length > 80) arr = arr.slice(0, 80);
      chrome.storage.local.set({ savedForLater: arr });
    });
  }

  function showSaveToast() {
    showToast('Saved for later');
  }

  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'cursoriq-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    const tb = document.getElementById('cursoriq-float-toolbar');
    if (tb) {
      const r = tb.getBoundingClientRect();
      el.style.top = (r.bottom + 8) + 'px';
      el.style.left = r.left + 'px';
      el.style.width = r.width + 'px';
      el.style.transform = 'none';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    } else {
      el.style.top = '70px';
      el.style.right = '20px';
      el.style.left = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
      el.style.width = 'auto';
    }
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 1800);
  }

  function savePageForLater() {
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      type: 'url',
      url: location.href,
      title: (document.title || location.href || 'Untitled').trim(),
      createdAt: Date.now()
    };
    chrome.storage.local.get(['savedForLater'], (r) => {
      let arr = r.savedForLater || [];
      arr.unshift(item);
      if (arr.length > 80) arr = arr.slice(0, 80);
      chrome.storage.local.set({ savedForLater: arr });
    });
  }

  // Detect if text is a location (postcode, place name, etc.)
  // Only returns true when the ENTIRE selection is a single location – not when a paragraph
  // merely contains a place name.
  function detectLocation(text) {
    if (!text || text.length < 2) return false;
    
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    
    // Reject long paragraphs: max 10 words, 120 chars. Addresses like "7 Dock St, London E1 8LL" (6 words) pass.
    if (words.length > 10 || trimmed.length > 120) return false;
    
    // UK postcode: e.g. SW1A 1AA, M1 1AA, E1 8LL, B33 8TH. \s* allows optional space before inward code.
    const ukPostcodeRegex = /[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i;
    if (ukPostcodeRegex.test(trimmed)) return true;
    
    // US ZIP code patterns (e.g., 12345, 12345-6789)
    const usZipRegex = /\b\d{5}(-\d{4})?\b/;
    if (usZipRegex.test(trimmed)) return true;
    
    // Canadian postal code (e.g., K1A 0B1)
    const canadaPostcodeRegex = /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i;
    if (canadaPostcodeRegex.test(trimmed)) return true;
    
    // Australian postcode (e.g., 2000) – only in short strings to avoid matching years (e.g. 2022) in paragraphs
    if (trimmed.length <= 50) {
      const ausPostcodeRegex = /\b\d{4}\b/;
      if (ausPostcodeRegex.test(trimmed)) return true;
    }
    
    // Helper: match keyword as whole word only (avoids "report" matching "port", "support" matching "port")
    function hasWholeWord(str, keyword) {
      const re = new RegExp('\\b' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      return re.test(str);
    }
    
    // Check for address patterns (e.g., "Vicarage Road, Watford, WD18 OHB")
    // Pattern: word(s) + comma + word(s) + comma + postcode
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        // Check if any part contains a postcode pattern
        const hasPostcode = parts.some(part => {
          return /[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i.test(part) ||
                 /\b\d{5}(-\d{4})?\b/.test(part) ||
                 /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(part);
        });
        if (hasPostcode) return true;
        
        // Check if it looks like an address (whole-word; 'st' = common street abbreviation)
        const addressKeywords = ['road', 'street', 'avenue', 'drive', 'lane', 'way', 'place', 'court', 'boulevard', 'parkway', 'terrace', 'square', 'st'];
        const lowerText = trimmed.toLowerCase();
        for (const keyword of addressKeywords) {
          if (hasWholeWord(lowerText, keyword)) return true;
        }
      }
    }
    
    // Common location keywords (whole-word only to avoid "report"->"port", "capitals"->"city", etc.)
    const locationKeywords = [
      'street', 'avenue', 'road', 'drive', 'lane', 'way', 'boulevard', 'court',
      'place', 'circle', 'parkway', 'terrace', 'square', 'plaza', 'park',
      'city', 'town', 'village', 'borough', 'county', 'state', 'province',
      'district', 'region', 'area', 'neighborhood', 'neighbourhood', 'suburb',
      'airport', 'station', 'terminal', 'port', 'harbor', 'harbour',
      'beach', 'mountain', 'lake', 'river', 'bridge', 'tower', 'castle',
      'museum', 'gallery', 'theater', 'theatre', 'stadium', 'arena',
      'university', 'college', 'school', 'hospital', 'library'
    ];
    
    for (const keyword of locationKeywords) {
      if (hasWholeWord(trimmed, keyword)) return true;
    }
    
    // Check for common place name patterns (capitalized words, 1-4 words)
    // BUT: Only if it contains location-specific indicators (not just any capitalized word)
    if (words.length >= 1 && words.length <= 4) {
      // If most words start with capital letter AND contains location keywords, likely a place name
      const capitalizedWords = words.filter(w => /^[A-Z]/.test(w));
      if (capitalizedWords.length >= words.length * 0.7) {
        // Must contain location-specific terms to be considered a location
        // This prevents regular capitalized words (like "Upskill") from being detected as locations
        const locationIndicators = ['city', 'town', 'village', 'county', 'state', 'province', 'country', 'region', 'district', 'borough', 'street', 'road', 'avenue', 'drive', 'lane', 'way', 'boulevard', 'court', 'place', 'park', 'plaza', 'square', 'airport', 'station', 'port', 'harbor', 'harbour', 'beach', 'mountain', 'lake', 'river', 'bridge', 'tower', 'castle', 'museum', 'gallery', 'theater', 'theatre', 'stadium', 'arena', 'university', 'college', 'school', 'hospital', 'library'];
        const hasLocationIndicator = locationIndicators.some(indicator => hasWholeWord(trimmed, indicator));
        
        // Only return true if it has location indicators OR if it's a known place pattern (like "New York", "Los Angeles")
        // For single capitalized words without location indicators, don't treat as location
        if (hasLocationIndicator) {
          return true;
        }
        // For multi-word capitalized phrases, be more conservative - only if it looks like a proper place name
        // (e.g., "New York", "Los Angeles" - but NOT "Upskill" or "Resume")
        if (words.length >= 2 && capitalizedWords.length === words.length) {
          // All words capitalized - could be a place name, but also could be a title
          // Only treat as location if it contains common place name patterns
          const commonPlacePatterns = ['new', 'old', 'north', 'south', 'east', 'west', 'upper', 'lower', 'great', 'little', 'big', 'small'];
          const hasPlacePattern = words.some(w => commonPlacePatterns.includes(w.toLowerCase()));
          if (hasPlacePattern) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  // Show location tooltip with map/search options
  function showLocationTooltip(locationText, range) {
    manuallyClosed = false;
    stopAllAudio();
    removeTooltip();
    
    // Clear any pending timers that might trigger word tooltip
    if (selectionTimer) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }
    if (iconModalTimer) {
      clearTimeout(iconModalTimer);
      iconModalTimer = null;
    }
    
    // Store the range for positioning (but don't clear selection yet - preserve native highlighting)
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      // Store the range for positioning
      savedRange = range ? range.cloneRange() : selection.getRangeAt(0).cloneRange();
    }
    
    if (range) {
      savedRange = range.cloneRange();
    }
    
    loadModalSettings();
    
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cursoriq-tooltip cursoriq-location-tooltip';
    
    tooltipEl.addEventListener('mouseup', (e) => {
      if (e.target.tagName === 'BUTTON' || 
          e.target.tagName === 'A' || 
          e.target.closest('button') || 
          e.target.closest('a') ||
          e.target.closest('.cursoriq-icon-btn')) {
        e.stopPropagation();
      }
    });
    tooltipEl.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    
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
      stopAllAudio();
    });
    tooltipEl.appendChild(closeBtn);
    
    // Buttons container – same layout as icon-only modal (cursoriq-icon-buttons: flex, gap 8px)
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'cursoriq-icon-buttons';
    
    // Map button – opens Google Maps search (white bg, blue icon)
    const mapBtn = document.createElement('button');
    mapBtn.className = 'cursoriq-icon-btn cursoriq-location-map-btn';
    mapBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
    mapBtn.setAttribute('aria-label', 'View on Google Maps');
    mapBtn.setAttribute('title', 'View on Google Maps');
    mapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationText)}`;
      chrome.runtime.sendMessage({ type: 'openTab', url: mapsUrl }, (res) => {
        if (chrome.runtime.lastError || (res && !res.success)) console.error('Failed to open Maps:', chrome.runtime.lastError?.message || (res && res.error));
      });
      removeTooltip();
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    });
    buttonsContainer.appendChild(mapBtn);
    
    // Copy button – copy address/text (replaces search; white bg, blue icon)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cursoriq-icon-btn cursoriq-location-copy-btn';
    copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyBtn.setAttribute('aria-label', 'Copy');
    copyBtn.setAttribute('title', 'Copy');
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(locationText);
        copyBtn.classList.add('copied');
        setTimeout(() => copyBtn.classList.remove('copied'), 300);
      } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = locationText;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
      }
      removeTooltip();
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    });
    buttonsContainer.appendChild(copyBtn);
    
    tooltipEl.appendChild(buttonsContainer);
    setFloatingToolbarVisible(false);
    getTooltipRoot().body.appendChild(tooltipEl);
    
    positionTooltip({ range: range });
    
    // Clear selection AFTER tooltip is created and positioned (preserves native highlighting until now)
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    }, 50); // Small delay to ensure tooltip is fully rendered
  }

  // Open hub with location data
  function openHubWithLocationData(locationText, canMap = false) {
    chrome.storage.local.set({
      pendingSearch: {
        type: 'location',
        term: locationText,
        canMap: canMap
      }
    }, () => {
      chrome.runtime.sendMessage({ action: 'openPopup' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Nimbus: Could not open popup automatically, user will need to open manually');
        }
      });
      chrome.runtime.sendMessage({ action: 'applyPendingSearch' });
    });
  }

  // Open hub with entity data (person, organization, or place)
  function openHubWithEntityData(entityData, searchTerm, entityType) {
    console.log('Nimbus: Opening hub with', entityType, 'data for:', searchTerm, 'data keys:', entityData ? Object.keys(entityData) : 'null');
    if (!entityData) {
      console.warn('Nimbus: No entity data provided for', searchTerm);
      return;
    }
    chrome.storage.local.set({
      pendingSearch: {
        type: entityType,
        term: searchTerm,
        data: entityData
      }
    }, () => {
      console.log('Nimbus: Saved pending search to storage');
      chrome.runtime.sendMessage({ action: 'openPopup' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Nimbus: Could not open popup automatically, user will need to open manually');
        }
      });
      // Increased delay to ensure popup DOM is fully ready
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'applyPendingSearch' });
      }, 600);
      // Also send again after longer delay as backup
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'applyPendingSearch' });
      }, 1200);
    });
  }

  // Show partial name tooltip with AI explanation and links
  function showPartialNameTooltip(wordInfo, partialNameData) {
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
    
    // Header with name and icons
    const header = document.createElement('div');
    header.className = 'cursoriq-header';
    header.style.cssText = 'padding: 16px 18px; border-bottom: 1px solid rgba(226, 232, 240, 0.8); flex-shrink: 0;';
    
    const headerContent = document.createElement('div');
    headerContent.style.cssText = 'display: flex; align-items: center; gap: 12px;';
    
    const nameContainer = document.createElement('div');
    nameContainer.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 4px;';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'cursoriq-word';
    nameSpan.style.cssText = 'font-size: 18px; font-weight: 700; color: #ffffff;';
    nameSpan.textContent = partialNameData.name || wordInfo.word;
    nameContainer.appendChild(nameSpan);
    
    headerContent.appendChild(nameContainer);
    
    // Button container for TTS and Copy buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; align-items: center; gap: 6px; flex-shrink: 0;';
    
    // Text-to-speech button
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'cursoriq-tts-btn';
    ttsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"></path></svg>';
    ttsBtn.setAttribute('aria-label', 'Pronounce name');
    ttsBtn.setAttribute('title', 'Pronounce name');
    ttsBtn.style.cssText = 'width: 28px; height: 28px; padding: 0; background: transparent; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.9; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0;';
    ttsBtn.addEventListener('mouseenter', () => {
      ttsBtn.style.opacity = '1';
      ttsBtn.style.color = '#e2e8f0';
      ttsBtn.style.transform = 'scale(1.1)';
    });
    ttsBtn.addEventListener('mouseleave', () => {
      if (!ttsBtn.classList.contains('playing') && !ttsBtn.classList.contains('paused')) {
        ttsBtn.style.opacity = '0.9';
        ttsBtn.style.color = '#94a3b8';
        ttsBtn.style.transform = 'scale(1)';
      }
    });
    ttsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      if (!('speechSynthesis' in window)) {
        console.warn('CursorIQ: Text-to-speech not supported');
        return;
      }
      
      const wordToSpeak = partialNameData.name || wordInfo.word;
      
      if (audioState === 'playing') {
        window.speechSynthesis.cancel();
        audioState = 'idle';
        updateSoundButtonIcon(ttsBtn, 'idle');
        ttsBtn.classList.remove('playing');
        ttsBtn.style.color = '#94a3b8';
        ttsBtn.style.opacity = '0.9';
        ttsBtn.style.transform = 'scale(1)';
        return;
      }
      
      audioState = 'playing';
      updateSoundButtonIcon(ttsBtn, 'playing');
      ttsBtn.classList.add('playing');
      ttsBtn.style.color = '#60a5fa';
      ttsBtn.style.opacity = '1';
      ttsBtn.style.transform = 'scale(1.15)';
      
      chrome.storage.local.get(['settings'], (result) => {
        const lang = result.settings?.dictionaryLanguage || 'en';
        const voicePreference = result.settings?.voicePreference || 'auto';
        const langMap = {
          'en': 'en-US', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE', 'it': 'it-IT',
          'pt': 'pt-PT', 'ru': 'ru-RU', 'ja': 'ja-JP', 'zh': 'zh-CN', 'ko': 'ko-KR',
          'ar': 'ar-SA', 'hi': 'hi-IN', 'nl': 'nl-NL', 'sv': 'sv-SE', 'pl': 'pl-PL'
        };
        const langCode = langMap[lang] || 'en-US';
        
        const speakWithBestVoice = () => {
          const utterance = new SpeechSynthesisUtterance(wordToSpeak);
          utterance.lang = langCode;
          const bestVoice = getBestVoice(langCode, voicePreference);
          if (bestVoice) {
            utterance.voice = bestVoice;
            utterance.lang = bestVoice.lang;
          }
          utterance.rate = 0.95;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;
          
          utterance.onend = () => {
            stopAllAudio();
            updateSoundButtonIcon(ttsBtn, 'idle');
          };
          
          utterance.onerror = () => {
            stopAllAudio();
            updateSoundButtonIcon(ttsBtn, 'idle');
          };
          
          currentUtterance = utterance;
          window.speechSynthesis.speak(utterance);
        };
        
        if (window.speechSynthesis.getVoices().length === 0) {
          window.speechSynthesis.addEventListener('voiceschanged', speakWithBestVoice, { once: true });
          window.speechSynthesis.getVoices();
        } else {
          speakWithBestVoice();
        }
      });
    });
    buttonContainer.appendChild(ttsBtn);
    
    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'cursoriq-copy-btn';
    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyBtn.setAttribute('aria-label', 'Copy name');
    copyBtn.setAttribute('title', 'Copy name');
    copyBtn.style.cssText = 'width: 28px; height: 28px; padding: 0; background: transparent; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0.9; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); flex-shrink: 0;';
    copyBtn.addEventListener('mouseenter', () => {
      copyBtn.style.opacity = '1';
      copyBtn.style.color = '#e2e8f0';
      copyBtn.style.transform = 'scale(1.1)';
    });
    copyBtn.addEventListener('mouseleave', () => {
      if (!copyBtn.classList.contains('copied')) {
        copyBtn.style.opacity = '0.9';
        copyBtn.style.color = '#94a3b8';
        copyBtn.style.transform = 'scale(1)';
      }
    });
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const wordToCopy = partialNameData.name || wordInfo.word;
      copyBtn.classList.add('copied');
      
      try {
        await navigator.clipboard.writeText(wordToCopy);
      } catch (err) {
        console.error('CursorIQ: Failed to copy name', err);
      }
      
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.style.opacity = '0.9';
        copyBtn.style.color = '#94a3b8';
        copyBtn.style.transform = 'scale(1)';
      }, 2000);
    });
    buttonContainer.appendChild(copyBtn);
    
    headerContent.appendChild(buttonContainer);
    header.appendChild(headerContent);
    tooltipEl.appendChild(header);
    
    const detailsContainer = document.createElement('div');
    detailsContainer.style.cssText = 'padding: 16px 18px; overflow-y: auto; overflow-x: hidden; flex: 1; min-height: 0;';
    
    // AI explanation
    if (partialNameData.explanation) {
      const explanation = document.createElement('div');
      explanation.className = 'cursoriq-explanation';
      explanation.style.cssText = 'font-size: 14px; line-height: 1.6; color: #ffffff; margin-bottom: 16px;';
      explanation.textContent = partialNameData.explanation;
      detailsContainer.appendChild(explanation);
    }
    
    // News links section
    if (partialNameData.newsArticles && partialNameData.newsArticles.length > 0) {
      const newsSection = document.createElement('div');
      newsSection.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.12);';
      
      const newsTitle = document.createElement('div');
      newsTitle.style.cssText = 'font-size: 16px; font-weight: 700; color: #ffffff; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;';
      newsTitle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path><rect x="11" y="7" width="10" height="5" rx="1"></rect><rect x="11" y="14" width="7" height="5" rx="1"></rect></svg> Related News';
      newsSection.appendChild(newsTitle);
      
      const newsList = document.createElement('div');
      newsList.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
      
      // Show up to 3 news articles as links
      partialNameData.newsArticles.slice(0, 3).forEach((article) => {
        if (article.link) {
          const newsLink = document.createElement('a');
          newsLink.href = article.link;
          newsLink.target = '_blank';
          newsLink.rel = 'noopener noreferrer';
          newsLink.style.cssText = 'padding: 10px; background: rgba(42, 58, 155, 0.5); border-radius: 8px; border: 1px solid rgba(71, 85, 105, 0.5); transition: all 0.2s ease; cursor: pointer; text-decoration: none; color: inherit; display: block;';
          
          newsLink.addEventListener('mouseenter', () => {
            newsLink.style.background = 'rgba(48, 68, 165, 0.72)';
            newsLink.style.borderColor = 'rgba(31, 127, 255, 0.4)';
            newsLink.style.transform = 'translateY(-1px)';
          });
          
          newsLink.addEventListener('mouseleave', () => {
            newsLink.style.background = 'rgba(42, 58, 155, 0.5)';
            newsLink.style.borderColor = 'rgba(71, 85, 105, 0.5)';
            newsLink.style.transform = 'translateY(0)';
          });
          
          const articleTitle = document.createElement('div');
          articleTitle.style.cssText = 'font-weight: 600; color: #ffffff; font-size: 13px; line-height: 1.4;';
          articleTitle.textContent = article.title;
          newsLink.appendChild(articleTitle);
          
          if (article.date) {
            const articleDate = document.createElement('div');
            articleDate.style.cssText = 'font-size: 11px; color: #cbd5e1; margin-top: 4px;';
            try {
              const date = new Date(article.date);
              articleDate.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            } catch (e) {
              articleDate.textContent = article.date;
            }
            newsLink.appendChild(articleDate);
          }
          
          newsList.appendChild(newsLink);
        }
      });
      
      newsSection.appendChild(newsList);
      detailsContainer.appendChild(newsSection);
    }
    
    tooltipEl.appendChild(detailsContainer);
    setFloatingToolbarVisible(false);
    getTooltipRoot().body.appendChild(tooltipEl);
    
    positionTooltip(wordInfo);
    currentWord = partialNameData.name;
  }
  
  // Open hub with partial name data (when AI fails)
  function openHubWithPartialNameData(partialNameData, word) {
    console.log('Nimbus: Opening hub with partial name data for:', word);
    if (!partialNameData) {
      console.warn('Nimbus: No partial name data provided for', word);
      return;
    }
    chrome.storage.local.set({
      pendingSearch: {
        type: 'partialName',
        term: word,
        data: partialNameData
      }
    }, () => {
      console.log('Nimbus: Saved pending partial name search to storage');
      chrome.runtime.sendMessage({ action: 'openPopup' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Nimbus: Could not open popup automatically, user will need to open manually');
        }
      });
      // Increased delay to ensure popup DOM is fully ready
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'applyPendingSearch' });
      }, 600);
      // Also send again after longer delay as backup
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'applyPendingSearch' });
      }, 1200);
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
    nameSpan.style.cssText = 'font-size: 20px; font-weight: 700; color: #e2e8f0;';
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
      e.preventDefault();
      // Only handle if this is our button from our modal
      const personTooltipEl = document.querySelector('.cursoriq-person-tooltip');
      if (!personTooltipEl || !personTooltipEl.contains(e.target)) return;
      
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
      bioDiv.style.cssText = 'margin-bottom: 16px; line-height: 1.6; color: #4a5568;';
      detailsContainer.appendChild(bioDiv);
    }

    // Person metadata
    const metadataDiv = document.createElement('div');
    metadataDiv.style.cssText = 'display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #64748b; margin-bottom: 16px;';
    
    if (personData.birthDate) {
      const birthDiv = document.createElement('div');
      birthDiv.innerHTML = `<strong style="color: #93c5fd;">Born:</strong> ${personData.birthDate}`;
      metadataDiv.appendChild(birthDiv);
    }
    
    if (personData.occupation) {
      const occDiv = document.createElement('div');
      occDiv.innerHTML = `<strong style="color: #93c5fd;">Occupation:</strong> ${personData.occupation}`;
      metadataDiv.appendChild(occDiv);
    }
    
    if (personData.nationality) {
      const natDiv = document.createElement('div');
      natDiv.innerHTML = `<strong style="color: #93c5fd;">Nationality:</strong> ${personData.nationality}`;
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
      wikiLink.style.cssText = 'display: inline-block; margin-bottom: 16px; color: #93c5fd; text-decoration: none; font-size: 13px; font-weight: 600; border-bottom: 1px solid rgba(147, 197, 253, 0.6);';
      wikiLink.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      detailsContainer.appendChild(wikiLink);
    }

    // Recent News section (dark theme)
    if (personData.newsArticles && personData.newsArticles.length > 0) {
      const textColor = '#ffffff';
      const textSecondary = '#e2e8f0';
      const textMuted = '#cbd5e1';
      
      const newsSection = document.createElement('div');
      newsSection.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.12);';
      
      const newsTitle = document.createElement('div');
      newsTitle.style.cssText = `font-size: 16px; font-weight: 700; color: ${textColor}; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;`;
      newsTitle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path><rect x="11" y="7" width="10" height="5" rx="1"></rect><rect x="11" y="14" width="7" height="5" rx="1"></rect></svg> Recent News';
      newsSection.appendChild(newsTitle);
      
      const newsList = document.createElement('div');
      newsList.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';
      
      personData.newsArticles.forEach((article, index) => {
        const newsItem = document.createElement('div');
        newsItem.style.cssText = 'padding: 12px; background: rgba(42, 58, 155, 0.5); border-radius: 8px; border: 1px solid rgba(71, 85, 105, 0.5); transition: all 0.2s ease; cursor: pointer;';
        
        newsItem.addEventListener('mouseenter', () => {
          newsItem.style.background = 'rgba(48, 68, 165, 0.72)';
          newsItem.style.borderColor = 'rgba(31, 127, 255, 0.4)';
          newsItem.style.transform = 'translateY(-1px)';
        });
        
        newsItem.addEventListener('mouseleave', () => {
          newsItem.style.background = 'rgba(42, 58, 155, 0.5)';
          newsItem.style.borderColor = 'rgba(71, 85, 105, 0.5)';
          newsItem.style.transform = 'translateY(0)';
        });
        
        const articleTitle = document.createElement('div');
        articleTitle.style.cssText = `font-weight: 600; color: ${textColor}; font-size: 14px; margin-bottom: 6px; line-height: 1.4;`;
        articleTitle.textContent = article.title;
        newsItem.appendChild(articleTitle);
        
        if (article.description) {
          const articleDesc = document.createElement('div');
          articleDesc.style.cssText = `font-size: 12px; color: ${textSecondary}; line-height: 1.5; margin-bottom: 8px;`;
          articleDesc.textContent = article.description;
          newsItem.appendChild(articleDesc);
        }
        
        if (article.date) {
          const articleDate = document.createElement('div');
          articleDate.style.cssText = `font-size: 11px; color: ${textMuted}; margin-top: 6px;`;
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
    setFloatingToolbarVisible(false);
    getTooltipRoot().body.appendChild(tooltipEl);
    
    // Position the tooltip
    positionTooltip(wordInfo);
    
    currentWord = personData.name;
  }

})();
