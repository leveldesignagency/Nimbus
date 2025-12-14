# Expansion Plan: From Words to General Knowledge

## Current State
- Handles: Single words or 2-word phrases
- APIs: Free Dictionary API, OpenAI (optional)
- Output: Definitions, synonyms, pronunciation, examples

## Target State
- Handles: Words, acronyms, people, places, topics, phrases, sentences
- Output: Contextual explanations/synopses based on content type

---

## What Needs to Change

### 1. **Content Detection System**

Add logic to detect what type of content is selected:

```javascript
function detectContentType(text) {
  // Acronym detection (all caps, 2-10 chars)
  if (/^[A-Z]{2,10}$/.test(text)) {
    return 'acronym';
  }
  
  // Person name detection (capitalized words, common patterns)
  if (/^[A-Z][a-z]+ [A-Z][a-z]+/.test(text)) {
    return 'person';
  }
  
  // Place/topic detection (multiple capitalized words)
  if (/^[A-Z][a-z]+( [A-Z][a-z]+)+/.test(text)) {
    return 'topic';
  }
  
  // Phrase/sentence (longer text)
  if (text.split(/\s+/).length > 2) {
    return 'phrase';
  }
  
  // Default: word
  return 'word';
}
```

### 2. **API Integration**

Add new APIs for different content types:

**For Acronyms:**
- Wikipedia API (search for acronym)
- Acronyms.com API (if available)
- OpenAI with prompt: "Explain what [ACRONYM] stands for and what it means"

**For People:**
- Wikipedia API (biography)
- Wikidata API (structured data)
- OpenAI with prompt: "Provide a brief biography of [PERSON]"

**For Topics/Places:**
- Wikipedia API (general article)
- OpenAI with prompt: "Explain [TOPIC] in simple terms"

**For Phrases/Sentences:**
- OpenAI with prompt: "Summarize this: [TEXT]"
- Or: "Explain this concept: [TEXT]"

### 3. **Background.js Changes**

Modify `handleExplain()` to:
1. Detect content type
2. Route to appropriate API
3. Format response based on type

```javascript
async function handleExplain(term, context, detailed = false) {
  const contentType = detectContentType(term);
  
  switch(contentType) {
    case 'acronym':
      return await handleAcronym(term);
    case 'person':
      return await handlePerson(term);
    case 'topic':
      return await handleTopic(term);
    case 'phrase':
      return await handlePhrase(term);
    default:
      return await handleWord(term, context, detailed);
  }
}
```

### 4. **Word Limit Removal**

Currently limited to 2 words. Need to:
- Remove word count restriction in `contentScript.js`
- Update `handleSelection()` to allow longer selections
- Add max length limit (e.g., 500 characters) to prevent abuse

### 5. **UI Adaptations**

Modal needs to adapt based on content type:

**For Words (current):**
- Definition, synonyms, pronunciation, examples

**For Acronyms:**
- Full form, meaning, context, usage

**For People:**
- Brief bio, notable achievements, current relevance
- Image (from Wikipedia)
- Birth/death dates

**For Topics:**
- Overview, key points, related topics
- Image (if available)

**For Phrases:**
- Summary, key concepts, explanation

### 6. **New APIs to Integrate**

**Wikipedia API:**
```javascript
async function fetchWikipedia(query) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  const response = await fetch(url);
  return await response.json();
}
```

**Wikidata API (for structured data):**
```javascript
async function fetchWikidata(query) {
  // Search for entity, then fetch structured data
}
```

### 7. **Manifest Updates**

Add new host permissions:
```json
"host_permissions": [
  "https://api.openai.com/*",
  "https://api.dictionaryapi.dev/*",
  "https://*.wikipedia.org/*",
  "https://www.wikidata.org/*"
]
```

---

## Implementation Priority

### Phase 1: Remove Word Limit + Add Phrase Support
- Remove 2-word restriction
- Allow up to 50 words / 500 characters
- Use OpenAI to summarize/explain phrases
- **Effort:** Low (2-3 hours)

### Phase 2: Add Acronym Detection
- Detect acronyms (all caps, 2-10 chars)
- Use Wikipedia API for acronym lookup
- Fallback to OpenAI if not found
- **Effort:** Medium (4-6 hours)

### Phase 3: Add Person/Topic Detection
- Detect person names and topics
- Integrate Wikipedia API
- Add image support in modal
- **Effort:** High (8-12 hours)

### Phase 4: Smart Context Detection
- Use AI to determine content type
- Better detection of people vs places vs topics
- **Effort:** High (10-15 hours)

---

## Cost Considerations

**Current:**
- Free Dictionary API: Free
- OpenAI (optional): User's API key

**With Expansion:**
- Wikipedia API: Free
- Wikidata API: Free
- OpenAI: More API calls needed (if using for all types)
- **Recommendation:** Use free APIs (Wikipedia) as primary, OpenAI as fallback

---

## Example Flow

1. User highlights: "Elon Musk"
2. Extension detects: `person`
3. Calls: Wikipedia API → Gets biography
4. Displays: Modal with bio, image, notable achievements
5. User can: Click "Learn more" → Opens Wikipedia page

---

## Technical Challenges

1. **Detection Accuracy:** Hard to perfectly detect person vs place vs topic
   - Solution: Use Wikipedia search, let it determine best match

2. **API Rate Limits:** Wikipedia has rate limits
   - Solution: Cache results, add rate limiting

3. **Response Formatting:** Different content types need different layouts
   - Solution: Create flexible modal component with type-specific sections

4. **Performance:** More API calls = slower responses
   - Solution: Implement caching, parallel requests where possible

---

## Next Steps

If you want to implement this:

1. **Start with Phase 1** (remove word limit, add phrase support)
2. **Test thoroughly** with different content types
3. **Add Wikipedia API** for acronyms and people
4. **Iterate** based on user feedback

Would you like me to start implementing Phase 1?


