# Test Instructions for Chrome Web Store Review

**Credentials:**
- Leave blank (use Chrome Web Store test accounts)

**Test Steps:**

```
1. Install the extension from the Chrome Web Store

2. Attempt to use the extension:
   - Select any word (1-2 words) on any webpage (e.g., Wikipedia article)
   - A tooltip will appear showing upgrade prompt: "Subscribe Now - £1.49/year"

3. Purchase subscription:
   - Click "Subscribe Now - £1.49/year" button in the tooltip
   - Chrome payment flow will launch
   - Complete purchase using Chrome Web Store test account
   - Subscription activates IMMEDIATELY after payment completes

4. Test core functionality (after subscription is active):
   - Select any word again on any webpage
   - Tooltip should now display:
     - Word definition/explanation
     - Pronunciation (phonetic breakdown)
     - Synonyms (clickable tags)
     - Example sentences
     - Copy button (copies word to clipboard)
     - Favorite button (heart icon)
     - Search button (opens Google search)

5. Test extension hub:
   - Click extension icon in Chrome toolbar
   - View Word of the Day section
   - Add words to favorites (click heart icon in tooltips)
   - View favorites section
   - View recent searches section
   - Use search bar to look up words

6. Test on multiple websites:
   - Wikipedia (e.g., search "Epistemology")
   - News articles
   - Any text-heavy webpage

7. Test edge cases:
   - Select more than 2 words (should not show tooltip)
   - Select text inside search bars (should not show tooltip)
   - Click synonyms in tooltip (should update tooltip with new word)

Note: Extension requires active subscription to function. All word lookups are blocked until subscription is purchased. Subscription activates instantly after payment completion.
```


