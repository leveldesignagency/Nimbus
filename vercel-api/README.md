# Vercel Backend API Setup

## Step-by-Step Deployment Instructions

### 1. Create Vercel Account
- Go to https://vercel.com
- Sign up/login with GitHub (recommended) or email

### 2. Install Vercel CLI (Optional but Recommended)
```bash
npm install -g vercel
```

### 3. Deploy the API
**Option A: Via Vercel Dashboard (Easiest)**
1. Go to https://vercel.com/new
2. Import the `vercel-api` folder as a Git repository OR upload it directly
3. If uploading: Click "Add New Project" → "Upload" → Select the `vercel-api` folder
4. Click "Deploy"

**Option B: Via CLI**
```bash
cd vercel-api
vercel login
vercel --prod
```

### 4. Set Environment Variable
1. Go to your Vercel project dashboard
2. Click "Settings" → "Environment Variables"
3. Add new variable:
   - **Name:** `OPENAI_API_KEY`
   - **Value:** Your OpenAI API key (starts with `sk-proj-...`)
   - **Environment:** Production, Preview, Development (select all)
4. Click "Save"

### 5. Get Your API URL
1. After deployment, Vercel will give you a URL like: `https://your-project.vercel.app`
2. Your API endpoint will be: `https://your-project.vercel.app/api/chat`
3. **Copy this URL - you'll need it for the extension**

### 6. Update Extension Code
1. Open `background.js`
2. Find the line: `const VERCEL_API_URL = 'YOUR_VERCEL_URL_HERE';`
3. Replace `YOUR_VERCEL_URL_HERE` with your actual Vercel URL (e.g., `https://your-project.vercel.app/api/chat`)
4. Save the file

### 7. Test the API
You can test it directly in your browser:
```
https://your-project.vercel.app/api/chat
```
Should return: `{"error":"Method not allowed"}` (this is correct - it only accepts POST)

### 8. Repackage Extension
After updating `background.js` with your Vercel URL:
```bash
cd /Users/charlesmorgan/Documents/CursorIQ
rm -f nimbus-extension-submission.zip
zip -r nimbus-extension-submission.zip manifest.json background.js contentScript.js popup.html popup.js options.html options.js tooltip.css assets/ "Nimbus Logo-02.svg" "Nimbus Favicon.png" ai.svg -x "*.DS_Store" "*.git*"
```

### 9. Update Extension in Chrome Web Store
- Once Google approves your submission, you can update it with the new version
- Upload the new zip file with the Vercel API integration

## Security Notes
- Your OpenAI API key is stored securely in Vercel's environment variables
- Never commit your API key to Git
- The extension no longer needs API keys - it calls your Vercel backend
- All users will use your API key (you pay for usage)

## Cost Management
- Monitor usage in Vercel dashboard
- Set up billing alerts in OpenAI dashboard
- Consider rate limiting if needed

