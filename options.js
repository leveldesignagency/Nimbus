/* options.js - Nimbus Settings */

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const styleSelect = document.getElementById('style');
  const saveBtn = document.getElementById('save');
  const status = document.getElementById('status');

  const useFreeAPICheckbox = document.getElementById('useFreeAPI');
  
  chrome.storage.local.get(['openaiKey','style','useFreeAPI'], (res) => {
    apiKeyInput.value = res.openaiKey || '';
    styleSelect.value = res.style || 'plain';
    useFreeAPICheckbox.checked = res.useFreeAPI !== false; // Default to true
  });

  saveBtn.addEventListener('click', () => {
    const openaiKey = apiKeyInput.value.trim();
    const style = styleSelect.value;
    const useFreeAPI = useFreeAPICheckbox.checked;
    chrome.storage.local.set({ openaiKey, style, useFreeAPI }, () => {
      status.innerText = '✅ Settings saved!';
      status.style.color = '#10b981';
      setTimeout(() => {
        status.innerText = '';
      }, 3000);
    });
  });
});

