# VERCEL BACKEND DEPLOYMENT - STEP BY STEP

## ⚠️ CRITICAL: Do this NOW before Google reviews your extension

---

## STEP 1: Create Vercel Account
1. Go to **https://vercel.com**
2. Click **"Sign Up"**
3. Sign up with **GitHub** (recommended) or email
4. Complete account setup

---

## STEP 2: Deploy the API

### Option A: Via Vercel Dashboard (EASIEST - RECOMMENDED)

1. Go to **https://vercel.com/new**
2. Click **"Add New Project"**
3. Click **"Upload"** (or drag & drop)
4. Navigate to: `/Users/charlesmorgan/Documents/CursorIQ/vercel-api`
5. Select the entire `vercel-api` folder
6. Click **"Deploy"**
7. Wait for deployment (30-60 seconds)

### Option B: Via CLI (If you prefer command line)

```bash
cd /Users/charlesmorgan/Documents/CursorIQ/vercel-api
npm install -g vercel
vercel login
vercel --prod
```

---

## STEP 3: Set Your OpenAI API Key

1. In Vercel dashboard, click on your project
2. Go to **"Settings"** (top menu)
3. Click **"Environment Variables"** (left sidebar)
4. Click **"Add New"**
5. Enter:
   - **Name:** `OPENAI_API_KEY`
   - **Value:** Your OpenAI API key (starts with `sk-proj-...`)
   - **Environment:** Select all three:
     - ☑️ Production
     - ☑️ Preview  
     - ☑️ Development
6. Click **"Save"**
7. **IMPORTANT:** Go back to **"Deployments"** tab
8. Click the **"..."** menu on your latest deployment
9. Click **"Redeploy"** (this applies the environment variable)

---

## STEP 4: Get Your API URL

1. After deployment, Vercel shows your URL at the top
2. It looks like: `https://your-project-name.vercel.app`
3. Your API endpoint is: `https://your-project-name.vercel.app/api/chat`
4. **COPY THIS FULL URL** - you'll need it next

---

## STEP 5: Update Extension Code

1. Open: `/Users/charlesmorgan/Documents/CursorIQ/background.js`
2. Find line ~7: `const VERCEL_API_URL = 'YOUR_VERCEL_URL_HERE/api/chat';`
3. Replace `YOUR_VERCEL_URL_HERE/api/chat` with your actual URL
   - Example: `const VERCEL_API_URL = 'https://nimbus-api.vercel.app/api/chat';`
4. **SAVE THE FILE**

---

## STEP 6: Test the API

Open this URL in your browser (replace with your URL):
```
https://your-project-name.vercel.app/api/chat
```

You should see: `{"error":"Method not allowed"}` ✅
(This is correct - it only accepts POST requests)

---

## STEP 7: Repackage Extension

```bash
cd /Users/charlesmorgan/Documents/CursorIQ
rm -f nimbus-extension-submission.zip
zip -r nimbus-extension-submission.zip manifest.json background.js contentScript.js popup.html popup.js options.html options.js tooltip.css assets/ "Nimbus Logo-02.svg" "Nimbus Favicon.png" ai.svg -x "*.DS_Store" "*.git*"
```

---

## STEP 8: Update Chrome Web Store Submission

1. Go to Chrome Web Store Developer Dashboard
2. Find your pending submission
3. Click **"Edit"** or **"Update"**
4. Upload the new `nimbus-extension-submission.zip`
5. Submit the update

---

## ✅ VERIFICATION CHECKLIST

- [ ] Vercel account created
- [ ] API deployed to Vercel
- [ ] OpenAI API key set in Vercel environment variables
- [ ] Deployment redeployed after setting environment variable
- [ ] API URL copied from Vercel dashboard
- [ ] `background.js` updated with your Vercel URL
- [ ] Extension repackaged
- [ ] Ready to update Chrome Web Store submission

---

## 🚨 IMPORTANT NOTES

- **Your API key is now secure** - stored only on Vercel, not in extension code
- **All users will use your API key** - you pay for all OpenAI usage
- **Monitor costs** in OpenAI dashboard
- **Set billing alerts** in OpenAI account settings
- The extension will work for ALL users without them needing API keys

---

## 📞 IF YOU GET STUCK

- Vercel docs: https://vercel.com/docs
- Check deployment logs in Vercel dashboard
- Test API endpoint directly with a tool like Postman or curl

---

**DO THIS NOW - Don't wait for Google's response!**

