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

  // Initialize usage/pro status from storage
  let proUnlocked = true; // Always unlocked - free extension
  let usage = { used: 0, date: new Date().toISOString().slice(0,10), limit: 999999 }; // No limit
  
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
  
  safeStorageGet(['pro','usage','limit'], (res) => {
    if (chrome.runtime.lastError) return;
    // Always unlocked - this is a free extension
    proUnlocked = true;
    if (res.usage) {
      usage = res.usage;
      // Ensure limit is always high
      usage.limit = 999999;
    } else {
      usage.limit = 999999;
    }
    // Override any stored limit
    usage.limit = 999999;
  });

      // Listen for storage changes
      try {
        if (chrome && chrome.storage && chrome.storage.onChanged) {
          chrome.storage.onChanged.addListener((changes) => {
            // Always unlocked - this is a free extension
            proUnlocked = true;
            if (changes.usage) {
              usage = changes.usage.newValue || usage;
              usage.limit = 999999; // Always override limit
            }
            // Always override any limit changes
            usage.limit = 999999;
          });
        }
      } catch (e) {
        console.warn('CursorIQ: Could not set up storage listener', e);
      }

  console.log('CursorIQ: Content script loaded on', window.location.href);

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

      // Extract first word or phrase (up to 3 words)
      const words = selectedText.split(/\s+/).slice(0, 3);
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

    // reset daily usage if date changed
    const today = new Date().toISOString().slice(0,10);
    if (usage.date !== today) { usage.used = 0; usage.date = today; }

    // No limits - this is a free extension
    // Ensure limit is always high (override any stored value)
    usage.limit = 999999;
    proUnlocked = true;

    // Track usage but don't block
    usage.used += 1;
    safeStorageSet({ usage });

    currentWord = wordInfo.word;
    showTooltip(wordInfo, "Thinking...", false, []); // Show loading state with empty synonyms

    console.log('CursorIQ: Sending message to background for:', wordInfo.word);
    
    try {
      console.log('CursorIQ: About to call chrome.runtime.sendMessage');
      console.log('CursorIQ: chrome.runtime exists:', !!chrome.runtime);
      console.log('CursorIQ: chrome.runtime.id:', chrome.runtime?.id);
      
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
        
        showTooltip(wordInfo, resp.explanation || "No explanation returned.", false, synonyms, resp.pronunciation, resp.examples || []);
      });
      
      // Add a timeout to detect if callback never fires
      setTimeout(() => {
        console.warn('CursorIQ: WARNING - Callback may not have fired after 5 seconds');
      }, 5000);
    } catch (err) {
      console.error('CursorIQ: Error sending message', err);
      if (err.message && err.message.includes('Extension context invalidated')) {
        showTooltip(wordInfo, "⚠️ Extension reloaded. Please refresh the page (F5).", true);
      } else {
        showTooltip(wordInfo, "Error: " + err.message, true);
      }
    }
  }

  function showTooltip(wordInfo, text, isWarning=false, synonyms=[], pronunciation=null, examples=[]) {
    // Reset manually closed flag when showing new tooltip
    manuallyClosed = false;
    removeTooltip();
    currentSynonyms = synonyms;

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'cursoriq-tooltip';
    if (isWarning) tooltipEl.classList.add('warning');

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
    
    // Phonetic breakdown (pronunciation)
    const phoneticSpan = document.createElement('span');
    phoneticSpan.className = 'cursoriq-phonetic';
    phoneticSpan.textContent = pronunciation || ''; // Set from parameter or response
    wordWrapper.appendChild(phoneticSpan);
    
    wordContainer.appendChild(wordWrapper);
    
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
    wordContainer.appendChild(copyBtn);
    
    header.appendChild(wordContainer);
    tooltipEl.appendChild(header);

    // Main explanation text
    const textDiv = document.createElement('div');
    textDiv.className = 'cursoriq-explanation';
    textDiv.textContent = text;
    tooltipEl.appendChild(textDiv);

    // Examples section (if available)
    if (examples && Array.isArray(examples) && examples.length > 0) {
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

    // Position tooltip near selection
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
    
    // Position tooltip below selection, centered horizontally
    const padding = 12;
    const tooltipWidth = 420; // max-width from CSS
    const tooltipHeight = 250; // estimated height
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Calculate position relative to viewport (not scroll)
    let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
    let top = rect.bottom + padding;
    
    // Keep tooltip on screen - adjust if off-screen
    // Horizontal positioning - ensure it's visible
    if (left < 10) {
      left = 10;
    } else if (left + tooltipWidth > viewportWidth - 10) {
      left = viewportWidth - tooltipWidth - 10;
    }
    
    // Vertical positioning - try below first, then above if no room
    if (top + tooltipHeight > viewportHeight - 10) {
      // Not enough room below, put it above
      top = rect.top - tooltipHeight - padding;
      if (top < 10) {
        // Still no room, center vertically
        top = (viewportHeight / 2) - (tooltipHeight / 2);
      }
    }
    
    // Ensure minimum distance from edges
    if (top < 10) top = 10;
    if (left < 10) left = 10;
    
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
        }
        return;
      }
      chrome.runtime.sendMessage({ type: 'explain', word: synonym, context: '' }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('CursorIQ: Error fetching synonym explanation:', chrome.runtime.lastError);
          if (explanationDiv) {
            explanationDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
          }
          return;
        }
        console.log('CursorIQ: Got response for synonym:', resp);
        if (resp && !resp.error) {
          if (explanationDiv) {
            explanationDiv.textContent = resp.explanation || 'No explanation available.';
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
            explanationDiv.textContent = resp?.error || 'Error loading explanation.';
          }
        }
      });
    } catch (e) {
      if (explanationDiv) {
        explanationDiv.textContent = 'Error: ' + (e.message || 'Unknown error');
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

})();
