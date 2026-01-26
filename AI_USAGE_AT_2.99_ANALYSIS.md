# AI Usage at £2.99/Year – API Audit & Break-Even

## 1. All API Calls and Whether They Use OpenAI

### OpenAI (cost driver) – via `https://nimbus-api-ten.vercel.app/api/chat` → `https://api.openai.com/v1/chat/completions`

| User Action | Message Type | OpenAI? | Calls per Action | Notes |
|-------------|--------------|---------|------------------|-------|
| **Explain** (1–2 words, dictionary fails or shouldUseAI) | `explain` | ✅ Yes | **2–3** | 1× main explanation + 1× `extractSynonyms`; +1× `generateExamples` when `detailed: true` |
| **Explain** (3+ words / “statement”) | `explain` | ✅ Yes | **2–3** | Dictionary skipped; same as above. `fetchPersonNews` is **not** OpenAI. |
| **Explain** (dictionary succeeds, `detailed` + no examples) | `explain` | ✅ Yes | **1** | Only `generateExamples` (see `background.js` ~715–726) |
| **Chat** | `chat` | ✅ Yes | **1** | 1 completion per user message |
| **Summarize** | `summarize` | ✅ Yes | **1** | 1 completion, input capped 12,000 chars |

### Free / non-OpenAI (no meaningful per-user $ cost at £2.99)

| API | Used For | Limits (public/free tiers) |
|-----|----------|----------------------------|
| `api.dictionaryapi.dev` | Definitions (1–2 words, tried first) | Free; no explicit limit on site; assume fair use |
| `libretranslate.de` | Translation (primary) | Public instance; limits not clearly documented |
| `api.mymemory.translated.net` | Translation (fallback) | **5,000 chars/day** anonymous; 50,000 with `de` (email). Extension does **not** pass `de`. |
| `en.wikipedia.org/w/api.php` | Entity/wikibase_item | Per-IP; generous for normal use |
| `wikidata.org/w/api.php` | Entity claims | Per-IP; generous |
| `clinicaltables.nlm.nih.gov` | Medical term fallback | NLM; typical public/rate limits |
| `en.wiktionary.org` | German fallback | Per-IP |
| Google News (e.g. `news.google.com`) | Person/place/org/topic news | Scraping/search; no paid API in use |
| `nimbus-api-ten.vercel.app` | verify-license, get-session, create-checkout, create-payment-intent, cancel-subscription, process-refund | Your backend; not AI cost |

---

## 2. In-App Limits

- **Explain / Summarize / general Chat**: **no per-user cap**. The `usage` object in `contentScript.js` has `limit: 999999` and is not used to gate these.
- **Chat – code-like requests** (`isCodeRequest`): **15 per year** (`USAGE_LIMITS.CODE_REQUESTS_PER_YEAR` in `popup.js`).
- **Chat – image requests**: **blocked** (`isImageRequest` → “Image generation is not available”).
- **OpenAI**: Limits are on **your** OpenAI account (RPM/TPM, spend), not enforced per user in the extension.

---

## 3. Cost and Break-Even at £2.99/Year

### Assumptions

- **Price**: £2.99/year ≈ **$3.80** (e.g. ~1.27 FX).
- **Stripe**: ~3% + £0.20 → ~£0.29 (~$0.37). **Net ≈ $3.43**.
- **Overhead** (hosting, etc.): ~$0.50. **Available for AI ≈ $2.93/year**.
- **OpenAI (gpt-4o-mini)**  
  - Input: **$0.15 / 1M tokens**  
  - Output: **$0.60 / 1M tokens**  
- **Typical request size (from `API_ECONOMICS.md` and code):**
  - Explain: ~100 in + ~50 out → **≈ $0.00005** per completion.  
  - **Explain flow:** 2–3 completions (explanation + synonyms ± examples) → **≈ $0.0001–0.00015 per AI explain**.
  - Chat: larger (system + history + ~150 words out) → **≈ $0.0001–0.0002** per message.
  - Summarize: up to 12k chars in + ~50–80 tokens out → **≈ $0.0005** per summarise.

### Break-Even (available $2.93)

Using **$0.0001 per “AI explain”** (2 completions at $0.00005) as the main unit:

- **Break-even AI explains**  
  - $2.93 / 0.0001 ≈ **29,300 AI-explains per user per year**  
  - **≈ 80 per day** if they used that many every day.

If we separate by action (conservative):

- **Explain-only** (2.5 completions × $0.00005):  
  - $2.93 / (2.5 × 0.00005) ≈ **23,440 AI-explains/year** → **≈ 64/day**.
- **Chat-only** (~$0.00015/msg):  
  - $2.93 / 0.00015 ≈ **19,500 messages/year** → **≈ 53/day**.
- **Summarize-only** (~$0.0005 each):  
  - $2.93 / 0.0005 ≈ **5,860/year** → **≈ 16/day**.

---

## 4. How Quickly They Exceed (Time to Break-Even)

“Exceed” = use more than the ~$2.93 you allocate per user per year.

### By usage mix

- **Typical (10 lookups/day, 30% hit AI, few chat/summarise)**  
  - ~3 AI explains/day × 2.5 × $0.00005 ≈ $0.000375/day → **~$0.14/year** → **well under**; they do **not** exceed in a year.

- **Heavy (50 lookups/day, 40% AI, 5 chat, 2 summarise)**  
  - Explains: 20 × 2.5 × 0.00005 = $0.0025  
  - Chat: 5 × 0.00015 = $0.00075  
  - Summarise: 2 × 0.0005 = $0.001  
  - **≈ $0.00425/day → ~$1.55/year** → **under**; do **not** exceed in a year.

- **Very heavy (100 lookups, 50% AI, 20 chat, 5 summarise per day)**  
  - Explains: 50 × 2.5 × 0.00005 = $0.00625  
  - Chat: 20 × 0.00015 = $0.003  
  - Summarise: 5 × 0.0005 = $0.0025  
  - **≈ $0.01175/day → ~$4.29/year**  
  - **$2.93 / 0.01175 ≈ 249 days** → they **exceed in ~8 months**.

- **Worst-case style (mainly chat)**  
  - 60 chat messages/day at $0.00015 → $0.009/day → ~$3.29/year → **≈ 335 days** to exceed.

### Summary: “How quickly?”

- **Typical / heavy**: **Do not exceed** within a year.
- **Very heavy (100 lookups + lots of chat + summarise)**: **~8 months**.
- **Chat-heavy (50–60 msgs/day)**: **~11 months**.
- **Summarise-heavy (e.g. 20/day)**: **~1 month** (20 × 0.0005 = $0.01/day → ~$3.65/year; $2.93 / 0.01 ≈ 293 days; 20/day is an extreme case).

---

## 5. Non-OpenAI Limits That Can Bite First

These can cause **errors or degradation** before OpenAI cost does:

- **MyMemory (translation fallback)**: **5,000 characters/day** per client when used anonymously. Heavy translation users can hit this; LibreTranslate may have already failed or been rate-limited.
- **Dictionary API**: No documented hard limit; fair use. Unlikely to be the first blocker.
- **OpenAI account**: **429 / rate limit** and **quota** are global to your key; a few very heavy users can affect everyone if you’re on a low tier.

---

## 6. Gaps in the Current Code

- **No per-user AI rate limit**: Explain, summarise, and non-code chat are uncapped.
- **No response caching**: Same `(term, context)` or same chat history is not cached; repeat lookups = repeat OpenAI calls.
- **`API_ECONOMICS.md`**: Uses £4.99 and 107,200 queries; needs to be recomputed for £2.99 and the 2–3× explain pattern (see above).

---

## 7. Quick Reference – OpenAI Call Count by Flow

| Flow | Completions (≈) |
|------|------------------|
| Explain 1–2 words, dictionary OK | 0 |
| Explain 1–2 words, AI used, not detailed | 2 (explanation + synonyms) |
| Explain 1–2 words, AI used, detailed | 3 (+ examples) |
| Explain 3+ words, not detailed | 2 |
| Explain 3+ words, detailed | 3 |
| Explain, dictionary OK, detailed, no examples | 1 (examples only) |
| Chat (per user message) | 1 |
| Summarize | 1 |

---

## 8. Bottom Line

- At **£2.99/year**, a user has to be **very heavy** (e.g. 100 lookups with high AI share + lots of chat + regular summarise) to exceed the ~$2.93 AI budget in **about 8 months**.
- **Typical and heavy** users stay **under** for the year.
- **Translation** (MyMemory 5k chars/day) and **OpenAI account** rate/quota limits are more likely to show up as user-visible limits before cost alone.

To get a precise “by when do they exceed?” for your own traffic, you’d need: real $/request for your model mix and payload sizes, and optionally per-user usage logs (explain vs chat vs summarise, and detailed vs not).
