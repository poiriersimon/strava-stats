# Strava OAuth Setup Quick Guide

## Step-by-Step Setup

### Part 1: Create Strava App (One-time)

1. Go to https://www.strava.com/settings/api
2. Click "Create an App"
3. Fill in:
   - Application Name: `Stream Deck`
   - Category: Any
   - Website: `http://localhost`
   - **Authorization Callback Domain: `localhost`** ⚠️ IMPORTANT!
4. Save your **Client ID** and **Client Secret**

### Part 2: Authenticate Plugin

1. Add "Strava OAuth Setup" to Stream Deck
2. Open settings, enter Client ID and Client Secret
3. Click "Generate Auth URL" 
   - Browser opens to Strava
   - Click "Authorize"
4. Copy the `code=` value from redirect URL
   - Example: `http://localhost/?code=COPY_THIS_PART`
5. Paste into "Authorization Code" field
6. Click "Exchange for Token"
7. Should show ✅ Connected

### Part 3: Add Stats

Now add these actions (no individual setup needed):
- Year Tracker
- Month Tracker  
- Last Activity

All actions share the OAuth credentials automatically!

## Common Issues

**"Setup OAuth First"** = Haven't done Part 2 above

**Can't authorize** = Authorization Callback Domain must be `localhost`

**Code expired** = Get new code, they only last ~10 minutes

**Still not working?** = Clear all actions, restart Stream Deck, try again
