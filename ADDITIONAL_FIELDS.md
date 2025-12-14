# Additional Fields for Chrome Web Store Submission

These fields are **required** before you can submit. Fill them out:

---

## 1. Single Purpose Description
**Required:** Yes

**Answer:**
```
Nimbus provides instant word definitions, synonyms, and examples when you select text on any webpage. It helps users expand their vocabulary while browsing.
```

---

## 2. Privacy Practices

### Does your extension collect user data?
**Answer:** **No**

*Reason: All data (favorites, recent searches) is stored locally in the browser using chrome.storage.local. No personal information is collected or transmitted.*

### Does your extension use third-party services?
**Answer:** **Yes**

*Details:*
- Uses Free Dictionary API (dictionaryapi.dev) for word definitions
- Optionally uses OpenAI API if user provides their own API key
- No user data is sent to these services except the word being looked up

### Does your extension contain user-generated content?
**Answer:** **No**

---

## 3. Support Information

### Support Email:
**Answer:** [Your email address]

*Example: support@yourdomain.com or yourname@gmail.com*

### Support Website (Optional):
**Answer:** Leave blank OR use: `https://leveldesignagency.github.io/Nimbus/`

---

## 4. Content Rating

### Does your extension contain mature content?
**Answer:** **No**

### Does your extension require a minimum age?
**Answer:** **No**

---

## 5. Store Listing Language
**Answer:** **English (United States)**

---

## 6. Category
**Answer:** **Productivity** (or **Education**)

---

## 7. Permissions Justification

If asked why you need certain permissions:

### "Read and change all your data on websites you visit"
**Justification:**
```
Required to detect text selection on web pages and display word explanations in tooltips. The extension only processes selected text and does not modify page content.
```

### "Storage"
**Justification:**
```
Required to store user favorites and recent searches locally. All data remains on the user's device.
```

---

## Quick Checklist:

- [ ] Single purpose description filled
- [ ] Privacy practices answered (No data collection)
- [ ] Support email provided
- [ ] Content rating answered (No mature content)
- [ ] Store listing language selected (English)
- [ ] Category selected (Productivity)
- [ ] All required fields completed

**Once all fields are filled, the "Submit for Review" button should appear!**


