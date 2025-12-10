/* popup.js - Nimbus Hub functionality */

(() => {
  const searchInput = document.getElementById('searchInput');
  const suggestions = document.getElementById('suggestions');
  const favoritesDiv = document.getElementById('favorites');
  const recentDiv = document.getElementById('recent');
  const wordOfDayDiv = document.getElementById('wordOfDay');
  const nimbusTitle = document.getElementById('nimbusTitle');

  let searchTimeout = null;
  let currentSuggestions = [];
  let navigationHistory = []; // Stack for back button
  let currentView = 'hub'; // 'hub' or 'word'

  // Set favicon dynamically (Chrome extension popups need this)
  try {
    const link = document.querySelector("link[rel='icon']") || document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = chrome.runtime.getURL('Nimbus Favicon.png');
    if (!document.querySelector("link[rel='icon']")) {
      document.getElementsByTagName('head')[0].appendChild(link);
    }
  } catch (e) {
    console.log('Could not set favicon:', e);
  }

  // Load all data on popup open
  loadFavorites();
  loadRecent();
  loadWordOfDay();

  // Nimbus title click handler - return to hub
  nimbusTitle.addEventListener('click', () => {
    returnToHub();
  });

  // Search input handler
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    if (searchTimeout) clearTimeout(searchTimeout);
    
    if (!query) {
      suggestions.classList.remove('show');
      currentSuggestions = [];
      return;
    }

    // Show suggestions immediately for short queries
    if (query.length >= 2) {
      searchTimeout = setTimeout(() => {
        searchWord(query);
      }, 200);
    } else {
      suggestions.classList.remove('show');
    }
  });
  
  // Allow Enter key to search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        suggestions.classList.remove('show');
        showWordDetails(query);
        searchInput.value = ''; // Clear search input
      }
    }
  });

  // Search icon button handler
  const searchIconBtn = document.getElementById('searchIconBtn');
  searchIconBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query.length >= 2) {
      suggestions.classList.remove('show');
      showWordDetails(query);
      searchInput.value = ''; // Clear search input
    }
  });

  searchInput.addEventListener('focus', () => {
    if (currentSuggestions.length > 0) {
      suggestions.classList.add('show');
    }
  });

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !suggestions.contains(e.target)) {
      suggestions.classList.remove('show');
    }
  });

  // Navigation functions
  function returnToHub() {
    navigationHistory = [];
    currentView = 'hub';
    showHubView();
  }

  function showHubView() {
    // Show all sections
    document.querySelectorAll('.section').forEach(section => {
      section.style.display = 'block';
    });
    searchInput.value = '';
    loadFavorites();
    loadRecent();
    loadWordOfDay();
  }

  async function searchWord(query) {
    if (!query || query.length < 2) return;

    try {
      // Get suggestions from recent and favorites
      const [favorites, recent] = await Promise.all([
        getStorage('favorites'),
        getStorage('recentSearches')
      ]);

      const allWords = [...(favorites || []), ...(recent || [])];
      const filtered = allWords
        .filter(word => word.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5);

      showSuggestions(filtered);
    } catch (e) {
      console.error('Error searching', e);
    }
  }

  function showSuggestions(words) {
    currentSuggestions = words;
    suggestions.innerHTML = '';

    if (words.length === 0) {
      suggestions.innerHTML = '<div class="suggestion-item">No suggestions found</div>';
    } else {
      words.forEach(word => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = word;
        item.addEventListener('click', () => {
          searchInput.value = word;
          suggestions.classList.remove('show');
          showWordDetails(word);
        });
        suggestions.appendChild(item);
      });
    }

    suggestions.classList.add('show');
  }

  async function showWordDetails(word, pushToHistory = true) {
    // Add to navigation history if not already there
    if (pushToHistory && (navigationHistory.length === 0 || navigationHistory[navigationHistory.length - 1] !== word)) {
      navigationHistory.push(word);
    }

    // Save to recent
    await saveToRecent(word);
    loadRecent();

    // Get explanation
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ 
          type: 'explain', 
          word: word, 
          context: '',
          detailed: true
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      });

      if (resp && !resp.error) {
        displayWordDetails(word, resp);
      }
    } catch (e) {
      console.error('Error getting word details', e);
    }
  }

  async function displayWordDetails(word, data) {
    currentView = 'word';
    
    // Hide other sections
    document.querySelectorAll('.section').forEach(section => {
      if (section.querySelector('#wordOfDay') === null) {
        section.style.display = 'none';
      }
    });
    
    // Get favorites to check if word is favorited
    const favorites = await getStorage('favorites') || [];
    const isFavorited = favorites.includes(word);
    
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
    wordOfDayDiv.innerHTML = `
      <div class="word-card-modal">
        <div class="word-card-header">
          <div class="word-card-header-top">
            <div class="word-card-word-container">
              <div class="word-card-word-wrapper">
                <span class="word-card-word">${word}</span>
                ${data.pronunciation ? `<span class="word-card-phonetic">${data.pronunciation}</span>` : ''}
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
        <div class="word-card-explanation">${data.explanation || 'No explanation available.'}</div>
        ${data.examples && data.examples.length > 0 ? `
          <div class="word-card-examples-container">
            <div class="word-card-examples-label">Examples</div>
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
              Synonyms
            </div>
            <div class="word-card-synonyms-scroll">
              ${synonyms.map(s => `<span class="word-card-synonym-tag" data-synonym="${s}">${s}</span>`).join('')}
            </div>
          </div>
        ` : ''}
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
      </div>
    `;
    
    // Event handlers
    if (hasBack) {
      document.getElementById('wordCardBackBtn').addEventListener('click', () => {
        navigationHistory.pop(); // Remove current
        const previousWord = navigationHistory[navigationHistory.length - 1];
        if (previousWord) {
          showWordDetails(previousWord, false); // Don't push to history
        } else {
          returnToHub();
        }
      });
    }
    
    document.getElementById('wordCardCopyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(word);
        const btn = document.getElementById('wordCardCopyBtn');
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 2000);
      } catch (e) {
        console.error('Failed to copy', e);
      }
    });
    
    document.getElementById('wordCardFavBtn').addEventListener('click', async () => {
      const favorites = await getStorage('favorites') || [];
      const index = favorites.indexOf(word);
      if (index > -1) {
        favorites.splice(index, 1);
      } else {
        favorites.push(word);
      }
      await setStorage({ favorites });
      const btn = document.getElementById('wordCardFavBtn');
      const isNowFavorited = favorites.includes(word);
      btn.classList.toggle('favorited', isNowFavorited);
      btn.querySelector('svg').setAttribute('fill', isNowFavorited ? 'currentColor' : 'none');
      loadFavorites();
    });
    
    document.getElementById('wordCardSearchBtn').addEventListener('click', () => {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(word)}`, '_blank');
    });
    
    // Make synonyms clickable
    wordOfDayDiv.querySelectorAll('.word-card-synonym-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        showWordDetails(tag.dataset.synonym);
      });
    });
  }
  
  function getPronunciation(word) {
    // Simple pronunciation guide
    return `/${word}/`;
  }

  async function loadFavorites() {
    try {
      const favorites = await getStorage('favorites') || [];
      
      if (favorites.length === 0) {
        favoritesDiv.innerHTML = '<div class="empty-state">No favorites yet. Click the heart icon in tooltips to add words!</div>';
        return;
      }

      favoritesDiv.innerHTML = favorites.map(word => `
        <div class="word-item">
          <span class="word" data-word="${word}">${word}</span>
          <button class="remove-btn" data-word="${word}">Remove</button>
        </div>
      `).join('');

      // Add click handlers
      favoritesDiv.querySelectorAll('.word').forEach(el => {
        el.addEventListener('click', () => {
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
      console.error('Error loading favorites', e);
      favoritesDiv.innerHTML = '<div class="empty-state">Error loading favorites</div>';
    }
  }

  let recentExpanded = false;
  let allRecentSearches = [];

  async function loadRecent() {
    try {
      let recent = await getStorage('recentSearches') || [];
      
      // Migrate old format (strings) to new format (objects with timestamp)
      if (recent.length > 0 && typeof recent[0] === 'string') {
        recent = recent.map(w => ({ word: w, timestamp: Date.now() }));
        await setStorage({ recentSearches: recent });
      }
      
      // Remove entries older than 3 days
      const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
      recent = recent.filter(item => {
        const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
        return timestamp > threeDaysAgo;
      });
      
      // Save cleaned list
      if (recent.length !== (await getStorage('recentSearches') || []).length) {
        await setStorage({ recentSearches: recent });
      }
      
      allRecentSearches = recent;
      
      if (recent.length === 0) {
        recentDiv.innerHTML = '<div class="empty-state">No recent searches yet. Select words on web pages to see them here!</div>';
        return;
      }

      renderRecentSearches();
    } catch (e) {
      console.error('Error loading recent', e);
      recentDiv.innerHTML = '<div class="empty-state">Error loading recent searches</div>';
    }
  }

  function renderRecentSearches() {
    if (recentExpanded) {
      // Show table view with all searches
      const tableHTML = `
        <div class="recent-table-container">
          <div class="recent-table-header">
            <span>All Recent Searches (${allRecentSearches.length})</span>
            <button class="clear-all-btn" id="clearAllRecent">Clear All</button>
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
                  <button class="recent-remove-btn" data-index="${index}" title="Remove">×</button>
                </div>
              `;
            }).join('')}
          </div>
          <button class="collapse-btn" id="collapseRecent">Show Less</button>
        </div>
      `;
      recentDiv.innerHTML = tableHTML;
      
      // Add event handlers
      recentDiv.querySelectorAll('.recent-table-word').forEach(el => {
        el.addEventListener('click', () => {
          showWordDetails(el.dataset.word);
        });
      });
      
      recentDiv.querySelectorAll('.recent-remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const index = parseInt(btn.dataset.index);
          await removeRecentSearch(index);
        });
      });
      
      document.getElementById('clearAllRecent').addEventListener('click', async () => {
        if (confirm('Clear all recent searches?')) {
          await setStorage({ recentSearches: [] });
          allRecentSearches = [];
          recentExpanded = false;
          await loadRecent();
        }
      });
      
      document.getElementById('collapseRecent').addEventListener('click', () => {
        recentExpanded = false;
        renderRecentSearches();
      });
    } else {
      // Show first 10 with Load More button
      const first10 = allRecentSearches.slice(0, 10);
      const hasMore = allRecentSearches.length > 10;
      
      const listHTML = `
        ${first10.map(item => {
          const word = typeof item === 'string' ? item : item.word;
          return `
            <div class="word-item">
              <span class="word" data-word="${word}">${word}</span>
            </div>
          `;
        }).join('')}
        ${hasMore ? `<button class="load-more-btn" id="loadMoreRecent">Load More (${allRecentSearches.length - 10} more)</button>` : ''}
      `;
      
      recentDiv.innerHTML = listHTML;
      
      // Add click handlers
      recentDiv.querySelectorAll('.word').forEach(el => {
        el.addEventListener('click', () => {
          showWordDetails(el.dataset.word);
        });
      });
      
      if (hasMore) {
        document.getElementById('loadMoreRecent').addEventListener('click', () => {
          recentExpanded = true;
          renderRecentSearches();
        });
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

  async function loadWordOfDay() {
    wordOfDayDiv.innerHTML = '<div class="loading">Loading word of the day...</div>';

    try {
      // Get a random word from a list or generate one
      const word = await getRandomWord();
      
      if (!word) {
        throw new Error('No word generated');
      }
      
      // Get detailed explanation with pronunciation and examples
      const details = await getWordOfDayDetails(word);
      
      if (!details) {
        throw new Error('No details returned');
      }
      
      displayWordOfDay(word, details);
    } catch (e) {
      console.error('Error loading word of day', e);
      wordOfDayDiv.innerHTML = `
        <div class="word-card-modal">
          <div class="word-card-header">
            <div class="word-of-day-title">Word of the Day</div>
          </div>
          <div class="empty-state">Error loading word of the day.</div>
        </div>
      `;
    }
  }

  async function getRandomWord() {
    try {
      // List of interesting words
      const words = [
        'serendipity', 'ephemeral', 'eloquent', 'resilient', 'mellifluous',
        'ubiquitous', 'perspicacious', 'luminous', 'effervescent', 'quintessential',
        'enigmatic', 'pragmatic', 'vivacious', 'tenacious', 'magnanimous',
        'sagacious', 'benevolent', 'audacious', 'fastidious', 'gregarious',
        'diligent', 'profound', 'ingenious', 'meticulous', 'eloquent',
        'ambitious', 'courageous', 'generous', 'optimistic', 'passionate'
      ];
      
      // Check if we have a stored word of the day for today
      const today = new Date().toISOString().slice(0, 10);
      const stored = await getStorage('wordOfDay');
      
      if (stored && stored.date === today && stored.word) {
        return stored.word;
      }
      
      // Pick random word
      const word = words[Math.floor(Math.random() * words.length)];
      
      // Store for today
      await setStorage({ wordOfDay: { date: today, word } });
      
      return word;
    } catch (e) {
      console.error('Error getting random word', e);
      // Fallback to a default word
      return 'serendipity';
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
          
          chrome.runtime.sendMessage({ 
            type: 'explain', 
            word: word, 
            context: '',
            detailed: true
          }, (response) => {
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

      if (resp && !resp.error) {
        return {
          explanation: resp.explanation || `A definition for "${word}"`,
          synonyms: resp.synonyms || [],
          pronunciation: resp.pronunciation || getPronunciation(word),
          examples: resp.examples || []
        };
      } else {
        // If error, return fallback with error message
        return {
          explanation: resp?.error || `Could not load definition for "${word}"`,
          synonyms: [],
          pronunciation: getPronunciation(word),
          examples: []
        };
      }
    } catch (e) {
      console.error('Error getting word details', e);
      // Fallback
      return {
        explanation: `Error loading definition: ${e.message}`,
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
                ${details.pronunciation ? `<span class="word-card-phonetic">${details.pronunciation}</span>` : ''}
              </div>
              <button class="word-card-copy-btn" id="wotdCopyBtn" title="Copy word">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="word-of-day-title">Word of the Day</div>
        </div>
        <div class="word-card-explanation">${details.explanation}</div>
        ${details.examples && details.examples.length > 0 ? `
          <div class="word-card-examples-container">
            <div class="word-card-examples-label">Examples</div>
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
              Synonyms
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
        console.error('Failed to copy', e);
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
    
    // Make synonyms clickable
    wordOfDayDiv.querySelectorAll('.word-card-synonym-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        showWordDetails(tag.dataset.synonym);
      });
    });
  }

  // Helper functions
  function getStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (res) => {
        resolve(res[key]);
      });
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
            console.error('Storage error', chrome.runtime.lastError);
          }
          resolve();
        });
      } catch (e) {
        console.error('Storage set error', e);
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
        console.log('CursorIQ: Incognito mode detected, not saving to recent');
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
    
    // Remove entries older than 3 days
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const cleaned = filtered.filter(item => {
      const timestamp = typeof item === 'string' ? Date.now() : item.timestamp;
      return timestamp > threeDaysAgo;
    });
    
    await setStorage({ recentSearches: cleaned.slice(0, 50) });
  }

  // Make loadWordOfDay available globally for onclick
  window.loadWordOfDay = loadWordOfDay;

})();

