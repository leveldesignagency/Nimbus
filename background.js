/* background.js - MV3 service worker
   Receives messages from content script and calls OpenAI.
   API key is stored securely on Vercel server.
   Also fetches synonyms.
*/

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

// Listen for Stripe checkout tab updates - close tab and verify subscription
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Close tab as soon as it tries to load the extension URL (before DNS error)
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      const url = new URL(tab.url);
      const sessionId = url.searchParams.get('session_id');
      const success = url.searchParams.get('success');
      const cancelled = url.searchParams.get('cancelled');
      
      // If this is a Stripe redirect to our extension URL, close immediately
      if ((sessionId || cancelled) && (tab.url.includes('chrome-extension://') || tab.url.includes('popup.html'))) {
        // Close the tab immediately to prevent DNS error
        chrome.tabs.remove(tabId).catch(() => {});
        
        // If successful payment, verify subscription
        if (sessionId && success === 'true') {
          console.log('Background: Processing successful payment, sessionId:', sessionId);
          
          // Verify subscription in background
          (async () => {
            try {
              // Get session details
              const response = await fetch('https://nimbus-api-ten.vercel.app/api/get-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId }),
              });
              
              console.log('Background: get-session response status:', response.status);
              
              if (response.ok) {
                const data = await response.json();
                console.log('Background: get-session response data:', data);
                
                if (data.valid) {
                  // Save subscription
                  await chrome.storage.local.set({
                    subscriptionId: data.subscriptionId,
                    subscriptionExpiry: data.expiryDate,
                    subscriptionActive: true,
                    userEmail: data.email || '',
                  });
                  
                  console.log('Background: Subscription activated successfully:', data.subscriptionId);
                  
                  // Notify all extension pages to reload
                  chrome.runtime.sendMessage({ action: 'subscriptionActivated' }).catch(() => {});
                  
                  // Also try to notify popup directly
                  chrome.tabs.query({ url: chrome.runtime.getURL('popup.html') }, (tabs) => {
                    tabs.forEach(t => {
                      chrome.tabs.reload(t.id).catch(() => {});
                    });
                  });
                } else {
                  console.error('Background: Subscription not valid:', data.error);
                }
              } else {
                const errorText = await response.text();
                console.error('Background: get-session failed:', response.status, errorText);
              }
            } catch (e) {
              console.error('Background: Error verifying subscription:', e);
            }
          })();
        }
      }
    } catch (e) {
      // If URL parsing fails, check if it's trying to load extension URL and close anyway
      if (tab.url && (tab.url.includes('chrome-extension://') || tab.url.includes('popup.html'))) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
    }
  }
});

// Vercel API endpoint for OpenAI proxy
const VERCEL_API_URL = 'https://nimbus-api-ten.vercel.app/api/chat';

// CRITICAL: Set up message listener IMMEDIATELY
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'openPopup') {
    // Open the extension popup
    try {
      chrome.action.openPopup();
      sendResponse({ success: true });
      return true;
    } catch (err) {
      console.error('Nimbus Background: Error opening popup:', err);
      sendResponse({ success: false, error: err.message });
      return true;
    }
  }
  if (msg && msg.action === 'openPayment') {
    // Open the extension popup for payment
    try {
      chrome.action.openPopup();
      sendResponse({ success: true });
      return true;
    } catch (err) {
      console.error('Nimbus Background: Error opening popup:', err);
      sendResponse({ success: false, error: err.message });
      return true;
    }
  }
  if (msg && msg.type === 'chat') {
    (async () => {
      if (VERCEL_API_URL === 'YOUR_VERCEL_URL_HERE/api/chat') {
        sendResponse({ error: 'Vercel API URL not configured. Please update background.js with your Vercel API URL.' });
        return;
      }
      
      const cfg = await chrome.storage.local.get(['style', 'model']);
      const style = cfg.style || 'plain';
      const model = cfg.model || 'gpt-4o-mini';
      
      try {
        // Build conversation context with usage limits
        const systemPrompt = `You are a thoughtful, conversational research assistant having a natural discussion with the user. Respond naturally based on what they're asking - be curious about complex topics, helpful with explanations, analytical with concepts, and engaging with ideas. Vary your opening based on the context: acknowledge interesting points, ask clarifying questions, share insights, or dive straight into the topic. Write as if you're genuinely thinking through the question with them, not reciting a formula. Be warm and approachable, but let your personality and response style adapt to what makes sense for each specific question. Keep responses concise (100-150 words) and conversational.

IMPORTANT LIMITATIONS:
- You CANNOT generate, create, or produce images, pictures, illustrations, or any visual content. If asked, politely explain that image generation is not available.
- You CANNOT create Word documents, PDFs, or other file formats. If asked, suggest that users can copy your text responses into their document editor.
- When providing code examples, format them clearly in code blocks with proper syntax highlighting. Keep code examples concise and well-commented.
- You are a text-based assistant focused on explanations, research, and conversation - not file creation or image generation.`;

        const messages = [
          { role: 'system', content: systemPrompt },
          ...msg.conversationHistory.map(msg => ({ role: msg.role, content: msg.content })),
          { role: 'user', content: msg.message }
        ];
        
        const resp = await fetch(VERCEL_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.8
          })
        });
        
        if (resp.ok) {
          const json = await resp.json();
          const text = json.choices?.[0]?.message?.content?.trim();
          sendResponse({ explanation: text || 'No response' });
        } else {
          const errorData = await resp.json().catch(() => ({ error: `API error: ${resp.status}` }));
          sendResponse({ error: errorData.error || `API error: ${resp.status}` });
        }
      } catch (err) {
        console.error('Nimbus Background: Chat error:', err);
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
  if (msg && msg.type === 'explain') {
    const isDetailed = msg.detailed || false;
    
    // CRITICAL: Return true to indicate we will send a response asynchronously
    // Use async IIFE to handle the promise properly
    (async () => {
      try {
        const resp = await handleExplain(msg.word, msg.context, isDetailed);
        // FORCE synonyms to be an array - ensure it's never undefined or null
        if (!Array.isArray(resp.synonyms)) {
          resp.synonyms = resp.synonyms ? [resp.synonyms] : [];
        }
        
        // Double-check it's an array
        resp.synonyms = Array.isArray(resp.synonyms) ? resp.synonyms : [];
        
        sendResponse(resp);
      } catch (err) {
        console.error('Nimbus Background: ========== HANDLE EXPLAIN ERROR ==========');
        console.error('Nimbus Background: Error message:', err.message);
        console.error('Nimbus Background: Error stack:', err.stack);
        const errorResponse = { 
          error: err.message || 'unknown error', 
          synonyms: [],
          explanation: null
        };
        console.error('Nimbus Background: Sending error response:', errorResponse);
        sendResponse(errorResponse);
      }
    })();
    
    return true; // CRITICAL: Indicates we will send a response asynchronously
    return true; // keep channel open for async
  }
  if (msg && msg.action === 'checkIncognito') {
    // Check if the sender tab is in incognito mode
    // sender.tab.incognito is available in Manifest V3
    const isIncognito = sender && sender.tab && sender.tab.incognito === true;
    sendResponse({ isIncognito: isIncognito });
    return true;
  }
  if (msg && msg.type === 'sendContactEmail') {
    handleSendContactEmail(msg.data).then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // keep channel open for async
  }
  return false;
});

// Smart routing: Determine if term should use AI or dictionary
function shouldUseAI(term, context, dictionaryResult) {
  // For phrases (3+ words), always use AI
  const wordCount = term.trim().split(/\s+/).filter(w => w.trim().length > 0).length;
  if (wordCount >= 3) {
    return true;
  }
  
  // Use AI if:
  // 1. Dictionary failed or returned poor result
  if (!dictionaryResult || dictionaryResult.error || !dictionaryResult.explanation) {
    return true;
  }
  
  // 2. Term is complex (hyphenated, compound, technical)
  const isComplex = term.includes('-') || 
                   term.length > 15 || 
                   /[A-Z]{2,}/.test(term) || // Acronyms
                   /^(anti|auto|bio|cardio|derm|endo|gastro|hemo|neuro|osteo|patho|psycho|pulmo|thrombo)/i.test(term) ||
                   /(itis|osis|emia|oma|pathy|scopy|tomy|ectomy|plasty)$/i.test(term);
  
  // 3. Context is complex (multiple meanings possible)
  const hasComplexContext = context && (
    context.toLowerCase().includes(term.toLowerCase() + ' ') || // Word appears in context
    context.split(/\s+/).length > 10 // Long context
  );
  
  // 4. Dictionary result is too generic or short
  const isGeneric = dictionaryResult.explanation && (
    dictionaryResult.explanation.length < 50 ||
    dictionaryResult.explanation.toLowerCase().includes('not found') ||
    dictionaryResult.explanation.toLowerCase().includes('no definition')
  );
  
  return isComplex || (hasComplexContext && isGeneric);
}

// Check if term is a common word (should use dictionary first)
function isCommonWord(term) {
  const commonWords = [
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
    'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
    'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
    'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
    'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us'
  ];
  
  return commonWords.includes(term.toLowerCase()) && term.length < 10;
}

async function handleExplain(term, context, detailed = false) {
  const cfg = await chrome.storage.local.get(['style','model','useFreeAPI','settings']);
  
  // API key is now stored securely on Vercel backend
  // No need to read from storage
  
  const style = cfg.style || 'plain';
  const model = cfg.model || 'gpt-4o-mini';
  // Get dictionary language from settings (default to 'en')
  const dictionaryLanguage = cfg.settings?.dictionaryLanguage || 'en';

  // Check if this might be a person, organization, place, or notable entity
  // Look for capitalized words (proper nouns) - more flexible pattern
  const trimmedTerm = term.trim();
  const termLower = trimmedTerm.toLowerCase();
  
  // EXCLUDE medical/anatomical terms - these should use dictionary/modal, not hub
  const medicalExclusions = [
    // Common medical/anatomical terms
    'gallbladder', 'liver', 'kidney', 'stomach', 'intestine', 'bladder', 'spleen', 'pancreas',
    'heart', 'lung', 'brain', 'muscle', 'bone', 'nerve', 'vein', 'artery', 'cell', 'tissue',
    'organ', 'organelle', 'molecule', 'protein', 'enzyme', 'hormone', 'vitamin', 'mineral',
    'bile', 'blood', 'plasma', 'serum', 'urine', 'saliva', 'mucus', 'phlegm',
    'cartilage', 'ligament', 'tendon', 'joint', 'spine', 'skull', 'rib', 'pelvis',
    'esophagus', 'trachea', 'bronchus', 'alveolus', 'diaphragm', 'pleura',
    'duodenum', 'jejunum', 'ileum', 'colon', 'rectum', 'anus',
    'nephron', 'glomerulus', 'ureter', 'urethra',
    'neuron', 'synapse', 'dendrite', 'axon', 'myelin',
    'chromosome', 'gene', 'dna', 'rna', 'nucleotide',
    // Medical conditions
    'diabetes', 'cancer', 'flu', 'cold', 'fever', 'headache', 'pain', 'disease', 'syndrome',
    // Medical term patterns
    /^(anti|auto|bio|cardio|derm|endo|gastro|hemo|neuro|osteo|patho|psycho|pulmo|thrombo)/i,
    /(itis|osis|emia|oma|pathy|scopy|tomy|ectomy|plasty|algia|cele|cyte|genesis|gram|graph|lysis|megaly|phage|philia|phobia|plasia|plegia|pnea|rrhea|scope|stasis|trophy|uria)$/i
  ];
  
  // Check if term matches medical exclusions
  const isMedicalTerm = medicalExclusions.some(exclusion => {
    if (typeof exclusion === 'string') {
      return termLower === exclusion || termLower.includes(exclusion);
    } else if (exclusion instanceof RegExp) {
      return exclusion.test(trimmedTerm);
    }
    return false;
  });
  
  if (isMedicalTerm) {
    // Skip entity detection, fall through to dictionary lookup (modal)
  } else {
    // More flexible pattern: allows hyphens, apostrophes, multiple capitals (e.g., McDonald, O'Brien, Mary-Jane)
    // Also allows common organization suffixes
    const isLikelyEntity = /^[A-Z][A-Za-z'\-]+(\s+[A-Z][A-Za-z'\-]+)*(\s+(Inc|LLC|Ltd|Corp|Company|Corporation|Foundation|Institute|University|College|Group|Organization|Org))?$/i.test(trimmedTerm) && 
                          trimmedTerm.split(/\s+/).length >= 1 && 
                          trimmedTerm.split(/\s+/).length <= 6 && // Increased to 6 for organizations
                          trimmedTerm.length >= 2 &&
                          trimmedTerm.length <= 80; // Increased for organization names
    
    if (isLikelyEntity) {
    try {
      // First try to fetch from Wikipedia
      const entityData = await fetchEntityFromWikipedia(term);
      
      if (entityData) {
        if (entityData.isPerson) {
          
          // Fetch recent news about the person
          const newsArticles = await fetchPersonNews(term);
          
          return {
            explanation: entityData.bio,
            synonyms: [],
            pronunciation: null,
            examples: [],
            isPerson: true,
            personData: {
              name: entityData.name,
              image: entityData.image,
              birthDate: entityData.birthDate,
              age: entityData.age,
              occupation: entityData.occupation,
              nationality: entityData.nationality,
              relationships: entityData.relationships,
              notableWorks: entityData.notableWorks,
              summary: entityData.summary,
              wikipediaUrl: entityData.wikipediaUrl,
              newsArticles: newsArticles || []
            }
          };
        } else if (entityData.isOrganization) {
          // Fetch recent news about the organization
          const newsArticles = await fetchPersonNews(term); // Reuse same function
          
          return {
            explanation: entityData.bio,
            synonyms: [],
            pronunciation: null,
            examples: [],
            isOrganization: true,
            organizationData: {
              name: entityData.name,
              image: entityData.image,
              founded: entityData.founded,
              headquarters: entityData.headquarters,
              industry: entityData.industry,
              relatedCompanies: entityData.relatedCompanies,
              keyPeople: entityData.keyPeople,
              revenue: entityData.revenue,
              employees: entityData.employees,
              summary: entityData.summary,
              wikipediaUrl: entityData.wikipediaUrl,
              newsArticles: newsArticles || []
            }
          };
        } else if (entityData.isPlace) {
          // Fetch recent news about the place
          const newsArticles = await fetchPersonNews(term);
          
          return {
            explanation: entityData.bio,
            synonyms: [],
            pronunciation: null,
            examples: [],
            isPlace: true,
            placeData: {
              name: entityData.name,
              image: entityData.image,
              population: entityData.population,
              country: entityData.country,
              coordinates: entityData.coordinates,
              area: entityData.area,
              elevation: entityData.elevation,
              timeZone: entityData.timeZone,
              summary: entityData.summary,
              wikipediaUrl: entityData.wikipediaUrl,
              newsArticles: newsArticles || []
            }
          };
        }
      } else {
      }
    } catch (err) {
      // Continue to dictionary lookup
    }
    }
  }

  // SMART ROUTING: ALWAYS try dictionary first, then AI if dictionary fails
  let dictionaryResult = null;
  
  // For statements (3+ words), skip dictionary and go straight to AI
  const wordCount = term.trim().split(/\s+/).filter(w => w.trim().length > 0).length;
  const isStatement = wordCount >= 3;
  
  // ALWAYS try dictionary first (fast, free) for ALL words, EXCEPT statements
  if (!isStatement) {
    try {
      dictionaryResult = await fetchFreeDictionary(term, dictionaryLanguage);
    
    // Fix synonyms array
    if (!dictionaryResult.synonyms) {
      dictionaryResult.synonyms = [];
    } else if (!Array.isArray(dictionaryResult.synonyms)) {
      dictionaryResult.synonyms = [dictionaryResult.synonyms];
    }
    dictionaryResult.synonyms = Array.isArray(dictionaryResult.synonyms) ? dictionaryResult.synonyms : [];
    
      // If dictionary succeeded with good result, return it
      if (dictionaryResult && !dictionaryResult.error && dictionaryResult.explanation && 
          dictionaryResult.explanation.length > 20 && 
          !dictionaryResult.explanation.toLowerCase().includes('not found') &&
          !dictionaryResult.explanation.toLowerCase().includes('no definition')) {
        return dictionaryResult;
      }
    } catch (err) {
      dictionaryResult = { error: err.message };
    }
  } else {
  }
  
  // If dictionary failed or result is poor, use AI (if available)
  // For statements, always use AI
  const useAI = VERCEL_API_URL !== 'YOUR_VERCEL_URL_HERE/api/chat' && (isStatement || shouldUseAI(term, context, dictionaryResult));
  
  if (VERCEL_API_URL === 'YOUR_VERCEL_URL_HERE/api/chat') {
    return {
      error: 'Vercel API not configured. Using free dictionary only.',
      explanation: null,
      synonyms: [],
      examples: []
    };
  }
  
  if (useAI) {
    if (VERCEL_API_URL === 'YOUR_VERCEL_URL_HERE/api/chat') {
      throw new Error('Vercel API not configured. Please update background.js with your Vercel API URL.');
    }
    
    try {
      const prompt = buildPrompt(term, context, style);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, wordCount >= 3 ? 30000 : 20000); // Longer timeout for statements
      
      let resp;
      try {
        resp = await fetch(VERCEL_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: wordCount >= 3 ? 0.8 : 0.7
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
      
      if (resp.ok) {
        const json = await resp.json();
        
        const text = json.choices?.[0]?.message?.content?.trim();
        
        if (!text || text.length === 0) {
          throw new Error('AI returned empty response');
        }
        
        const synonyms = await extractSynonyms(term, model);
        
        // For statements (3+ words), fetch relevant news/articles
        let newsArticles = [];
        if (wordCount >= 3) {
          try {
            newsArticles = await fetchPersonNews(term); // Reuse news function for any topic
          } catch (err) {
            // News fetch failed, continue without news
          }
        }
        
        const aiResult = {
          explanation: text,
          synonyms: synonyms || [],
          pronunciation: dictionaryResult?.pronunciation || null,
          examples: detailed ? await generateExamples(term, model) : [],
          newsArticles: newsArticles || [] // Add news articles for statements
        };
        
        return aiResult;
      } else {
        const errorText = await resp.text();
        console.error('Nimbus: ========== AI REQUEST FAILED ==========');
        console.error('Nimbus: Status:', resp.status);
        console.error('Nimbus: Status text:', resp.statusText);
        console.error('Nimbus: Error response:', errorText);
        
        // Parse error to give better message
        let errorMessage = `AI request failed: ${resp.status} ${resp.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error) {
            errorMessage = errorJson.error.message || errorJson.error.code || errorMessage;
            console.error('Nimbus: Parsed error:', errorJson.error);
          }
        } catch (e) {
          // Not JSON, use raw text
        }
        
        // Throw error so it can be caught and returned properly
        throw new Error(errorMessage);
      }
    } catch (err) {
      console.error('Nimbus: ========== AI REQUEST ERROR ==========');
      console.error('Nimbus: Error message:', err.message);
      console.error('Nimbus: Error stack:', err.stack);
      
      // If it's an abort error, return a timeout message
      if (err.name === 'AbortError') {
        throw new Error('AI request timed out. Please try again.');
      }
      
      // Check for specific API errors
      if (err.message && err.message.includes('401')) {
        throw new Error('Invalid API key. Please check your OpenAI API key in settings.');
      }
      if (err.message && err.message.includes('429')) {
        throw new Error('API rate limit exceeded. Please try again later.');
      }
      if (err.message && err.message.includes('insufficient_quota')) {
        throw new Error('API quota exceeded. Please check your OpenAI account billing.');
      }
      
      // Re-throw to be caught by outer handler
      throw err;
    }
  }
  
  // If we got here and dictionary failed, return error result for statements
  if (wordCount >= 3 && (!dictionaryResult || dictionaryResult.error)) {
    console.error('Nimbus: Statement search failed - no AI result and no dictionary result');
    console.error('Nimbus: useAI was:', useAI, 'Vercel API configured:', VERCEL_API_URL !== 'YOUR_VERCEL_URL_HERE/api/chat');
    if (VERCEL_API_URL === 'YOUR_VERCEL_URL_HERE/api/chat') {
      return {
        explanation: 'Vercel API not configured. Using free dictionary only.',
        synonyms: [],
        pronunciation: null,
        examples: [],
        error: 'API not configured'
      };
    }
    return {
      explanation: 'Unable to find information about this statement. Please try again or check your connection.',
      synonyms: [],
      pronunciation: null,
      examples: [],
      error: 'Search failed'
    };
  }
  
  // Return dictionary result (or enhanced with AI if available)
  if (dictionaryResult && !dictionaryResult.error) {
    // Enhance dictionary result with AI examples if available and detailed
    if (detailed && VERCEL_API_URL !== 'YOUR_VERCEL_URL_HERE/api/chat' && dictionaryResult.explanation) {
      if (!dictionaryResult.examples || dictionaryResult.examples.length === 0) {
        try {
          const generatedExamples = await generateExamples(term, model);
          if (generatedExamples && generatedExamples.length > 0) {
            dictionaryResult.examples = generatedExamples.filter(ex => 
              !ex.toLowerCase().includes(`the word "${term}"`) &&
              !ex.toLowerCase().includes('commonly used') &&
              ex.toLowerCase().includes(term.toLowerCase())
            );
          }
        } catch (err) {
        }
      }
    }
    
    // Translate examples if needed
    if (dictionaryLanguage !== 'en' && dictionaryResult.examples && dictionaryResult.examples.length > 0) {
      const translatedExamples = [];
      for (const example of dictionaryResult.examples) {
        const translated = await translateText(example, dictionaryLanguage);
        translatedExamples.push(translated);
      }
      dictionaryResult.examples = translatedExamples;
    }
    
    return dictionaryResult;
  }
  
  // Last resort: return error
  return {
    error: VERCEL_API_URL !== 'YOUR_VERCEL_URL_HERE/api/chat'
      ? 'Unable to find definition. Please try again.' 
      : 'Free dictionary API failed. AI enhancement requires Vercel API configuration.',
    synonyms: []
  };

}

async function fetchFreeDictionary(term, language = 'en') {
  // Free Dictionary API - no key required
  // language: language code (en, es, fr, de, etc.)
  
  try {
    // Preserve original case for proper nouns and capitalized words, but lowercase for common words
    // Some languages (like German) capitalize all nouns, so we need to try both
    const termLower = term.toLowerCase();
    const termOriginal = term;
    
    // For German, also try with first letter capitalized (standard for nouns)
    const termGermanCase = language === 'de' && termOriginal !== termLower 
      ? termOriginal.charAt(0).toUpperCase() + termOriginal.slice(1).toLowerCase()
      : termOriginal;
    
    const attempts = [];
    if (termOriginal !== termLower) {
      attempts.push({ term: termOriginal, desc: 'original case' });
    }
    if (termGermanCase !== termOriginal && termGermanCase !== termLower) {
      attempts.push({ term: termGermanCase, desc: 'German case' });
    }
    attempts.push({ term: termLower, desc: 'lowercase' });
    
    // For hyphenated words, also try without hyphen and with different hyphen positions
    if (termOriginal.includes('-')) {
      const withoutHyphen = termOriginal.replace(/-/g, '');
      const withoutHyphenLower = withoutHyphen.toLowerCase();
      attempts.push({ term: withoutHyphen, desc: 'without hyphen' });
      attempts.push({ term: withoutHyphenLower, desc: 'without hyphen lowercase' });
      
      // For medical compound terms, try with space instead of hyphen
      const withSpace = termOriginal.replace(/-/g, ' ');
      attempts.push({ term: withSpace, desc: 'with space instead of hyphen' });
      attempts.push({ term: withSpace.toLowerCase(), desc: 'with space lowercase' });
    }
    
    let resp = null;
    let lastError = null;
    
    // Try each variation
    for (const attempt of attempts) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const url = `https://api.dictionaryapi.dev/api/v2/entries/${language}/${encodeURIComponent(attempt.term)}`;
      
      try {
        resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (resp.ok) {
          break; // Success, exit loop
        } else if (resp.status !== 404) {
          // Non-404 error, don't try other variations
          lastError = `Dictionary API error: ${resp.status}`;
          break;
        } else {
          lastError = 'Word not found';
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          lastError = 'Request timeout';
        } else {
          lastError = err.message;
        }
        // Continue to next attempt
      }
    }
    
    if (!resp || !resp.ok) {
      if (resp && resp.status === 404) {
        
        // For German, try Wiktionary API as fallback
        if (language === 'de') {
          const wiktionaryResult = await tryWiktionary(term, language);
          if (wiktionaryResult) {
            return wiktionaryResult;
          }
        }
        
        // Try medical dictionaries as fallback ONLY for terms that look medical
        // Skip medical dictionary for common words (short, common terms like "christmas", "hello", etc.)
        const isLikelyMedical = term.length > 8 || /[A-Z]{2,}/.test(term) || term.includes('-') || term.includes('itis') || term.includes('osis') || term.includes('emia') || 
                                /^(oesophago|gastro|cardio|neuro|derm|endo|hemo|osteo|patho|psycho|pulmo|thrombo)/i.test(term) ||
                                /(gastric|oesophageal|esophageal|intestinal|hepatic|renal|cardiac|pulmonary|neural|dermal)/i.test(term);
        if (isLikelyMedical) {
          const medicalResult = await tryMedicalDictionaries(term);
          if (medicalResult) {
            return medicalResult;
          }
          
          // For hyphenated medical terms, try splitting and explaining the parts
          if (term.includes('-')) {
            const parts = term.split('-').filter(p => p.length > 0);
            if (parts.length >= 2) {
              // Try to get definitions for each part
              const partDefinitions = [];
              for (const part of parts) {
                try {
                  const partResult = await fetchFreeDictionary(part, language);
                  if (partResult && partResult.explanation && !partResult.error) {
                    partDefinitions.push(`${part}: ${partResult.explanation.substring(0, 100)}`);
                  }
                } catch (err) {
                  // Skip if part lookup fails
                }
              }
              
              if (partDefinitions.length > 0) {
                const combinedExplanation = `"${term}" is a medical compound term combining: ${partDefinitions.join('; ')}. This typically refers to anatomical structures or medical conditions involving both components.`;
                return {
                  explanation: combinedExplanation,
                  synonyms: [],
                  pronunciation: null,
                  examples: []
                };
              }
            }
          }
        } else {
        }
        
        // For German compound words that weren't found, try to break them down
        if (language === 'de') {
          // Try to find the word parts (common German compound patterns)
          const commonEndings = ['jahr', 'tag', 'zeit', 'haus', 'platz', 'stadt', 'land', 'mann', 'frau', 'kind'];
          for (const ending of commonEndings) {
            if (term.toLowerCase().endsWith(ending) && term.length > ending.length + 3) {
              const baseWord = term.slice(0, -ending.length);
              const baseResult = await tryWiktionary(baseWord, language);
              if (baseResult) {
                const compoundMessages = {
                  'en': `"${term}" is a compound word made from "${baseWord}" and "${ending}".`,
                  'es': `"${term}" es una palabra compuesta formada por "${baseWord}" y "${ending}".`,
                  'fr': `"${term}" est un mot composé formé de "${baseWord}" et "${ending}".`,
                  'de': `"${term}" ist ein zusammengesetztes Wort aus "${baseWord}" und "${ending}".`,
                  'it': `"${term}" è una parola composta formata da "${baseWord}" e "${ending}".`,
                  'pt': `"${term}" é uma palavra composta formada por "${baseWord}" e "${ending}".`,
                  'ru': `"${term}" - это составное слово, образованное из "${baseWord}" и "${ending}".`,
                  'ja': `"${term}"は"${baseWord}"と"${ending}"からなる複合語です。`,
                  'zh': `"${term}"是由"${baseWord}"和"${ending}"组成的复合词。`,
                  'ko': `"${term}"은(는) "${baseWord}"와(과) "${ending}"로 구성된 복합어입니다.`,
                  'ar': `"${term}" هي كلمة مركبة مكونة من "${baseWord}" و "${ending}".`,
                  'hi': `"${term}" "${baseWord}" और "${ending}" से बना एक यौगिक शब्द है।`,
                  'nl': `"${term}" is een samengesteld woord gemaakt van "${baseWord}" en "${ending}".`,
                  'sv': `"${term}" är ett sammansatt ord gjort av "${baseWord}" och "${ending}".`,
                  'pl': `"${term}" to słowo złożone utworzone z "${baseWord}" i "${ending}".`
                };
                return {
                  explanation: `${compoundMessages[language] || compoundMessages['en']} ${baseResult.explanation}`,
                  synonyms: baseResult.synonyms || [],
                  pronunciation: null,
                  examples: baseResult.examples || []
                };
              }
            }
          }
          
          // If still not found and it's a long word, provide helpful message in target language
          if (term.length > 8) {
            const errorMessages = {
              'de': `"${term}" wurde im Wörterbuch nicht gefunden. Dies könnte ein zusammengesetztes Wort, ein Fachbegriff oder ein Eigennamen sein. Versuchen Sie, nach einzelnen Teilen des Wortes zu suchen.`,
              'es': `"${term}" no se encontró en el diccionario. Esto podría ser una palabra compuesta, un término técnico o un nombre propio. Intente buscar partes individuales de la palabra.`,
              'fr': `"${term}" n'a pas été trouvé dans le dictionnaire. Il pourrait s'agir d'un mot composé, d'un terme technique ou d'un nom propre. Essayez de rechercher des parties individuelles du mot.`,
              'it': `"${term}" non trovato nel dizionario. Potrebbe essere una parola composta, un termine tecnico o un nome proprio. Prova a cercare parti individuali della parola.`,
              'pt': `"${term}" não encontrado no dicionário. Isso pode ser uma palavra composta, um termo técnico ou um nome próprio. Tente procurar partes individuais da palavra.`,
              'ru': `"${term}" не найдено в словаре. Это может быть составное слово, технический термин или имя собственное. Попробуйте искать отдельные части слова.`,
              'ja': `"${term}"は辞書に見つかりませんでした。これは複合語、専門用語、または固有名詞である可能性があります。単語の個別の部分を検索してみてください。`,
              'zh': `"${term}"在字典中未找到。这可能是复合词、技术术语或专有名词。请尝试搜索单词的各个部分。`,
              'ko': `"${term}"이(가) 사전에서 찾을 수 없습니다. 이것은 복합어, 전문 용어 또는 고유 명사일 수 있습니다. 단어의 개별 부분을 검색해 보세요.`,
              'ar': `"${term}" غير موجود في القاموس. قد تكون هذه كلمة مركبة أو مصطلح تقني أو اسم علم. حاول البحث عن أجزاء فردية من الكلمة.`,
              'hi': `"${term}" शब्दकोश में नहीं मिला। यह एक यौगिक शब्द, तकनीकी शब्द या व्यक्तिवाचक संज्ञा हो सकता है। शब्द के अलग-अलग भागों को खोजने का प्रयास करें।`,
              'nl': `"${term}" niet gevonden in het woordenboek. Dit kan een samengesteld woord, een technische term of een eigennaam zijn. Probeer afzonderlijke delen van het woord te zoeken.`,
              'sv': `"${term}" hittades inte i ordboken. Detta kan vara ett sammansatt ord, en teknisk term eller ett egennamn. Försök söka efter enskilda delar av ordet.`,
              'pl': `"${term}" nie znaleziono w słowniku. Może to być słowo złożone, termin techniczny lub nazwa własna. Spróbuj wyszukać poszczególne części słowa.`
            };
            return { 
              explanation: errorMessages[language] || errorMessages['en'],
              synonyms: []
            };
          }
        }
        
        // Standard error message in target language
        const errorMessages = {
          'en': `"${term}" not found in dictionary. This might be a proper noun, technical term, or misspelling.`,
          'es': `"${term}" no se encontró en el diccionario. Esto podría ser un nombre propio, un término técnico o un error ortográfico.`,
          'fr': `"${term}" n'a pas été trouvé dans le dictionnaire. Il pourrait s'agir d'un nom propre, d'un terme technique ou d'une faute d'orthographe.`,
          'de': `"${term}" wurde im Wörterbuch nicht gefunden. Dies könnte ein Eigenname, ein Fachbegriff oder ein Rechtschreibfehler sein.`,
          'it': `"${term}" non trovato nel dizionario. Potrebbe essere un nome proprio, un termine tecnico o un errore di ortografia.`,
          'pt': `"${term}" não encontrado no dicionário. Isso pode ser um nome próprio, um termo técnico ou um erro ortográfico.`,
          'ru': `"${term}" не найдено в словаре. Это может быть имя собственное, технический термин или орфографическая ошибка.`,
          'ja': `"${term}"は辞書に見つかりませんでした。これは固有名詞、専門用語、またはスペルミスである可能性があります。`,
          'zh': `"${term}"在字典中未找到。这可能是专有名词、技术术语或拼写错误。`,
          'ko': `"${term}"이(가) 사전에서 찾을 수 없습니다. 이것은 고유 명사, 전문 용어 또는 철자 오류일 수 있습니다.`,
          'ar': `"${term}" غير موجود في القاموس. قد يكون هذا اسم علم أو مصطلح تقني أو خطأ إملائي.`,
          'hi': `"${term}" शब्दकोश में नहीं मिला। यह एक व्यक्तिवाचक संज्ञा, तकनीकी शब्द या वर्तनी त्रुटि हो सकती है।`,
          'nl': `"${term}" niet gevonden in het woordenboek. Dit kan een eigennaam, een technische term of een spelfout zijn.`,
          'sv': `"${term}" hittades inte i ordboken. Detta kan vara ett egennamn, en teknisk term eller ett stavfel.`,
          'pl': `"${term}" nie znaleziono w słowniku. Może to być nazwa własna, termin techniczny lub błąd ortograficzny.`
        };
        
        return { 
          explanation: errorMessages[language] || errorMessages['en'],
          synonyms: []
        };
      }
      throw new Error(lastError || `Dictionary API error: ${resp?.status || 'unknown'}`);
    }
    
    const data = await resp.json();
    if (!data || !Array.isArray(data) || data.length === 0) {
      const errorMessages = {
        'en': `No definition found for "${term}".`,
        'es': `No se encontró definición para "${term}".`,
        'fr': `Aucune définition trouvée pour "${term}".`,
        'de': `Keine Definition für "${term}" gefunden.`,
        'it': `Nessuna definizione trovata per "${term}".`,
        'pt': `Nenhuma definição encontrada para "${term}".`,
        'ru': `Определение для "${term}" не найдено.`,
        'ja': `"${term}"の定義が見つかりませんでした。`,
        'zh': `未找到"${term}"的定义。`,
        'ko': `"${term}"에 대한 정의를 찾을 수 없습니다.`,
        'ar': `لم يتم العثور على تعريف لـ "${term}".`,
        'hi': `"${term}" के लिए कोई परिभाषा नहीं मिली।`,
        'nl': `Geen definitie gevonden voor "${term}".`,
        'sv': `Ingen definition hittades för "${term}".`,
        'pl': `Nie znaleziono definicji dla "${term}".`
      };
      return { 
        explanation: errorMessages[language] || errorMessages['en'],
        synonyms: []
      };
    }
    
    const entry = data[0];
    console.log('CursorIQ Background: Entry structure:', JSON.stringify(entry, null, 2));
    let explanation = '';
    const synonyms = [];
    let examples = [];
    
    // Collect synonyms from ALL meanings
    if (entry.meanings && entry.meanings.length > 0) {
      console.log('CursorIQ Background: Processing', entry.meanings.length, 'meanings for term:', term);
      for (const meaning of entry.meanings) {
        console.log('CursorIQ Background: Meaning partOfSpeech:', meaning.partOfSpeech);
        console.log('CursorIQ Background: Meaning object keys:', Object.keys(meaning));
        console.log('CursorIQ Background: Meaning synonyms (raw):', meaning.synonyms);
        console.log('CursorIQ Background: Meaning synonyms type:', typeof meaning.synonyms, 'isArray:', Array.isArray(meaning.synonyms));
        
        // Collect synonyms from this meaning level
        if (meaning.synonyms) {
          if (Array.isArray(meaning.synonyms) && meaning.synonyms.length > 0) {
            console.log('CursorIQ Background: Adding meaning-level synonyms:', meaning.synonyms);
            synonyms.push(...meaning.synonyms);
          } else {
            console.log('CursorIQ Background: Meaning synonyms is not a valid array or is empty');
          }
        } else {
          console.log('CursorIQ Background: No synonyms property on meaning');
        }
        
        // Also check definitions for synonyms (some APIs put them here)
        if (meaning.definitions && Array.isArray(meaning.definitions)) {
          console.log('CursorIQ Background: Checking', meaning.definitions.length, 'definitions');
          for (const def of meaning.definitions) {
            if (def.synonyms && Array.isArray(def.synonyms) && def.synonyms.length > 0) {
              console.log('CursorIQ Background: Adding definition-level synonyms:', def.synonyms);
              synonyms.push(...def.synonyms);
            }
          }
        }
      }
    } else {
      console.log('CursorIQ Background: No meanings found in entry');
    }
    console.log('CursorIQ Background: Total collected synonyms before dedupe:', synonyms);
    console.log('CursorIQ Background: Synonyms array length:', synonyms.length);
    
    // Collect ALL examples from ALL definitions
    if (entry.meanings && entry.meanings.length > 0) {
      for (const meaning of entry.meanings) {
        if (meaning.definitions && Array.isArray(meaning.definitions)) {
          for (const def of meaning.definitions) {
            if (def.example && typeof def.example === 'string' && def.example.trim()) {
              examples.push(def.example.trim());
            }
          }
        }
      }
    }
    
    // Get first meaning for explanation (primary definition)
    if (entry.meanings && entry.meanings.length > 0) {
      const meaning = entry.meanings[0];
      if (meaning.definitions && meaning.definitions.length > 0) {
        explanation = meaning.definitions[0].definition;
      }
    }
    
    // Format explanation if still empty
    if (!explanation && entry.meanings) {
      // Try to get any definition
      for (const meaning of entry.meanings) {
        if (meaning.definitions && meaning.definitions.length > 0) {
          explanation = meaning.definitions[0].definition;
          break;
        }
      }
    }
    
    if (!explanation) {
      const errorMessages = {
        'en': `"${term}" found in dictionary but no definition available.`,
        'es': `"${term}" encontrado en el diccionario pero no hay definición disponible.`,
        'fr': `"${term}" trouvé dans le dictionnaire mais aucune définition disponible.`,
        'de': `"${term}" im Wörterbuch gefunden, aber keine Definition verfügbar.`,
        'it': `"${term}" trovato nel dizionario ma nessuna definizione disponibile.`,
        'pt': `"${term}" encontrado no dicionário, mas nenhuma definição disponível.`,
        'ru': `"${term}" найдено в словаре, но определение недоступно.`,
        'ja': `"${term}"は辞書に見つかりましたが、定義は利用できません。`,
        'zh': `"${term}"在字典中找到，但没有可用的定义。`,
        'ko': `"${term}"이(가) 사전에서 발견되었지만 사용 가능한 정의가 없습니다.`,
        'ar': `"${term}" موجود في القاموس ولكن لا يوجد تعريف متاح.`,
        'hi': `"${term}" शब्दकोश में मिला लेकिन कोई परिभाषा उपलब्ध नहीं है।`,
        'nl': `"${term}" gevonden in het woordenboek maar geen definitie beschikbaar.`,
        'sv': `"${term}" hittades i ordboken men ingen definition tillgänglig.`,
        'pl': `"${term}" znaleziono w słowniku, ale brak dostępnej definicji.`
      };
      explanation = errorMessages[language] || errorMessages['en'];
    }
    
    // Format: "Word: definition"
    let formattedExplanation = `${term.charAt(0).toUpperCase() + term.slice(1)}: ${explanation}`;
    
    // Translate explanation to target language if not English
    if (language !== 'en') {
      console.log(`Nimbus: Translating definition to ${language}...`);
      formattedExplanation = await translateText(formattedExplanation, language);
    }
    
    explanation = formattedExplanation;
    
    // Get pronunciation
    let pronunciation = entry.phonetic;
    if (!pronunciation && entry.phonetics && entry.phonetics.length > 0) {
      pronunciation = entry.phonetics[0].text;
    }
    if (!pronunciation) {
      pronunciation = `/${term}/`;
    }
    
    console.log('CursorIQ Background: Raw synonyms before processing:', synonyms);
    console.log('CursorIQ Background: Term being filtered:', term);
    
    // Remove duplicates and filter out the term itself
    const uniqueSynonyms = [...new Set(synonyms)]
      .filter(s => {
        if (!s || typeof s !== 'string') {
          console.log('CursorIQ Background: Filtering out non-string synonym:', s);
          return false;
        }
        const trimmed = s.trim();
        if (!trimmed) {
          console.log('CursorIQ Background: Filtering out empty synonym');
          return false;
        }
        if (trimmed.toLowerCase() === term.toLowerCase()) {
          console.log('CursorIQ Background: Filtering out synonym that matches term:', trimmed);
          return false;
        }
        console.log('CursorIQ Background: Keeping synonym:', trimmed);
        return true;
      })
      .slice(0, 8);
    
    console.log('CursorIQ Background: Final unique synonyms after filtering:', uniqueSynonyms);
    console.log('CursorIQ Background: Synonyms count:', uniqueSynonyms.length);
    
    // FORCE synonyms to be an array - ensure it's never undefined or null
    const finalSynonyms = Array.isArray(uniqueSynonyms) ? uniqueSynonyms : [];
    
    // Remove duplicate examples and filter out meta-text
    const uniqueExamples = [...new Set(examples)]
      .filter(e => {
        if (!e || typeof e !== 'string' || !e.trim() || e.length === 0) return false;
        const lower = e.toLowerCase();
        // Filter out meta-text patterns
        if (lower.includes(`the word "${term}"`) || 
            lower.includes(`"${term}" is`) ||
            lower.includes('commonly used') ||
            lower.includes('is an example') ||
            lower.includes('example of')) {
          return false;
        }
        // Must actually contain the word (case-insensitive)
        if (!lower.includes(term.toLowerCase())) return false;
        return true;
      });
    
    // Translate examples to target language if not English
    let finalExamples = uniqueExamples.slice(0, 5);
    if (language !== 'en' && finalExamples.length > 0) {
      console.log(`Nimbus: Translating ${finalExamples.length} dictionary examples to ${language}...`);
      const translated = [];
      for (const example of finalExamples) {
        const translatedExample = await translateText(example, language);
        translated.push(translatedExample);
      }
      finalExamples = translated;
    }
    
    const result = { 
      explanation, 
      synonyms: finalSynonyms,  // Always an array
      pronunciation: pronunciation
    };
    
    // Add examples if available (up to 5 examples)
    if (finalExamples.length > 0) {
      result.examples = finalExamples;
      console.log('CursorIQ Background: Collected examples:', result.examples);
    } else {
      console.log('CursorIQ Background: No examples found in API response');
    }
    
    console.log('CursorIQ Background: ========== FINAL RESULT ==========');
    console.log('CursorIQ Background: Result object:', JSON.stringify(result, null, 2));
    console.log('CursorIQ Background: Result.synonyms:', result.synonyms);
    console.log('CursorIQ Background: Result.synonyms type:', typeof result.synonyms);
    console.log('CursorIQ Background: Result.synonyms isArray:', Array.isArray(result.synonyms));
    console.log('CursorIQ Background: Result.synonyms length:', result.synonyms.length);
    console.log('CursorIQ Background: Result.examples:', result.examples);
    console.log('CursorIQ Background: Result.examples length:', result.examples?.length || 0);
    console.log('CursorIQ Background: ===================================');
    
    // Add examples if available
    if (examples.length > 0) {
      result.examples = examples.slice(0, 3);
    }
    
    return result;
  } catch (err) {
    console.error('Free dictionary fetch error', err);
    // Check if it's a timeout
    if (err.name === 'AbortError') {
      // Try medical dictionaries on timeout too
      const medicalResult = await tryMedicalDictionaries(term);
      if (medicalResult) {
        return medicalResult;
      }
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    throw err;
  }
}

// Helper function to strip HTML tags and clean text (works in service worker)
function stripHtml(html) {
  if (!html) return '';
  // Remove HTML tags using regex
  let text = html.replace(/<[^>]*>/g, '');
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  // Clean up extra whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// Translate text to target language using free translation API
async function translateText(text, targetLang) {
  if (!text || targetLang === 'en') return text;
  
  try {
    // Language code mapping for translation API
    const langMap = {
      'es': 'es', 'fr': 'fr', 'de': 'de', 'it': 'it', 'pt': 'pt',
      'ru': 'ru', 'ja': 'ja', 'zh': 'zh', 'ko': 'ko', 'ar': 'ar',
      'hi': 'hi', 'nl': 'nl', 'sv': 'sv', 'pl': 'pl'
    };
    
    const targetCode = langMap[targetLang] || targetLang;
    if (!targetCode || targetCode === 'en') return text;
    
    // Use LibreTranslate (free, no key required) or MyMemory as fallback
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // Try LibreTranslate first (better quality)
    try {
      const resp = await fetch('https://libretranslate.de/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: 'en',
          target: targetCode,
          format: 'text'
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.translatedText) {
          console.log(`Nimbus: Translated "${text.substring(0, 50)}..." to ${targetLang}`);
          return data.translatedText;
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name !== 'AbortError') {
        console.log('Nimbus: LibreTranslate failed, trying MyMemory...', err.message);
      }
    }
    
    // Fallback to MyMemory Translation API
    try {
      const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetCode}`;
      const myMemoryController = new AbortController();
      const myMemoryTimeoutId = setTimeout(() => myMemoryController.abort(), 5000);
      const myMemoryResp = await fetch(myMemoryUrl, { signal: myMemoryController.signal });
      clearTimeout(myMemoryTimeoutId);
      
      if (myMemoryResp.ok) {
        const myMemoryData = await myMemoryResp.json();
        if (myMemoryData && myMemoryData.responseData && myMemoryData.responseData.translatedText) {
          console.log(`Nimbus: Translated via MyMemory to ${targetLang}`);
          return myMemoryData.responseData.translatedText;
        }
      }
    } catch (err) {
      console.log('Nimbus: MyMemory translation failed:', err.message);
    }
    
    return text; // Return original if translation fails
  } catch (err) {
    console.log('Nimbus: Translation failed:', err.message);
    return text; // Return original text on error
  }
}

// Try Wiktionary API for languages not well supported by dictionaryapi.dev
async function tryWiktionary(term, language = 'de') {
  try {
    // Wiktionary API - supports many languages including German
    const langCode = language === 'de' ? 'de' : language;
    const termLower = term.toLowerCase();
    const termCapitalized = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
    
    // Try both capitalized (German nouns) and lowercase versions
    const attempts = [termCapitalized, termLower, term];
    
    for (const attempt of attempts) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      // Wiktionary API endpoint
      const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(attempt)}`;
      console.log(`Nimbus: Trying Wiktionary: ${url}`);
      
      try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (resp.ok) {
          const data = await resp.json();
          
          // Check if we have definitions for the requested language
          if (data && typeof data === 'object' && data[langCode]) {
            const langData = data[langCode];
            if (Array.isArray(langData) && langData.length > 0) {
              // Get first entry (usually the most common usage)
              const firstEntry = langData[0];
              let explanation = '';
              const synonyms = [];
              const examples = [];
              
              // Extract definitions
              if (firstEntry.definitions && Array.isArray(firstEntry.definitions) && firstEntry.definitions.length > 0) {
                // Get first definition and strip HTML
                const defText = firstEntry.definitions[0].definition || '';
                explanation = stripHtml(defText);
                
                // If definition is too short or looks like a redirect, try next definition
                if (explanation.length < 10 || explanation.toLowerCase().includes('redirect')) {
                  for (let i = 1; i < firstEntry.definitions.length; i++) {
                    const altDef = stripHtml(firstEntry.definitions[i].definition || '');
                    if (altDef.length > 10 && !altDef.toLowerCase().includes('redirect')) {
                      explanation = altDef;
                      break;
                    }
                  }
                }
                
                // Extract examples from all definitions
                firstEntry.definitions.forEach(def => {
                  if (def.examples && Array.isArray(def.examples)) {
                    def.examples.forEach(ex => {
                      if (typeof ex === 'string') {
                        examples.push(ex);
                      } else if (ex.text) {
                        examples.push(ex.text);
                      }
                    });
                  }
                });
              }
              
              // Extract part of speech for context
              const partOfSpeech = firstEntry.partOfSpeech || '';
              
              if (explanation && explanation.length > 10) {
                // Format explanation with part of speech if available
                let formattedExplanation = attempt;
                if (partOfSpeech) {
                  formattedExplanation += ` (${partOfSpeech}): ${explanation}`;
                } else {
                  formattedExplanation += `: ${explanation}`;
                }
                
                // Translate to target language if not English
                if (language !== 'en') {
                  console.log(`Nimbus: Translating Wiktionary definition to ${language}...`);
                  formattedExplanation = await translateText(formattedExplanation, language);
                }
                
                // Translate examples to target language if not English
                let finalExamples = examples.slice(0, 3).map(ex => stripHtml(ex));
                if (language !== 'en' && finalExamples.length > 0) {
                  console.log(`Nimbus: Translating ${finalExamples.length} Wiktionary examples to ${language}...`);
                  const translated = [];
                  for (const example of finalExamples) {
                    const translatedExample = await translateText(example, language);
                    translated.push(translatedExample);
                  }
                  finalExamples = translated;
                }
                
                console.log(`Nimbus: Wiktionary found definition for "${attempt}"`);
                return {
                  explanation: formattedExplanation,
                  synonyms: synonyms.slice(0, 8),
                  pronunciation: null,
                  examples: finalExamples
                };
              }
            }
          }
        } else if (resp.status !== 404) {
          // Non-404 error, don't try other variations
          console.log(`Nimbus: Wiktionary returned ${resp.status} for "${attempt}"`);
          break;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name !== 'AbortError') {
          console.log(`Nimbus: Wiktionary error for "${attempt}":`, err.message);
        }
        // Continue to next attempt
      }
    }
    
    return null;
  } catch (err) {
    console.log('Nimbus: Wiktionary lookup failed:', err.message);
    return null;
  }
}

// Try multiple free medical dictionary sources
async function tryMedicalDictionaries(term) {
  const medicalSources = [
    fetchNLMClinicalTables,
    fetchMedicalTermsAPI
  ];
  
  // Try each source sequentially until one succeeds
  for (const source of medicalSources) {
    try {
      const result = await source(term);
      if (result && result.explanation && !result.error) {
        console.log('Nimbus: Found in medical dictionary:', source.name);
        return result;
      }
    } catch (err) {
      console.log('Nimbus: Medical dictionary source failed:', source.name, err.message);
      continue; // Try next source
    }
  }
  
  // For hyphenated medical terms, try Wiktionary as fallback
  if (term.includes('-')) {
    console.log('Nimbus: Trying Wiktionary for hyphenated medical term...');
    const wiktionaryResult = await tryWiktionary(term, 'en');
    if (wiktionaryResult) {
      return wiktionaryResult;
    }
    
    // Try without hyphen
    const withoutHyphen = term.replace(/-/g, '');
    const wiktionaryResult2 = await tryWiktionary(withoutHyphen, 'en');
    if (wiktionaryResult2) {
      return wiktionaryResult2;
    }
  }
  
  return null; // No medical dictionary found the term
}

// Fetch entity (person, organization, or place) information from Wikipedia
async function fetchEntityFromWikipedia(name) {
  // First try as place (cities, countries, locations) - most specific
  const placeData = await fetchPlaceFromWikipedia(name);
  if (placeData && placeData.isPlace) {
    return placeData;
  }
  
  // Then try as person
  const personData = await fetchPersonFromWikipedia(name);
  if (personData && personData.isPerson) {
    return personData;
  }
  
  // Finally try as organization
  const orgData = await fetchOrganizationFromWikipedia(name);
  if (orgData && orgData.isOrganization) {
    return orgData;
  }
  
  return null;
}

// Fetch person information from Wikipedia
async function fetchPersonFromWikipedia(name) {
  try {
    // Clean the name for Wikipedia search
    const searchName = name.trim().replace(/\s+/g, '_');
    
    // Try Wikipedia API search first to find the exact page
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchName)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(searchUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        // Try with first letter capitalized if it wasn't already
        if (searchName[0] !== searchName[0].toUpperCase()) {
          const capitalizedName = searchName.charAt(0).toUpperCase() + searchName.slice(1);
          const altUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(capitalizedName)}`;
          const altResponse = await fetch(altUrl, { signal: controller.signal });
          if (altResponse.ok) {
            const altData = await altResponse.json();
            return await parseWikipediaPersonData(altData, name);
          }
        }
        return null;
      }
      
      const data = await response.json();
      return await parseWikipediaPersonData(data, name);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.log('Nimbus: Wikipedia request timed out');
      }
      return null;
    }
  } catch (err) {
    console.error('Nimbus: Error fetching from Wikipedia:', err);
    return null;
  }
}

// Parse Wikipedia API response to extract person information
async function parseWikipediaPersonData(data, originalName) {
  // Check if this is actually a person page
  const content = data.extract || '';
  const title = data.title || '';
  const type = data.type || '';
  
  console.log('Nimbus: Parsing Wikipedia data for:', title, 'type:', type);
  
  // STRICT MEDICAL TERM EXCLUSION - reject if it looks medical/anatomical
  const medicalKeywords = [
    'organ', 'tissue', 'cell', 'molecule', 'protein', 'enzyme', 'hormone', 'vitamin', 'mineral',
    'bile', 'intestine', 'stomach', 'liver', 'kidney', 'bladder', 'gallbladder', 'spleen',
    'anatomical', 'biological structure', 'medical term', 'anatomy', 'physiology',
    'stored', 'concentrated', 'released', 'secreted', 'produces', 'contains'
  ];
  
  const contentLower = content.toLowerCase();
  const hasMedicalKeywords = medicalKeywords.some(keyword => contentLower.includes(keyword));
  const looksMedical = hasMedicalKeywords && (
    contentLower.includes('organ') || 
    contentLower.includes('anatomical') ||
    contentLower.includes('biological structure') ||
    (contentLower.includes('stored') && contentLower.includes('bile')) ||
    (contentLower.includes('tissue') && contentLower.includes('cell'))
  );
  
  if (looksMedical) {
    console.log('Nimbus: Rejecting - looks like medical/anatomical term, not a person');
    return null;
  }
  
  // Exclude abstract concepts, fields of study, etc.
  const abstractConcepts = [
    'philosophy', 'science', 'mathematics', 'history', 'literature', 'art', 'music',
    'religion', 'politics', 'economics', 'sociology', 'psychology', 'biology', 'chemistry',
    'physics', 'astronomy', 'geography', 'medicine', 'law', 'education', 'engineering',
    'theory', 'concept', 'principle', 'method', 'practice', 'discipline', 'field',
    'study of', 'branch of', 'area of', 'systematic study', 'rational inquiry'
  ];
  
  const titleLower = title.toLowerCase();
  const isAbstractConcept = abstractConcepts.some(concept => 
    titleLower === concept || 
    titleLower.includes(concept + ' ') ||
    contentLower.includes('systematic study') ||
    contentLower.includes('field of study') ||
    contentLower.includes('branch of knowledge')
  );
  
  if (isAbstractConcept) {
    console.log('Nimbus: Rejecting - abstract concept/field of study, not a person:', title);
    return null;
  }
  
  // More comprehensive person detection - require STRONG indicators
  const personIndicators = [
    /born\s+\d{1,2}\s+\w+\s+\d{4}/i.test(content), // "born 15 January 1990"
    /born\s+\w+\s+\d{1,2},?\s+\d{4}/i.test(content), // "born January 15, 1990"
    /born\s+\d{4}/i.test(content), // "born 1990"
    /died\s+\d{1,2}\s+\w+\s+\d{4}/i.test(content), // "died 15 January 1990"
    /died\s+\w+\s+\d{1,2},?\s+\d{4}/i.test(content), // "died January 15, 1990"
    /died\s+\d{4}/i.test(content), // "died 1990"
    title.includes('(person)'),
    title.includes('(actor)'),
    title.includes('(actress)'),
    title.includes('(politician)'),
    title.includes('(musician)'),
    title.includes('(singer)'),
    title.includes('(writer)'),
    title.includes('(author)'),
    title.includes('(scientist)'),
    title.includes('(director)'),
    title.includes('(athlete)'),
    title.includes('(footballer)'),
    title.includes('(basketball)'),
    /is\s+(?:a|an)\s+\w+\s+(?:born|died|who|which)/i.test(content), // "is a writer born..."
    /was\s+(?:a|an)\s+\w+\s+(?:born|died|who|which)/i.test(content) // "was a writer born..."
  ];
  
  // Check if any person indicator matches
  const hasPersonIndicator = personIndicators.some(indicator => indicator === true);
  
  // Wikipedia API type can be 'standard', 'disambiguation', or empty
  // For person detection, we mainly rely on content indicators
  // If we have strong person indicators, treat it as a person even if type is not 'standard'
  // Only exclude if it's explicitly a disambiguation page
  const isDisambiguation = type === 'disambiguation';
  const isPerson = hasPersonIndicator && !isDisambiguation && !looksMedical && !isAbstractConcept;
  
  console.log('Nimbus: Person detection - hasPersonIndicator:', hasPersonIndicator, 'type:', type, 'isDisambiguation:', isDisambiguation, 'looksMedical:', looksMedical, 'isPerson:', isPerson);
  
  if (!isPerson) {
    console.log('Nimbus: Not detected as person, returning null. Indicators matched:', personIndicators.filter(i => i === true).length);
    return null;
  }
  
  console.log('Nimbus: Detected as person! Extracting data...');
  
  // Extract image - prioritize face/portrait images
  let imageUrl = await findPersonFaceImage(data, title);
  console.log('Nimbus: Final imageUrl after face detection:', imageUrl);
  
  // If no face image found, use fallback
  if (!imageUrl) {
    console.log('Nimbus: No face image found, using fallback');
    if (data.original && data.original.source) {
      imageUrl = data.original.source;
    } else if (data.thumbnail && data.thumbnail.source) {
      imageUrl = data.thumbnail.source.replace(/\/\d+px-/, '/800px-');
    }
  }
  
  // Extract birth date - multiple patterns
  let birthDate = null;
  const birthPatterns = [
    /born\s+(\d{1,2}\s+\w+\s+\d{4})/i,
    /born\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    /born\s+(\d{4})/i,
    /\(born\s+([^)]+)\)/i,
    /\((\d{4}[^)]*born[^)]*)\)/i
  ];
  
  for (const pattern of birthPatterns) {
    const match = content.match(pattern);
    if (match) {
      birthDate = match[1].trim();
      break;
    }
  }
  
  // Extract occupation/profession - improved pattern
  let occupation = null;
  const occPatterns = [
    /(?:is|was)\s+(?:a|an)\s+([^,\.]+?)(?:,|\.|who|which|born)/i,
    /(?:is|was)\s+([^,\.]+?)\s+(?:born|died|who|which)/i,
    /,\s+([^,\.]+?)(?:,|\.|born|died)/i
  ];
  
  for (const pattern of occPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      const occ = match[1].trim();
      // Filter out common non-occupation words
      if (!occ.match(/^(the|a|an|and|or|but|in|on|at|to|for|of|with|from)$/i) && occ.length > 3) {
        occupation = occ;
        break;
      }
    }
  }
  
  // Extract nationality - expanded list
  const nationalities = [
    'American', 'British', 'Canadian', 'Australian', 'French', 'German', 'Italian', 
    'Spanish', 'Russian', 'Chinese', 'Japanese', 'Indian', 'Brazilian', 'Mexican', 
    'Swedish', 'Norwegian', 'Danish', 'Dutch', 'Polish', 'Irish', 'Scottish', 'Welsh',
    'South African', 'New Zealander', 'Korean', 'Turkish', 'Greek', 'Portuguese',
    'Belgian', 'Swiss', 'Austrian', 'Israeli', 'Egyptian', 'Nigerian', 'Kenyan'
  ];
  
  let nationality = null;
  for (const nat of nationalities) {
    const regex = new RegExp(`\\b${nat}\\b`, 'i');
    if (regex.test(content)) {
      nationality = nat;
      break;
    }
  }
  
  // Calculate age if birth date is available
  let age = null;
  if (birthDate) {
    const yearMatch = birthDate.match(/\d{4}/);
    if (yearMatch) {
      const birthYear = parseInt(yearMatch[0]);
      const currentYear = new Date().getFullYear();
      age = currentYear - birthYear;
    }
  }
  
  // Extract relationships (spouse, children, etc.)
  let relationships = [];
  const relationshipPatterns = [
    /married\s+to\s+([^,\.\n]+)/i,
    /spouse[:\s]+([^,\.\n]+)/i,
    /partner[:\s]+([^,\.\n]+)/i,
    /children[:\s]+([^,\.\n]+)/i
  ];
  
  for (const pattern of relationshipPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      relationships.push(match[1].trim());
    }
  }
  
  // Extract notable works (films, books, albums, etc.)
  let notableWorks = [];
  const worksPatterns = [
    /known\s+for\s+([^,\.\n]+)/i,
    /notable\s+works[:\s]+([^,\.\n]+)/i,
    /films[:\s]+([^,\.\n]+)/i,
    /albums[:\s]+([^,\.\n]+)/i,
    /books[:\s]+([^,\.\n]+)/i
  ];
  
  for (const pattern of worksPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      const works = match[1].split(/[,&]/).map(w => w.trim()).filter(w => w.length > 0);
      notableWorks.push(...works);
    }
  }
  
  // Limit notable works to top 5
  notableWorks = notableWorks.slice(0, 5);
  
  // Get summary - first paragraph, up to 400 characters
  const summary = content.split('\n')[0] || content.substring(0, 400);
  const cleanSummary = summary.replace(/\s+/g, ' ').trim();
  
  return {
    isPerson: true,
    name: title,
    bio: cleanSummary,
    image: imageUrl,
    birthDate: birthDate,
    age: age,
    occupation: occupation,
    nationality: nationality,
    relationships: relationships.length > 0 ? relationships : null,
    notableWorks: notableWorks.length > 0 ? notableWorks : null,
    summary: cleanSummary,
    wikipediaUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`
  };
}

// Find person face image - prioritize portrait/face photos
async function findPersonFaceImage(data, title) {
  console.log('Nimbus: findPersonFaceImage called for:', title);
  console.log('Nimbus: data.original:', data.original?.source);
  console.log('Nimbus: data.thumbnail:', data.thumbnail?.source);
  
  // First check if the original/thumbnail from summary is a portrait
  if (data.original && data.original.source) {
    const imgUrl = data.original.source;
    const isPortrait = isLikelyPortrait(imgUrl);
    console.log('Nimbus: Original image portrait check:', isPortrait, imgUrl);
    if (isPortrait) {
      console.log('Nimbus: Found portrait in original image:', imgUrl);
      return imgUrl;
    }
  }
  
  if (data.thumbnail && data.thumbnail.source) {
    const imgUrl = data.thumbnail.source.replace(/\/\d+px-/, '/800px-');
    const isPortrait = isLikelyPortrait(imgUrl);
    console.log('Nimbus: Thumbnail image portrait check:', isPortrait, imgUrl);
    if (isPortrait) {
      console.log('Nimbus: Found portrait in thumbnail (upgraded):', imgUrl);
      return imgUrl;
    }
  }
  
  // If summary images aren't portraits, try fetching from full page media API
  console.log('Nimbus: No portrait in summary, trying full page media API...');
  const faceImage = await fetchPersonFaceFromMediaAPI(title);
  if (faceImage) {
    console.log('Nimbus: Found face image from media API:', faceImage);
    return faceImage;
  }
  
  // Fallback to original if available (even if not a portrait)
  if (data.original && data.original.source) {
    console.log('Nimbus: Using original image as fallback:', data.original.source);
    return data.original.source;
  }
  
  if (data.thumbnail && data.thumbnail.source) {
    const imgUrl = data.thumbnail.source.replace(/\/\d+px-/, '/800px-');
    console.log('Nimbus: Using thumbnail as fallback:', imgUrl);
    return imgUrl;
  }
  
  console.log('Nimbus: No image found at all');
  return null;
}

// Check if image URL suggests it's a portrait/face photo
function isLikelyPortrait(url) {
  if (!url) return false;
  
  const urlLower = url.toLowerCase();
  // Common portrait indicators in filenames
  const portraitKeywords = [
    'portrait', 'headshot', 'photo', 'photograph', 'official', 
    'head', 'face', 'person', 'actor', 'actress', 'politician',
    'speaker', 'mayor', 'president', 'ceo', 'founder', 'director',
    'wrestler', 'athlete', 'singer', 'musician', 'writer', 'author'
  ];
  
  // Check if URL contains portrait keywords
  const hasPortraitKeyword = portraitKeywords.some(keyword => urlLower.includes(keyword));
  
  // For person pages, if we have an image, it's likely a portrait
  // Wikipedia typically uses portrait images for person pages
  // So we'll be more lenient - if it's a reasonable size, accept it
  const dimensionMatch = url.match(/(\d+)px/);
  if (dimensionMatch) {
    const size = parseInt(dimensionMatch[1]);
    // Accept images that are reasonable size (likely portraits)
    if (size >= 200 && size <= 2000) {
      // If it has portrait keywords, definitely accept
      if (hasPortraitKeyword) {
        return true;
      }
      // Otherwise, accept if it's a good size (Wikipedia person pages usually have portraits)
      return true;
    }
  }
  
  // If no dimension info but has keywords, accept it
  return hasPortraitKeyword;
}

// Fetch person face image from Wikipedia media API
async function fetchPersonFaceFromMediaAPI(title) {
  try {
    const pageTitle = title.replace(/\s+/g, '_');
    const mediaUrl = `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(pageTitle)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(mediaUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return null;
      }
      
      const mediaData = await response.json();
      
      // Look for portrait/face images in the media list
      if (mediaData.items && mediaData.items.length > 0) {
        const portraitImages = [];
        const otherImages = [];
        
        for (const item of mediaData.items) {
          if (item.type === 'image' && item.title) {
            const imageTitle = item.title.replace(/^File:/, '');
            const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageTitle)}?width=800`;
            
            // Check if it's likely a portrait
            if (isLikelyPortrait(imageTitle) || isLikelyPortrait(imageUrl)) {
              portraitImages.push(imageUrl);
            } else {
              otherImages.push(imageUrl);
            }
          }
        }
        
        // Prioritize portrait images
        if (portraitImages.length > 0) {
          console.log('Nimbus: Found', portraitImages.length, 'portrait images, using first');
          return portraitImages[0];
        }
        
        // Fallback to first image if no portraits found
        if (otherImages.length > 0) {
          console.log('Nimbus: No portraits found, using first available image');
          return otherImages[0];
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name !== 'AbortError') {
        console.log('Nimbus: Error fetching media list:', err.message);
      }
    }
  } catch (err) {
    console.error('Nimbus: Error in fetchPersonFaceFromMediaAPI:', err);
  }
  
  return null;
}

// Fetch organization information from Wikipedia
async function fetchOrganizationFromWikipedia(name) {
  try {
    const searchName = name.trim().replace(/\s+/g, '_');
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchName)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(searchUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json();
      return parseWikipediaOrganizationData(data, name);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.log('Nimbus: Wikipedia request timed out');
      }
      return null;
    }
  } catch (err) {
    console.error('Nimbus: Error fetching organization from Wikipedia:', err);
    return null;
  }
}

// Parse Wikipedia API response to extract organization information
function parseWikipediaOrganizationData(data, originalName) {
  const content = data.extract || '';
  const title = data.title || '';
  const type = data.type || '';
  
  console.log('Nimbus: Parsing Wikipedia organization data for:', title, 'type:', type);
  
  // Organization indicators
  const orgIndicators = [
    content.toLowerCase().includes('company'),
    content.toLowerCase().includes('corporation'),
    content.toLowerCase().includes('organization'),
    content.toLowerCase().includes('founded'),
    content.toLowerCase().includes('established'),
    content.toLowerCase().includes('headquarters'),
    content.toLowerCase().includes('head office'),
    content.toLowerCase().includes('industry'),
    content.toLowerCase().includes('revenue'),
    content.toLowerCase().includes('employees'),
    title.includes('(company)'),
    title.includes('(corporation)'),
    title.includes('(organization)'),
    title.includes('Inc'),
    title.includes('LLC'),
    title.includes('Ltd'),
    /founded\s+in\s+\d{4}/i.test(content),
    /established\s+in\s+\d{4}/i.test(content)
  ];
  
  const hasOrgIndicator = orgIndicators.some(indicator => indicator === true);
  const isDisambiguation = type === 'disambiguation';
  const isOrganization = hasOrgIndicator && !isDisambiguation;
  
  console.log('Nimbus: Organization detection - hasOrgIndicator:', hasOrgIndicator, 'type:', type, 'isOrganization:', isOrganization);
  
  if (!isOrganization) {
    return null;
  }
  
  // Extract image
  let imageUrl = null;
  if (data.original && data.original.source) {
    imageUrl = data.original.source;
  } else if (data.thumbnail && data.thumbnail.source) {
    imageUrl = data.thumbnail.source.replace(/\/\d+px-/, '/800px-');
  }
  
  // Extract founded date
  let founded = null;
  const foundedPatterns = [
    /founded\s+in\s+(\d{4})/i,
    /established\s+in\s+(\d{4})/i,
    /founded\s+(\d{4})/i,
    /established\s+(\d{4})/i
  ];
  
  for (const pattern of foundedPatterns) {
    const match = content.match(pattern);
    if (match) {
      founded = match[1];
      break;
    }
  }
  
  // Extract headquarters
  let headquarters = null;
  const hqPatterns = [
    /headquarters[:\s]+([^,\.\n]+)/i,
    /head\s+office[:\s]+([^,\.\n]+)/i,
    /based\s+in\s+([^,\.\n]+)/i
  ];
  
  for (const pattern of hqPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      headquarters = match[1].trim();
      break;
    }
  }
  
  // Extract industry
  let industry = null;
  const industryPatterns = [
    /industry[:\s]+([^,\.\n]+)/i,
    /sector[:\s]+([^,\.\n]+)/i
  ];
  
  for (const pattern of industryPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      industry = match[1].trim();
      break;
    }
  }
  
  // Extract related companies/organizations
  let relatedCompanies = [];
  const relatedPatterns = [
    /subsidiary\s+of\s+([^,\.\n]+)/i,
    /parent\s+company[:\s]+([^,\.\n]+)/i,
    /merged\s+with\s+([^,\.\n]+)/i,
    /acquired\s+([^,\.\n]+)/i
  ];
  
  for (const pattern of relatedPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      relatedCompanies.push(match[1].trim());
    }
  }
  
  // Extract key people (CEO, founder, etc.)
  let keyPeople = [];
  const peoplePatterns = [
    /ceo[:\s]+([^,\.\n]+)/i,
    /founder[:\s]+([^,\.\n]+)/i,
    /president[:\s]+([^,\.\n]+)/i,
    /chairman[:\s]+([^,\.\n]+)/i
  ];
  
  for (const pattern of peoplePatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      keyPeople.push(match[1].trim());
    }
  }
  
  // Extract revenue
  let revenue = null;
  const revenuePatterns = [
    /revenue[:\s]+([\d,\.]+\s*(?:billion|million|USD|\$))/i,
    /annual\s+revenue[:\s]+([\d,\.]+\s*(?:billion|million|USD|\$))/i
  ];
  
  for (const pattern of revenuePatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      revenue = match[1].trim();
      break;
    }
  }
  
  // Extract employee count
  let employees = null;
  const employeePatterns = [
    /employees[:\s]+([\d,]+)/i,
    /workforce[:\s]+([\d,]+)/i,
    /([\d,]+)\s+employees/i
  ];
  
  for (const pattern of employeePatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      employees = match[1].trim();
      break;
    }
  }
  
  // Get summary
  const summary = content.split('\n')[0] || content.substring(0, 400);
  const cleanSummary = summary.replace(/\s+/g, ' ').trim();
  
  return {
    isOrganization: true,
    name: title,
    bio: cleanSummary,
    image: imageUrl,
    founded: founded,
    headquarters: headquarters,
    industry: industry,
    relatedCompanies: relatedCompanies.length > 0 ? relatedCompanies : null,
    keyPeople: keyPeople.length > 0 ? keyPeople : null,
    revenue: revenue,
    employees: employees,
    summary: cleanSummary,
    wikipediaUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`
  };
}

// Fetch place information from Wikipedia
async function fetchPlaceFromWikipedia(name) {
  try {
    const searchName = name.trim().replace(/\s+/g, '_');
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchName)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(searchUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json();
      return parseWikipediaPlaceData(data, name);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.log('Nimbus: Wikipedia request timed out');
      }
      return null;
    }
  } catch (err) {
    console.error('Nimbus: Error fetching place from Wikipedia:', err);
    return null;
  }
}

// Parse Wikipedia API response to extract place information
function parseWikipediaPlaceData(data, originalName) {
  const content = data.extract || '';
  const title = data.title || '';
  const type = data.type || '';
  
  console.log('Nimbus: Parsing Wikipedia place data for:', title, 'type:', type);
  
  // Place indicators - cities, countries, locations
  const placeIndicators = [
    content.toLowerCase().includes('city'),
    content.toLowerCase().includes('town'),
    content.toLowerCase().includes('country'),
    content.toLowerCase().includes('capital'),
    content.toLowerCase().includes('population'),
    content.toLowerCase().includes('located'),
    content.toLowerCase().includes('situated'),
    content.toLowerCase().includes('coordinates'),
    content.toLowerCase().includes('area'),
    content.toLowerCase().includes('km²'),
    content.toLowerCase().includes('square'),
    title.includes('(city)'),
    title.includes('(town)'),
    title.includes('(country)'),
    title.includes('(state)'),
    title.includes('(province)'),
    title.includes('(region)'),
    /population\s+of\s+[\d,]+/i.test(content),
    /located\s+in/i.test(content),
    /situated\s+in/i.test(content)
  ];
  
  // Exclude if it's clearly a person or organization
  const personExclude = content.toLowerCase().includes('born') && content.toLowerCase().includes('died');
  const orgExclude = content.toLowerCase().includes('founded') && content.toLowerCase().includes('company');
  
  const hasPlaceIndicator = placeIndicators.some(indicator => indicator === true);
  const isDisambiguation = type === 'disambiguation';
  const isPlace = hasPlaceIndicator && !isDisambiguation && !personExclude && !orgExclude;
  
  console.log('Nimbus: Place detection - hasPlaceIndicator:', hasPlaceIndicator, 'type:', type, 'isPlace:', isPlace);
  
  if (!isPlace) {
    return null;
  }
  
  // Extract image
  let imageUrl = null;
  if (data.original && data.original.source) {
    imageUrl = data.original.source;
  } else if (data.thumbnail && data.thumbnail.source) {
    imageUrl = data.thumbnail.source.replace(/\/\d+px-/, '/800px-');
  }
  
  // Extract population
  let population = null;
  const popPatterns = [
    /population[:\s]+([\d,]+(?:\s*[\d,]+)*)/i,
    /population\s+of\s+([\d,]+(?:\s*[\d,]+)*)/i,
    /([\d,]+)\s+inhabitants/i,
    /([\d,]+)\s+people/i
  ];
  
  for (const pattern of popPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      population = match[1].trim().replace(/,/g, '');
      break;
    }
  }
  
  // Extract country
  let country = null;
  const countryPatterns = [
    /located\s+in\s+([^,\.\n]+)/i,
    /situated\s+in\s+([^,\.\n]+)/i,
    /country[:\s]+([^,\.\n]+)/i,
    /in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+country/i
  ];
  
  for (const pattern of countryPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      // Filter out common non-country words
      if (!candidate.match(/^(the|a|an|and|or|but|in|on|at|to|for|of|with|from|is|was)$/i) && candidate.length > 2) {
        country = candidate;
        break;
      }
    }
  }
  
  // Extract area
  let area = null;
  const areaPatterns = [
    /area[:\s]+([\d,\.]+\s*(?:km²|km2|square\s+kilometers|sq\s+mi))/i,
    /([\d,\.]+\s*(?:km²|km2|square\s+kilometers|sq\s+mi))\s+in\s+area/i
  ];
  
  for (const pattern of areaPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      area = match[1].trim();
      break;
    }
  }
  
  // Extract coordinates (latitude, longitude)
  let coordinates = null;
  const coordPatterns = [
    /coordinates[:\s]+([\d\.]+[°\s]*[NS]?[,\s]+[\d\.]+[°\s]*[EW]?)/i,
    /([\d\.]+[°\s]*[NS]?[,\s]+[\d\.]+[°\s]*[EW]?)/i
  ];
  
  for (const pattern of coordPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      coordinates = match[1].trim();
      break;
    }
  }
  
  // Extract elevation
  let elevation = null;
  const elevPatterns = [
    /elevation[:\s]+([\d,\.]+\s*(?:m|meters|ft|feet))/i,
    /([\d,\.]+\s*(?:m|meters|ft|feet))\s+above\s+sea\s+level/i
  ];
  
  for (const pattern of elevPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      elevation = match[1].trim();
      break;
    }
  }
  
  // Extract time zone
  let timeZone = null;
  const tzPatterns = [
    /time\s+zone[:\s]+([^,\.\n]+)/i,
    /([A-Z]{3,4})\s+time\s+zone/i
  ];
  
  for (const pattern of tzPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      timeZone = match[1].trim();
      break;
    }
  }
  
  // Get summary
  const summary = content.split('\n')[0] || content.substring(0, 400);
  const cleanSummary = summary.replace(/\s+/g, ' ').trim();
  
  return {
    isPlace: true,
    name: title,
    bio: cleanSummary,
    image: imageUrl,
    population: population,
    country: country,
    area: area,
    coordinates: coordinates,
    elevation: elevation,
    timeZone: timeZone,
    summary: cleanSummary,
    wikipediaUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`
  };
}

// Fetch recent news about a person using Google News RSS feed
async function fetchPersonNews(personName) {
  try {
    // Use Google News RSS feed (free, no API key needed)
    const searchQuery = encodeURIComponent(personName);
    const newsUrl = `https://news.google.com/rss/search?q=${searchQuery}&hl=en&gl=US&ceid=US:en`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(newsUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        return [];
      }
      
      const xmlText = await response.text();
      
      // Parse RSS XML manually (service workers don't have DOMParser)
      const articles = [];
      const maxArticles = 5;
      
      // Extract items using regex (simple but effective for RSS)
      const itemMatches = xmlText.matchAll(/<item>([\s\S]*?)<\/item>/gi);
      let count = 0;
      
      for (const match of itemMatches) {
        if (count >= maxArticles) break;
        
        const itemContent = match[1];
        
        // Extract title
        const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
        const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
        
        // Extract link
        const linkMatch = itemContent.match(/<link>(.*?)<\/link>/i);
        let link = linkMatch ? linkMatch[1].trim() : '';
        
        // Extract description
        const descMatch = itemContent.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/i);
        let description = descMatch ? (descMatch[1] || descMatch[2] || '').trim() : '';
        
        // Extract pubDate
        const dateMatch = itemContent.match(/<pubDate>(.*?)<\/pubDate>/i);
        const pubDate = dateMatch ? dateMatch[1].trim() : '';
        
        // Clean up description (remove HTML tags, links, and URLs)
        description = description.replace(/<[^>]*>/g, ''); // Remove HTML tags
        description = description.replace(/https?:\/\/[^\s]+/g, ''); // Remove URLs
        description = description.replace(/href=["'][^"']*["']/gi, ''); // Remove href attributes
        description = description.replace(/<a\s+[^>]*>/gi, ''); // Remove anchor tags
        description = description.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
        
        // Google News links need to be decoded
        if (link && link.startsWith('https://news.google.com/')) {
          // Extract the actual URL from Google News redirect
          const urlMatch = link.match(/url=([^&]+)/);
          if (urlMatch) {
            link = decodeURIComponent(urlMatch[1]);
          }
        }
        
        if (title && link) {
          articles.push({
            title: title,
            link: link,
            description: description.substring(0, 150), // Limit description length
            date: pubDate
          });
          count++;
        }
      }
      
      console.log(`Nimbus: Found ${articles.length} news articles for ${personName}`);
      return articles;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.log('Nimbus: News request timed out');
      } else {
        console.log('Nimbus: Error fetching news:', err.message);
      }
      return [];
    }
  } catch (err) {
    console.error('Nimbus: Error in fetchPersonNews:', err);
    return [];
  }
}

// NLM Clinical Tables Search Service - Free, no key required
async function fetchNLMClinicalTables(term) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // NLM Clinical Tables API - free, no authentication
    const searchTerm = term.toLowerCase().trim();
    const resp = await fetch(`https://clinicaltables.nlm.nih.gov/api/conditions/v3/search?terms=${encodeURIComponent(searchTerm)}&maxList=1`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (resp.ok) {
      const data = await resp.json();
      // Response format: [3, ["term1", "term2"], [["code1"], ["code2"]], [["name1"], ["name2"]]]
      if (data && Array.isArray(data) && data.length > 1 && data[1].length > 0) {
        const matchedTerm = data[1][0];
        const codes = data[2] && data[2][0] ? data[2][0] : [];
        const names = data[3] && data[3][0] ? data[3][0] : [];
        
        let explanation = `Medical term: ${matchedTerm}`;
        if (names.length > 0) {
          explanation = names[0];
        }
        if (codes.length > 0) {
          explanation += ` (ICD Code: ${codes.join(', ')})`;
        }
        
        return {
          explanation: explanation,
          synonyms: data[1].slice(1, 6) || [], // Other matching terms as synonyms
          pronunciation: null,
          examples: []
        };
      }
    }
  } catch (err) {
    // Silently fail - try next source
  }
  return null;
}

// Pattern-based medical term detection and generic medical API
async function fetchMedicalTermsAPI(term) {
  try {
    // Check if term looks medical (common medical suffixes/prefixes)
    const medicalPatterns = [
      /^(anti|auto|bio|cardio|derm|endo|gastro|hemo|neuro|osteo|patho|psycho|pulmo|thrombo|oesophago|esophago)/i,
      /(itis|osis|emia|oma|pathy|scopy|tomy|ectomy|plasty|algia|cele|cyte|genesis|gram|graph|logy|lysis|megaly|phage|philia|phobia|plasia|plegia|pnea|rrhea|scope|stasis|trophy|uria)$/i,
      /^(hyper|hypo|poly|mono|di|tri)/i,
      /(algia|cele|cyte|genesis|gram|graph|itis|logy|lysis|megaly|oma|osis|pathy|phage|philia|phobia|plasia|plegia|pnea|rrhea|scope|scopy|stasis|tomy|trophy|uria)$/i,
      // Medical anatomical terms
      /(gastric|oesophageal|esophageal|intestinal|hepatic|renal|cardiac|pulmonary|neural|dermal|vascular|muscular|skeletal|nervous|digestive|respiratory|circulatory|endocrine|reproductive|urinary|lymphatic)/i
    ];
    
    const looksMedical = medicalPatterns.some(pattern => pattern.test(term));
    if (looksMedical) {
      // For compound terms, provide more specific explanation
      let explanation = `"${term}" is a medical term`;
      
      if (term.includes('-')) {
        const parts = term.split('-');
        explanation += ` combining ${parts.join(' and ')}`;
      }
      
      // Add context based on patterns
      if (/gastric|oesophageal|esophageal|intestinal/i.test(term)) {
        explanation += '. This typically relates to the digestive system or gastrointestinal tract.';
      } else if (/cardiac|pulmonary|vascular/i.test(term)) {
        explanation += '. This typically relates to the cardiovascular or respiratory system.';
      } else if (/neural|nervous/i.test(term)) {
        explanation += '. This typically relates to the nervous system.';
      } else if (/renal|urinary/i.test(term)) {
        explanation += '. This typically relates to the urinary system or kidneys.';
      } else {
        explanation += '. This may refer to a medical condition, procedure, anatomical structure, or diagnostic term.';
      }
      
      return {
        explanation: explanation,
        synonyms: [],
        pronunciation: null,
        examples: []
      };
    }
  } catch (err) {
    // Silently fail
  }
  
  return null;
}

async function extractSynonyms(term, model) {
  if (VERCEL_API_URL === 'YOUR_VERCEL_URL_HERE/api/chat') return [];
  
  try {
    const synonymPrompt = `Provide 5-8 synonyms for the word "${term}". Return only a comma-separated list of words, no explanations, no numbers, no bullets. Example: word1, word2, word3`;
    
    const resp = await fetch(VERCEL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: synonymPrompt }],
        temperature: 0.3
      })
    });

    if (!resp.ok) return [];
    
    const json = await resp.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return [];
    
    // Parse comma-separated synonyms
    const synonyms = text.split(',').map(s => s.trim()).filter(s => s && s.length > 0 && s.toLowerCase() !== term.toLowerCase());
    return synonyms.slice(0, 8); // Limit to 8 synonyms
  } catch (err) {
    console.error('Synonym extraction error', err);
    return [];
  }
}

async function generateExamples(term, model) {
  if (VERCEL_API_URL === 'YOUR_VERCEL_URL_HERE/api/chat') {
    return [];
  }
  
  try {
    const prompt = `Provide 2-3 real example sentences that actually USE the word "${term}" in natural contexts. Each sentence must contain the word "${term}" and demonstrate its meaning. Return only the sentences, one per line, no numbering, no bullets, no explanations. Do NOT say "The word X is..." or "X is commonly used" - just provide actual example sentences.`;
    
    const resp = await fetch(VERCEL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5
      })
    });

    if (!resp.ok) return [];
    
    const json = await resp.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return [];
    
    // Split and filter out meta-text
    const examples = text.split('\n')
      .map(s => s.trim())
      .filter(s => {
        if (!s || s.length === 0) return false;
        // Remove numbered items
        if (s.match(/^\d+[\.\)]/)) return false;
        // Remove meta-text patterns
        const lower = s.toLowerCase();
        if (lower.includes(`the word "${term}"`) || 
            lower.includes(`"${term}" is`) ||
            lower.includes('commonly used') ||
            lower.includes('is an example') ||
            lower.includes('example of')) {
          return false;
        }
        // Must actually contain the word
        if (!lower.includes(term.toLowerCase())) return false;
        return true;
      })
      .slice(0, 3);
    
    return examples;
  } catch (err) {
    console.error('Example generation error', err);
    return [];
  }
}

async function handleSendContactEmail(data) {
  try {
    // Send email via webhook service (you can replace this with your own endpoint)
    // Using a simple approach - you'll need to set up your own email service
    // For now, we'll use a mailto fallback approach but structure it for future API integration
    
    // Option 1: Use a webhook service like Zapier, Make.com, or your own backend
    // Option 2: Use EmailJS (requires setup)
    // Option 3: Use a service like Formspree
    
    // For now, return success and let the popup handle the mailto fallback
    // In production, replace this with actual API call:
    /*
    const response = await fetch('YOUR_EMAIL_API_ENDPOINT', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'leveldesignagency@gmail.com',
        from: data.email,
        subject: `[Nimbus Extension] ${data.subject}`,
        name: data.name,
        message: data.message
      })
    });
    
    if (!response.ok) throw new Error('Failed to send email');
    */
    
    // For now, return success - the popup will handle mailto as fallback
    // You can replace this with actual email API integration
    return { success: true };
  } catch (error) {
    console.error('Nimbus: Error sending contact email:', error);
    return { success: false, error: error.message };
  }
}

function buildPrompt(term, context, style) {
  const shortContext = (context || '').replace(/\s+/g,' ').slice(0,800);
  const wordCount = term.trim().split(/\s+/).length;
  
  // For statements/phrases (3+ words), provide a more expansive explanation
  if (wordCount >= 3) {
    return `You are a thoughtful, conversational research assistant discussing a statement or idea someone has highlighted. Respond naturally based on what they've selected - adapt your tone and approach to fit the topic.

Statement/Topic: "${term}"
Context from page: "${shortContext}"

Your approach:
- Read the statement and context carefully - understand what they're actually asking about or trying to learn
- Respond in a way that makes sense for this specific topic: be analytical for complex concepts, curious for interesting ideas, helpful for explanations, or thoughtful for philosophical questions
- Start naturally - acknowledge what's interesting about it, dive into the key points, ask a thoughtful question, or share an insight - whatever fits the content best
- Write as if you're genuinely thinking through this with them, not following a script
- Explore the meaning, context, and implications in a conversational way
- Keep it concise - aim for 100-150 words maximum
- Be accurate and factual, but present it naturally
- End with something that invites further exploration or discussion

Important:
- NEVER mention that it's a "misspelling," "not found," or "proper noun" - this is a discussion, not a dictionary lookup
- Focus on what the statement means and why it matters
- Write naturally, as if speaking to someone - avoid phrases like "As an AI" or "I don't have personal feelings"
- Vary your responses - don't use the same opening phrase every time
- Let your response style match the content - serious topics deserve thoughtful responses, interesting ideas deserve curiosity, complex concepts deserve clarity

Respond only with the explanation text (no markdown, no formatting, just plain text).`;
  }
  
  // For single words or 2-word phrases, use a conversational prompt
  return `You are a thoughtful assistant helping someone understand a word or phrase they've highlighted. Respond naturally based on the word and context - adapt your approach to what makes sense.

Term or phrase: "${term}"
Context: "${shortContext}"

Your approach:
- Understand what they're likely trying to learn - is it a technical term? A common word used in a specific way? An unfamiliar concept?
- Respond naturally: dive into the explanation, share an interesting aspect, provide context, or clarify the meaning - whatever fits best
- Explain the practical meaning conversationally, like you're helping a friend understand something
- Provide 1-2 real-world examples or use-cases naturally woven into your explanation
- Keep it under 120 words
- If multiple meanings, pick the most likely based on context
- Write naturally - avoid formal dictionary-style language
- Vary your responses - don't use the same opening every time
- Let the word itself guide your response style

Respond only with the explanation (no markdown, no formatting, just plain text).`;
}

