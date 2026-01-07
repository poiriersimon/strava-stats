# Strava Stats Stream Deck Plugin

A Stream Deck plugin that displays your Strava statistics with OAuth authentication and automatic token refresh.

## Features

### 🔐 OAuth Authentication
- Secure OAuth 2.0 flow
- Automatic token refresh
- One-time setup, works forever

### 📊 Year Tracker
Display your year-to-date (YTD) Strava statistics:
- **Distance**: Total kilometers this year
- **Time**: Total moving time this year
- **Activity Count**: Number of activities completed
- **Elevation Gain**: Total elevation climbed

Supports runs, rides, and swims!

### 📅 Month Tracker
Display current month statistics:
- Same metrics as Year Tracker
- Filters activities from current month only
- Supports all activity types

### 🏃 Last Activity
Show your most recent Strava activity:
- **Summary Mode**: Distance + Time
- **Distance Only**: Total kilometers
- **Pace**: Average pace in min/km
- **Time Only**: Moving time
- **Activity Name**: The name you gave your activity
- **Elevation Gain**: Meters climbed
- **Full Details**: Distance, time, and pace together

Filter by activity type (All, Run, Ride, or Swim)!

## Setup Instructions

### 1. Create a Strava API Application

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Click **Create an App** (or use an existing one)
3. Fill in the application details:
   - **Application Name**: Stream Deck Integration (or any name)
   - **Category**: Choose any category
   - **Website**: Any URL (e.g., http://localhost)
   - **Authorization Callback Domain**: **localhost** (IMPORTANT!)
4. After creating the app, note down your:
   - **Client ID**
   - **Client Secret**

### 2. Configure OAuth in Stream Deck

1. Add the **Strava OAuth Setup** action to your Stream Deck
2. Click the action to open its settings
3. Enter your **Client ID** and **Client Secret**
4. Click **Generate Auth URL**:
   - The URL will open in your browser
   - The URL will also be copied to your clipboard
5. In your browser, click **Authorize** to grant access
6. After authorizing, you'll be redirected to a URL like:
   ```
   http://localhost/?state=&code=AUTHORIZATION_CODE&scope=read,activity:read_all
   ```
7. Copy the `AUTHORIZATION_CODE` from the URL
8. Paste it into the **Authorization Code** field in the Stream Deck settings
9. Click **Exchange for Token**
10. If successful, the button will show "✅ Connected"

### 3. Add Stats Actions

Once authenticated, you can add:

- **Year Tracker**: Shows YTD statistics
  - Activity Type: Run, Ride, or Swim
  - Display Mode: Distance, Time, Count, or Elevation
  
- **Month Tracker**: Shows current month statistics
  - Activity Type: All, Run, Ride, or Swim
  - Display Mode: Distance, Time, Count, or Elevation
  
- **Last Activity**: Shows most recent activity
  - Filter: All, Run, Ride, or Swim
  - Display Mode: Summary, Distance, Pace, Time, Name, Elevation, or Full

## How It Works

- **Automatic Token Refresh**: Access tokens expire after 6 hours. The plugin automatically refreshes them using your refresh token.
- **Global Authentication**: You only need to authenticate once. All actions use the same credentials.
- **Updates**: Stats update every 30 minutes automatically or press the button to get a instant update.
- **Sleep Awareness**: The plugin can detect when your device wakes from sleep and refresh all stats automatically (future feature).

## Rate Limits

The Strava API has the following rate limits:
- **200 requests per 15 minutes**
- **1,000 requests per day**

To stay within these limits, the plugin:
- Automatically refreshes stats every **30 minutes** (48 requests/day per action)
- Uses manual button presses for immediate updates
- Displays "Rate\nLimit\nWait 30m" when limits are exceeded
- Waits for the next refresh cycle to resume

**Tip**: If you have multiple trackers, they each count toward the daily limit. With 4 trackers (Year/Month/Week/Last), you'll use ~192 requests per day, leaving plenty of room for manual refreshes.

## Troubleshooting

### "Setup OAuth First" Error
- Make sure you've completed the OAuth setup using the **Strava OAuth Setup** action
- Check that the OAuth button shows "✅ Connected"

### "Token Expired" Warning
- Tokens are automatically refreshed when you use the actions
- If auto-refresh fails, try re-authorizing through the OAuth Setup action

### Authorization Code Not Working
- Make sure you copied the entire code from the URL
- The code is only valid for a short time - use it immediately
- Make sure your app's **Authorization Callback Domain** is set to `localhost`

### Stats Not Updating
- Check your internet connection
- Verify the OAuth Setup button shows "✅ Connected"
- Try refreshing by pressing the action button

### "Rate Limit" Message
- You've exceeded Strava's API rate limits (200 per 15min or 1,000 per day)
- The key will display "Rate\nLimit\nWait 30m"
- The plugin will automatically resume at the next 30-minute refresh cycle
- **To avoid this**:
  - Limit the number of tracker actions you use
  - Avoid pressing buttons repeatedly for manual refreshes
  - The plugin is configured to stay under limits with normal use

### Error Messages Persist After Token Refresh
- Press the OAuth Setup button to refresh the token
- Press each tracker button to force an immediate update
- If errors continue, re-authorize through the OAuth Setup action
