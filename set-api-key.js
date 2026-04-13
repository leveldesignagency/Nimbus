// Temporary script to set OpenAI API key
// Run this in the browser console on any page with the extension installed
// Or add to background.js temporarily for development

// Paste your key here for local dev only. Never commit real keys.
const API_KEY = 'YOUR_OPENAI_API_KEY_HERE';

// Set via Chrome storage
chrome.storage.local.set({ openaiKey: API_KEY }, () => {
  console.log('✅ API key set successfully!');
  chrome.storage.local.get(['openaiKey'], (result) => {
    console.log('Verified:', result.openaiKey ? 'Key is stored' : 'Key not found');
  });
});






