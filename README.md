# Twitch Bot JS

A simple Twitch EventSub WebSocket bot that:
- listens to chat messages in your channel
- reacts to `HeyGuys`, `!lurk`, and `!github`
- reacts to new subscriptions and follows

It uses two OAuth tokens on **two WebSocket sessions**:
- **Bot token** for chat (`channel.chat.message`)
- **Streamer token** for subscriptions and follows

This is required because EventSub WebSocket subscriptions cannot be created by different users on the same session.

## Setup

### 1) Create a Twitch App
1. Go to the Twitch Developer Console and create an application.
2. Set **OAuth Redirect URLs** to the value you use in `REDIRECT_URI_OF_APP` (example below).
3. Copy the **Client ID** into your `.env`.

### 2) Create `.env`
Create a `.env` file in the project root:

```
CLIENT_ID_OF_APP=YOUR_TWITCH_APP_CLIENT_ID
REDIRECT_URI_OF_APP=http://localhost:3000
EVENTSUB_WEBSOCKET_URL=wss://eventsub.wss.twitch.tv/ws

# Channel (Streamer)
STREAMER_USERNAME=YOUR_STREAMER_USERNAME
STREAMER_USER_ID=YOUR_STREAMER_USER_ID
STREAMER_OAUTH_TOKEN=YOUR_STREAMER_OAUTH_TOKEN

# Bot
BOT_USERNAME=YOUR_BOT_USERNAME
BOT_USER_ID=YOUR_BOT_USER_ID
BOT_OAUTH_TOKEN=YOUR_BOT_OAUTH_TOKEN

# Optional
GITHUB_URL=https://github.com/YOURNAME
```

## How to get each value

### CLIENT_ID_OF_APP
From your Twitch Developer Console app.

### REDIRECT_URI_OF_APP
Must match one of the **OAuth Redirect URLs** configured in your Twitch app.
Example: `http://localhost:3000`

### EVENTSUB_WEBSOCKET_URL
Use the Twitch EventSub WebSocket URL:
```
wss://eventsub.wss.twitch.tv/ws
```

### BOT_USER_ID and STREAMER_USER_ID
If you set `BOT_USERNAME` and `STREAMER_USERNAME`, the bot will fetch the IDs
automatically via the Twitch API and save them to `.env`.

Manual lookup example with a token:

```
curl -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Client-Id: YOUR_CLIENT_ID" \
  "https://api.twitch.tv/helix/users?login=USERNAME"
```

The response contains `data[0].id`.

### BOT_OAUTH_TOKEN (Bot Account)
This project uses a **local callback** to capture the token automatically.

1. Run the bot once: `node Bot.js`
2. It starts a local server on `http://localhost:3000` (or your configured redirect URI).
3. Your browser opens for the **bot account** login.
4. After authorizing, the token is captured automatically.
5. The token is saved to `.env` automatically for future runs.

**Bot scopes used:**
- `user:bot`
- `user:read:chat`
- `user:write:chat`

### STREAMER_OAUTH_TOKEN (Streamer Account)
Get a separate token using the local callback flow, but logged in as the streamer.
The token is saved to `.env` automatically as `STREAMER_OAUTH_TOKEN`.

**Streamer scopes used:**
- `channel:read:subscriptions`
- `moderator:read:followers`

Note: The bot prints warnings if a configured username doesn't match the token's account, or if both usernames are the same.

## Run
```
node Bot.js
```

## What happens
- Connects to EventSub WebSocket **twice**
- Bot session subscribes to `channel.chat.message`
- Streamer session subscribes to `channel.subscribe` and `channel.follow`
- Reacts in chat:
  - `HeyGuys` -> `VoHiYo`
  - `!lurk` -> `Viel Spaß im Lurk, <Name>!`
  - `!github` -> `GitHub: <GITHUB_URL>`
  - New sub -> `Danke für den Sub, <Name>!`
  - New follow -> `Danke fürs Folgen, <Name>!`

## Troubleshooting
- **403 Forbidden** on subscribe/follow: token missing required scope or wrong account.
- **400 websocket transport cannot have subscriptions created by different users**: make sure each user uses their own WebSocket session (already set in this project).
- Token expired: re-run the flow and update `.env`.
