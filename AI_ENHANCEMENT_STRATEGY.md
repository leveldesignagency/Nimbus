# AI Enhancement Strategy for Nimbus

## Current System
- **Primary**: Free Dictionary API (dictionaryapi.dev)
- **Fallback**: OpenAI API (optional, user-provided key)
- **Flow**: Dictionary first → OpenAI if key available and useFreeAPI is false

## How AI Would Improve Results

### 1. **Contextual Understanding**
**Current Dictionary:**
- Static definitions
- No context awareness
- Same definition regardless of where word appears

**With AI:**
- Understands context from surrounding text
- Adapts explanation to how word is used
- Can disambiguate multiple meanings

**Example:**
- Word: "bank"
- Dictionary: "financial institution" (always)
- AI: "financial institution" (in financial context) OR "river edge" (in geography context)

### 2. **Better Handling of Complex Terms**
**Current Dictionary:**
- Struggles with compound words (e.g., "oesophago-gastric")
- Medical/technical terms often missing
- Slang, idioms, phrases not well handled

**With AI:**
- Explains compound terms by breaking them down
- Handles medical/technical terminology
- Understands idioms, slang, colloquialisms
- Can explain phrases and multi-word expressions

**Example:**
- Term: "kick the bucket"
- Dictionary: Not found or literal meaning
- AI: "An idiom meaning 'to die' - informal expression"

### 3. **Adaptive Explanations**
**Current Dictionary:**
- One-size-fits-all definitions
- Technical language for all users

**With AI:**
- Can adjust complexity (simple vs. technical)
- Can provide ELI5 (Explain Like I'm 5) explanations
- Can match user's language level

### 4. **Better Examples**
**Current Dictionary:**
- Generic examples (if any)
- Often meta-text ("The word X is...")

**With AI:**
- Contextual examples based on actual usage
- Natural, real-world sentences
- Multiple examples showing different uses

### 5. **Handling Ambiguity**
**Current Dictionary:**
- Lists all meanings, user must figure out which applies

**With AI:**
- Analyzes context to pick most relevant meaning
- Explains why that meaning fits the context

## Do You Still Need the Dictionary?

### **Recommended: Hybrid Approach**

**Keep Dictionary For:**
1. **Common words** - Fast, free, reliable
2. **Fallback** - When AI fails or times out
3. **Cost efficiency** - Dictionary is free, AI costs money
4. **Speed** - Dictionary is faster for simple lookups
5. **Pronunciation** - Dictionary provides phonetic data

**Use AI For:**
1. **Complex/ambiguous terms** - When dictionary fails or gives poor results
2. **Context-dependent words** - When context matters
3. **Phrases/idioms** - Dictionary doesn't handle these well
4. **Technical/medical terms** - Better explanations
5. **Compound words** - Can break down and explain parts
6. **Slang/colloquialisms** - Modern language understanding

## Proposed Architecture

### **Smart Routing System**

```javascript
async function handleExplain(term, context, detailed = false) {
  // 1. Check if it's an entity (person, place, organization)
  if (isEntity(term)) {
    return fetchEntityData(term); // Wikipedia/Wikidata
  }
  
  // 2. Check if it's a simple common word
  if (isCommonWord(term)) {
    // Try dictionary first (fast, free)
    const dictResult = await fetchFreeDictionary(term);
    if (dictResult && dictResult.explanation) {
      // Enhance with AI if available and context is complex
      if (hasComplexContext(context) && openaiKey) {
        return enhanceWithAI(dictResult, term, context);
      }
      return dictResult;
    }
  }
  
  // 3. Complex term or dictionary failed
  if (openaiKey) {
    // Use AI for better results
    return fetchAIExplanation(term, context);
  }
  
  // 4. Fallback to dictionary
  return fetchFreeDictionary(term);
}
```

### **AI Enhancement Strategy**

**Option A: AI-First (Premium)**
- Use AI for all queries when key available
- Dictionary as fallback only
- Best user experience
- Higher cost

**Option B: Smart Hybrid (Recommended)**
- Dictionary for common words
- AI for complex/ambiguous terms
- Best balance of cost and quality
- Faster for simple lookups

**Option C: AI Enhancement**
- Dictionary provides base definition
- AI enhances with context, examples, synonyms
- Lower cost (fewer AI calls)
- Good quality

## Implementation Plan

### **Phase 1: Enhanced AI Prompting**
Improve current AI prompts to:
- Better use context
- Provide structured responses
- Handle compound words
- Generate better examples

### **Phase 2: Smart Routing**
Implement intelligent routing:
- Detect complex terms
- Route to appropriate source
- Cache common words

### **Phase 3: AI Enhancement Layer**
Add AI enhancement to dictionary results:
- Contextualize definitions
- Add relevant examples
- Improve synonym suggestions

### **Phase 4: Full AI Integration**
Make AI primary for complex queries:
- Better handling of all edge cases
- Superior user experience
- Cost optimization through caching

## Cost Considerations

### **Current Costs**
- Dictionary API: **FREE**
- OpenAI API: **~$0.15 per 1M input tokens, $0.60 per 1M output tokens**
- Average query: ~100 input tokens, ~50 output tokens = **~$0.00005 per query**

### **Cost Optimization Strategies**

1. **Caching**
   - Cache common word explanations
   - Cache AI responses for same word+context
   - Reduce API calls by 60-80%

2. **Smart Routing**
   - Use dictionary for 70% of queries (common words)
   - Use AI for 30% (complex terms)
   - Reduce AI costs by 70%

3. **Batch Processing**
   - Group similar queries
   - Single AI call for multiple words
   - Reduce API overhead

4. **Model Selection**
   - Use `gpt-4o-mini` for most queries (cheaper)
   - Use `gpt-4o` only for complex queries
   - 10x cost difference

## Recommended Approach

### **Hybrid System with AI Enhancement**

1. **Simple Words** → Dictionary API (fast, free)
2. **Complex Terms** → AI (better explanations)
3. **Dictionary Results** → Enhance with AI if context is complex
4. **Failed Dictionary** → AI fallback

### **Benefits:**
- ✅ Best of both worlds
- ✅ Cost-effective (70% free dictionary)
- ✅ Superior quality for complex terms
- ✅ Fast for common words
- ✅ Reliable fallbacks

### **User Experience:**
- Common words: Instant dictionary results
- Complex terms: Rich AI explanations
- Always works: Multiple fallback layers
- Context-aware: Better understanding

## Example Flow

**User highlights: "bank"**

1. Check context: "I went to the bank to deposit money"
2. Route: Dictionary (common word)
3. Get definition: "financial institution"
4. Enhance: AI adds context-specific example
5. Result: "A financial institution where money is stored. In your context: a place to deposit money."

**User highlights: "kick the bucket"**

1. Check: Dictionary lookup fails
2. Route: AI (idiom/phrase)
3. AI explains: "An idiom meaning 'to die' - informal expression"
4. Result: Rich explanation with examples

**User highlights: "oesophago-gastric"**

1. Check: Medical compound term
2. Route: AI (complex term)
3. AI breaks down: "Combining 'oesophagus' (food pipe) and 'gastric' (stomach-related)"
4. Result: Comprehensive medical explanation

## Conclusion

**Yes, keep the dictionary** - It's fast, free, and reliable for common words.

**Add AI strategically** - Use it for complex terms, context-dependent words, and when dictionary fails.

**Best approach**: Hybrid system that intelligently routes queries to the best source, with AI enhancement for better results.

