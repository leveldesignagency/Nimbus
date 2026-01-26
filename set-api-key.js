// Temporary script to set OpenAI API key
// Run this in the browser console on any page with the extension installed
// Or add to background.js temporarily for development

const API_KEY = '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';

// Set via Chrome storage
chrome.storage.local.set({ openaiKey: API_KEY }, () => {
  console.log('✅ API key set successfully!');
  chrome.storage.local.get(['openaiKey'], (result) => {
    console.log('Verified:', result.openaiKey ? 'Key is stored' : 'Key not found');
  });
});






