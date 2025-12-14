# Test Instructions for Chrome Web Store Review (500 words)

```
Installation and Initial Test:

1. Install the extension from the Chrome Web Store.

2. Open any webpage with text content (e.g., Wikipedia article on "Epistemology" or any news article).

3. Select a single word or two words (up to 2 words maximum) by highlighting text with your mouse.

4. A tooltip will appear showing an upgrade prompt: "Subscribe to Nimbus - Unlock unlimited word definitions for just £1.49/year" with a "Subscribe Now - £1.49/year" button.

5. Click the "Subscribe Now" button. This will launch Chrome's payment flow.

6. Complete the purchase using a Chrome Web Store test account (no real charge). The subscription activates immediately after the test purchase completes.

Testing Core Functionality (After Test Subscription):

7. Select any word again on any webpage. The tooltip should now display:
   - Word definition/explanation at the top
   - Pronunciation (phonetic breakdown) below the word
   - Scrollable synonyms section with clickable tags
   - Example sentences showing word usage
   - Copy button (copies word to clipboard)
   - Favorite button (heart icon) in header
   - Search button (opens Google search for the word)
   - Close button (X) in top right corner

8. Test synonym functionality: Click any synonym tag in the tooltip. The tooltip should update to show the selected synonym's definition, maintaining the same layout.

9. Test favorite functionality: Click the heart icon in the tooltip header. The word should be added to favorites.

10. Test extension hub: Click the Nimbus extension icon in the Chrome toolbar. The hub should display:
    - Word of the Day section at top
    - Search bar with dropdown suggestions
    - Favorites section (showing words you favorited)
    - Recent Searches section (showing words you've looked up)

11. Test hub search: Type a word in the hub search bar and press Enter or click search icon. The word details should display with the same layout as the tooltip.

12. Test edge cases:
    - Select more than 2 words → tooltip should NOT appear
    - Select text inside a search bar or input field → tooltip should NOT appear
    - Click the X button → tooltip should close
    - Select the same word again → tooltip should appear again

13. Test on multiple websites: Wikipedia, news sites, blogs, etc. The extension should work consistently across all sites.

Note: The extension requires an active subscription to function. All word lookups are blocked until a subscription is purchased. Test accounts can simulate purchases without real charges. Once the test purchase completes, the subscription is active immediately and the extension unlocks instantly.
```


