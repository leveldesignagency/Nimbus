/* background.js - MV3 service worker
   Receives messages from content script and calls OpenAI.
   Reads openaiKey and style from chrome.storage.local.
   Also fetches synonyms.
*/

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'explain') {
    console.log('CursorIQ Background: ========== MESSAGE RECEIVED ==========');
    console.log('CursorIQ Background: Received explain request for:', msg.word);
    console.log('CursorIQ Background: Context:', msg.context);
    const isDetailed = msg.detailed || false;
    
    handleExplain(msg.word, msg.context, isDetailed).then(resp => {
      console.log('CursorIQ Background: ========== SENDING RESPONSE ==========');
      console.log('CursorIQ Background: Word:', msg.word);
      console.log('CursorIQ Background: Explanation:', resp.explanation?.substring(0, 50));
      console.log('CursorIQ Background: Response synonyms BEFORE fix:', resp.synonyms);
      console.log('CursorIQ Background: Synonyms type:', typeof resp.synonyms, 'isArray:', Array.isArray(resp.synonyms));
      console.log('CursorIQ Background: Synonyms length:', resp.synonyms?.length || 0);
      
      // FORCE synonyms to be an array - ensure it's never undefined or null
      if (!Array.isArray(resp.synonyms)) {
        console.warn('CursorIQ Background: WARNING - synonyms is not an array! Converting...');
        resp.synonyms = resp.synonyms ? [resp.synonyms] : [];
      }
      
      // Double-check it's an array
      resp.synonyms = Array.isArray(resp.synonyms) ? resp.synonyms : [];
      
      console.log('CursorIQ Background: Response synonyms AFTER fix:', resp.synonyms);
      console.log('CursorIQ Background: Response synonyms length:', resp.synonyms.length);
      console.log('CursorIQ Background: Full response JSON:', JSON.stringify(resp, null, 2));
      console.log('CursorIQ Background: ======================================');
      
      sendResponse(resp);
    }).catch(err => {
      console.error('CursorIQ Background: Error', err);
      sendResponse({ error: err.message || 'unknown error', synonyms: [] });
    });
    return true; // keep channel open for async
  }
  if (msg && msg.action === 'checkIncognito') {
    // Check if the sender tab is in incognito mode
    // sender.tab.incognito is available in Manifest V3
    const isIncognito = sender && sender.tab && sender.tab.incognito === true;
    sendResponse({ isIncognito: isIncognito });
    return true;
  }
  return false;
});

async function handleExplain(term, context, detailed = false) {
  const cfg = await chrome.storage.local.get(['openaiKey','style','model','useFreeAPI']);
  const openaiKey = (cfg.openaiKey || '').trim();
  const style = cfg.style || 'plain';
  const model = cfg.model || 'gpt-4o-mini';
  // Default to using free API if not explicitly set to false
  const useFreeAPI = cfg.useFreeAPI !== false;

  // Always try free API first if no valid OpenAI key OR if useFreeAPI is true
  if (!openaiKey || useFreeAPI) {
    try {
      console.log('CursorIQ Background: Using free dictionary API for:', term);
      const result = await fetchFreeDictionary(term);
      console.log('CursorIQ Background: fetchFreeDictionary returned:', result);
      console.log('CursorIQ Background: result.synonyms:', result.synonyms);
      console.log('CursorIQ Background: result.synonyms type:', typeof result.synonyms, 'isArray:', Array.isArray(result.synonyms));
      
      // FORCE synonyms to be an array - ensure it's never undefined or null
      if (!result.synonyms) {
        console.warn('CursorIQ Background: result.synonyms is falsy, setting to empty array');
        result.synonyms = [];
      } else if (!Array.isArray(result.synonyms)) {
        console.warn('CursorIQ Background: WARNING - result.synonyms is not an array!', result.synonyms);
        result.synonyms = [result.synonyms];
      }
      
      // Double-check
      result.synonyms = Array.isArray(result.synonyms) ? result.synonyms : [];
      
      console.log('CursorIQ Background: After fix - result.synonyms:', result.synonyms);
      console.log('CursorIQ Background: After fix - result.synonyms length:', result.synonyms.length);
      
      // If detailed, enhance with examples ONLY if we don't already have good examples from the API
      if (detailed && result.explanation) {
        // Only generate examples if we don't have any, or if the existing ones are just meta-text
        if (!result.examples || result.examples.length === 0 || 
            result.examples.some(ex => ex.toLowerCase().includes(`the word "${term}"`) || 
                                   ex.toLowerCase().includes('commonly used'))) {
          const generatedExamples = await generateExamples(term, openaiKey, model);
          // Only use generated examples if they're better than what we have
          if (generatedExamples && generatedExamples.length > 0) {
            // Filter out meta-text from generated examples
            const realExamples = generatedExamples.filter(ex => 
              !ex.toLowerCase().includes(`the word "${term}"`) &&
              !ex.toLowerCase().includes('commonly used') &&
              !ex.toLowerCase().includes('is an example') &&
              ex.toLowerCase().includes(term.toLowerCase()) // Must actually contain the word
            );
            if (realExamples.length > 0) {
              result.examples = realExamples;
            } else if (!result.examples || result.examples.length === 0) {
              // Fallback: use generated even if filtered, but prefer API examples
              result.examples = generatedExamples;
            }
          }
        }
      }
      console.log('CursorIQ Background: Returning result with synonyms:', result.synonyms);
      return result;
    } catch (err) {
      console.error('Free dictionary error', err);
      // Only fall back to OpenAI if we have a key
      if (openaiKey && !useFreeAPI) {
        // Fall through to OpenAI below
      } else {
        return { 
          error: 'Free dictionary API failed. Open extension options to set OpenAI API key for better results.',
          synonyms: []
        };
      }
    }
  }

  // Use OpenAI if key is available
  const prompt = buildPrompt(term, context, style);
  try {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 280,
        temperature: 0.2
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('OpenAI error', resp.status, txt);
      // Fallback to free API on OpenAI error
      try {
        return await fetchFreeDictionary(term);
      } catch (e) {
        return { error: 'OpenAI API error. Try free dictionary API in options.', synonyms: [] };
      }
    }
    const json = await resp.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    
    // Extract synonyms from the response or generate them
    const synonyms = await extractSynonyms(term, openaiKey, model);
    console.log('CursorIQ Background: OpenAI synonyms extracted:', synonyms);
    
    const result = { explanation: text || 'No explanation returned.', synonyms: synonyms || [] };
    console.log('CursorIQ Background: OpenAI result with synonyms:', result.synonyms);
    
    // If detailed, add examples
    if (detailed) {
      result.examples = await generateExamples(term, openaiKey, model);
    }
    
    return result;
  } catch (err) {
    console.error('Network error', err);
    // Check if it's a timeout
    if (err.name === 'AbortError') {
      // Fallback to free API on timeout
      try {
        return await fetchFreeDictionary(term);
      } catch (e) {
        return { error: 'Request timed out. Please try again.', synonyms: [] };
      }
    }
    // Fallback to free API on other errors
    try {
      return await fetchFreeDictionary(term);
    } catch (e) {
      return { error: 'Network error. Please check your connection and try again.', synonyms: [] };
    }
  }
}

async function fetchFreeDictionary(term) {
  // Free Dictionary API - no key required
  try {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
    
    const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.toLowerCase())}`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      if (resp.status === 404) {
        return { 
          explanation: `"${term}" not found in dictionary. This might be a proper noun, technical term, or misspelling.`,
          synonyms: []
        };
      }
      throw new Error(`Dictionary API error: ${resp.status}`);
    }
    
    const data = await resp.json();
    console.log('CursorIQ Background: Full API response:', JSON.stringify(data, null, 2));
    if (!data || !Array.isArray(data) || data.length === 0) {
      return { 
        explanation: `No definition found for "${term}".`,
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
      explanation = `"${term}" found in dictionary but no definition available.`;
    }
    
    // Format: "Word: definition"
    explanation = `${term.charAt(0).toUpperCase() + term.slice(1)}: ${explanation}`;
    
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
    
    const result = { 
      explanation, 
      synonyms: finalSynonyms,  // Always an array
      pronunciation: pronunciation
    };
    
    // Add examples if available (up to 5 examples)
    if (uniqueExamples.length > 0) {
      result.examples = uniqueExamples.slice(0, 5);
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
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    throw err;
  }
}

async function extractSynonyms(term, openaiKey, model) {
  try {
    const synonymPrompt = `Provide 5-8 synonyms for the word "${term}". Return only a comma-separated list of words, no explanations, no numbers, no bullets. Example: word1, word2, word3`;
    
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: synonymPrompt }],
        max_tokens: 50,
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

async function generateExamples(term, openaiKey, model) {
  if (!openaiKey) {
    // Don't return meta-text fallback - return empty array instead
    return [];
  }
  
  try {
    const prompt = `Provide 2-3 real example sentences that actually USE the word "${term}" in natural contexts. Each sentence must contain the word "${term}" and demonstrate its meaning. Return only the sentences, one per line, no numbering, no bullets, no explanations. Do NOT say "The word X is..." or "X is commonly used" - just provide actual example sentences.`;
    
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
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

function buildPrompt(term, context, style) {
  const shortContext = (context || '').replace(/\s+/g,' ').slice(0,800);
  return `You are a helpful explainer. Provide a concise, plain-English, real-world explanation of the term/phrase exactly as used on the page.

Term or phrase: "${term}"
Context: "${shortContext}"

Requirements:
- No dictionary-style definition; focus on practical meaning.
- One short explanation sentence + 1-2 real-world examples or use-cases.
- Keep under 120 words.
- If multiple meanings, pick the most likely based on context.
- Tone: ${style}.

Respond only with the explanation.`;
}

