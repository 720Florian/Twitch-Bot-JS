import WebSocket from "ws";
import dotenv from "dotenv";
import http from "http";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const BOT_USER_ID = process.env.BOT_USER_ID; // This is the User ID of the chat bot
const CLIENT_ID = process.env.CLIENT_ID_OF_APP;
const Redirect_URI = process.env.REDIRECT_URI_OF_APP;
const CHAT_CHANNEL_USER_ID = process.env.STREAMER_USER_ID; // This is the User ID of the channel that the bot will join and listen to chat messages of
const EVENTSUB_WEBSOCKET_URL = process.env.EVENTSUB_WEBSOCKET_URL;
let OAUTH_TOKEN = process.env.BOT_OAUTH_TOKEN;
let STREAMER_OAUTH_TOKEN = process.env.STREAMER_OAUTH_TOKEN;
const GITHUB_URL = process.env.GITHUB_URL;
let botWebsocketSessionID;
let streamerWebsocketSessionID;

// Start executing the bot from here
(async () => {
    if (!OAUTH_TOKEN) {
        OAUTH_TOKEN = await getOAuthToken();
    }

    if (!STREAMER_OAUTH_TOKEN) {
        STREAMER_OAUTH_TOKEN = await getStreamerOAuthToken();
    }

    // Verify that the authentication is valid
    await getAuth(OAUTH_TOKEN, "BOT_OAUTH_TOKEN");
    await getAuth(STREAMER_OAUTH_TOKEN, "STREAMER_OAUTH_TOKEN");

    // Start WebSocket client and register handlers
    const botWebsocketClient = startWebSocketClient(handleBotWebSocketMessage);
    const streamerWebsocketClient = startWebSocketClient(
        handleStreamerWebSocketMessage,
    );
})();

// WebSocket will persist the application loop until you exit the program forcefully

async function getAuth(token, label) {
    // Validate OAuth token
    // https://dev.twitch.tv/docs/authentication/validate-tokens/#how-to-validate-a-token
    let response = await fetch("https://id.twitch.tv/oauth2/validate", {
        method: "GET",
        headers: {
            Authorization: "OAuth " + token,
        },
    });

    if (response.status != 200) {
        let data = await response.json();
        console.error(
            `${label} is not valid. /oauth2/validate returned status code ${response.status}`,
        );
        console.error(data);
        process.exit(1);
    }

    console.log(`Validated ${label}.`);
}

async function getOAuthToken() {
    // Implicit grant flow - Get OAuth token
    // https://dev.twitch.tv/docs/authentication/getting-tokens-oauth#implicit-grant-flow

    let Scopes = [
        "user:bot",
        "user:read:chat",
        "user:write:chat",
    ];

    return await authorizeWithLocalCallback("bot", Scopes);
}

async function getStreamerOAuthToken() {
    let Scopes = ["channel:read:subscriptions", "moderator:read:followers"];

    return await authorizeWithLocalCallback("streamer", Scopes);
}

async function authorizeWithLocalCallback(label, scopes) {
    const redirectUrl = new URL(Redirect_URI);
    if (redirectUrl.hostname !== "localhost") {
        console.error(
            `REDIRECT_URI_OF_APP must be localhost for local callback auth. Current: ${Redirect_URI}`,
        );
        process.exit(1);
    }

    console.log(
        `Authorize the ${label} account in the browser window that opens next.`,
    );
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${Redirect_URI}&response_type=token&force_verify=true&scope=${scopes.join("%20")}`;
    const token = await startLocalAuthServer(redirectUrl, label, authUrl);
    const envKey = `${label.toUpperCase()}_OAUTH_TOKEN`;
    await saveTokenToEnv(envKey, token);
    console.log(
        `Captured ${label} token. Saved to .env as ${envKey}.`,
    );
    return token;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertEnvValue(content, key, value) {
    const line = `${key}=${value}`;
    const keyPattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
    if (keyPattern.test(content)) {
        return content.replace(keyPattern, line);
    }
    const trimmed = content.replace(/\s*$/, "");
    const separator = trimmed.length ? "\n" : "";
    return `${trimmed}${separator}${line}\n`;
}

async function saveTokenToEnv(key, token) {
    const envPath = path.join(process.cwd(), ".env");
    let content = "";
    try {
        content = await fs.readFile(envPath, "utf8");
    } catch (err) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    const updated = upsertEnvValue(content, key, token);
    if (updated !== content) {
        await fs.writeFile(envPath, updated, "utf8");
    }
}

function openBrowser(url) {
    const quoted = `"${url}"`;
    const command =
        process.platform === "darwin"
            ? `open ${quoted}`
            : process.platform === "win32"
              ? `start ${quoted}`
              : `xdg-open ${quoted}`;

    exec(command, (error) => {
        if (error) {
            console.log("Open this URL in your browser to authorize:");
            console.log(url);
        }
    });
}

function startLocalAuthServer(redirectUrl, label, authUrl) {
    return new Promise((resolve, reject) => {
        const port = redirectUrl.port || "3000";
        const path = redirectUrl.pathname || "/";

        const server = http.createServer((req, res) => {
            if (req.method === "GET" && req.url?.startsWith(path)) {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Twitch Auth</title></head>
<body>
<h1>Authorizing ${label} account...</h1>
<p>Please make sure you are logged in as the ${label} account.</p>
<p>You can close this tab after success.</p>
<script>
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  if (token) {
    fetch("/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    }).then(() => {
      document.body.innerHTML = "<h1>Token received. You can close this tab.</h1>";
    });
  } else {
    document.body.innerHTML = "<h1>No token found.</h1>";
  }
</script>
</body>
</html>`);
                return;
            }

            if (req.method === "POST" && req.url === "/token") {
                let body = "";
                req.on("data", (chunk) => {
                    body += chunk.toString();
                });
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        if (!data.token) {
                            throw new Error("Missing token");
                        }
                        res.writeHead(200);
                        res.end("OK");
                        server.close();
                        resolve(data.token);
                    } catch (err) {
                        res.writeHead(400);
                        res.end("Invalid token payload");
                        reject(err);
                    }
                });
                return;
            }

            res.writeHead(404);
            res.end("Not found");
        });

        server.listen(Number(port), "localhost", () => {
            console.log(
                `Local auth server listening on http://localhost:${port}${path}`,
            );
            openBrowser(authUrl);
        });
    });
}

function startWebSocketClient(onMessage) {
    let websocketClient = new WebSocket(EVENTSUB_WEBSOCKET_URL);

    websocketClient.on("error", console.error);

    websocketClient.on("open", () => {
        console.log("WebSocket connection opened to " + EVENTSUB_WEBSOCKET_URL);
    });

    websocketClient.on("message", (data) => {
        onMessage(JSON.parse(data.toString()));
    });

    return websocketClient;
}

function handleBotWebSocketMessage(data) {
    switch (data.metadata.message_type) {
        case "session_welcome": // First message you get from the WebSocket server when connecting
            botWebsocketSessionID = data.payload.session.id; // Register the Session ID it gives us

            // Listen to EventSub, which joins the chatroom from your bot's account
            registerChatMessageListener();
            break;
        case "notification": // An EventSub notification has occurred, such as channel.chat.message
            switch (data.metadata.subscription_type) {
                case "channel.chat.message":
                    // First, print the message to the program's console.
                    console.log(
                        `MSG #${data.payload.event.broadcaster_user_login} <${data.payload.event.chatter_user_login}> ${data.payload.event.message.text}`,
                    );

                    // Then check to see if that message was "HeyGuys"
                    const messageText =
                        data.payload.event.message.text.trim();
                    const messageLower = messageText.toLowerCase();

                    if (messageText == "HeyGuys") {
                        // If so, send back "VoHiYo" to the chatroom
                        sendChatMessage("VoHiYo");
                    }

                    if (messageLower == "!lurk") {
                        sendChatMessage(
                            `Viel Spaß im Lurk, ${data.payload.event.chatter_user_name}!`,
                        );
                    }

                    if (messageLower == "!github") {
                        if (!GITHUB_URL) {
                            sendChatMessage(
                                "GitHub-Link fehlt. Bitte GITHUB_URL in der .env setzen.",
                            );
                        } else {
                            sendChatMessage(`GitHub: ${GITHUB_URL}`);
                        }
                    }

                    break;
            }
            break;
    }
}

function handleStreamerWebSocketMessage(data) {
    switch (data.metadata.message_type) {
        case "session_welcome":
            streamerWebsocketSessionID = data.payload.session.id;
            registerSubscriptionListener();
            registerFollowListener();
            break;
        case "notification":
            switch (data.metadata.subscription_type) {
                case "channel.subscribe":
                    console.log(
                        `SUB #${data.payload.event.broadcaster_user_login} <${data.payload.event.user_login}>`,
                    );
                    sendChatMessage(
                        `Danke für den Sub, ${data.payload.event.user_name}!`,
                    );
                    break;
                case "channel.follow":
                    console.log(
                        `FOLLOW #${data.payload.event.broadcaster_user_login} <${data.payload.event.user_login}>`,
                    );
                    sendChatMessage(
                        `Danke fürs Folgen, ${data.payload.event.user_name}!`,
                    );
                    break;
            }
            break;
    }
}

async function sendChatMessage(chatMessage) {
    let response = await fetch("https://api.twitch.tv/helix/chat/messages", {
        method: "POST",
        headers: {
            Authorization: "Bearer " + OAUTH_TOKEN,
            "Client-Id": CLIENT_ID,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            broadcaster_id: CHAT_CHANNEL_USER_ID,
            sender_id: BOT_USER_ID,
            message: chatMessage,
        }),
    });

    if (response.status != 200) {
        let data = await response.json();
        console.error("Failed to send chat message");
        console.error(data);
    } else {
        console.log("Sent chat message: " + chatMessage);
    }
}

async function registerChatMessageListener() {
    // Register channel.chat.message
    let response_chat_message = await fetch(
        "https://api.twitch.tv/helix/eventsub/subscriptions",
        {
            method: "POST",
            headers: {
                Authorization: "Bearer " + OAUTH_TOKEN,
                "Client-Id": CLIENT_ID,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "channel.chat.message",
                version: "1",
                condition: {
                    broadcaster_user_id: CHAT_CHANNEL_USER_ID,
                    user_id: BOT_USER_ID,
                },
                transport: {
                    method: "websocket",
                    session_id: botWebsocketSessionID,
                },
            }),
        },
    );

    if (response_chat_message.status != 202) {
        let data = await response_chat_message.json();
        console.error(
            "Failed to subscribe to channel.chat.message. API call returned status code " +
                response_chat_message.status,
        );
        console.error(data);
        process.exit(1);
    } else {
        const data = await response_chat_message.json();
        console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
    }
}

async function registerSubscriptionListener() {
    let response_subscription = await fetch(
        "https://api.twitch.tv/helix/eventsub/subscriptions",
        {
            method: "POST",
            headers: {
                Authorization: "Bearer " + STREAMER_OAUTH_TOKEN,
                "Client-Id": CLIENT_ID,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "channel.subscribe",
                version: "1",
                condition: {
                    broadcaster_user_id: CHAT_CHANNEL_USER_ID,
                },
                transport: {
                    method: "websocket",
                    session_id: streamerWebsocketSessionID,
                },
            }),
        },
    );

    if (response_subscription.status != 202) {
        let data = await response_subscription.json();
        console.error(
            "Failed to subscribe to channel.subscribe. API call returned status code " +
                response_subscription.status,
        );
        console.error(data);
        process.exit(1);
    } else {
        const data2 = await response_subscription.json();
        console.log(`Subscribed to channel.subscribe [${data2.data[0].id}]`);
    }
}

async function registerFollowListener() {
    let response_follow = await fetch(
        "https://api.twitch.tv/helix/eventsub/subscriptions",
        {
            method: "POST",
            headers: {
                Authorization: "Bearer " + STREAMER_OAUTH_TOKEN,
                "Client-Id": CLIENT_ID,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "channel.follow",
                version: "2",
                condition: {
                    broadcaster_user_id: CHAT_CHANNEL_USER_ID,
                    moderator_user_id: CHAT_CHANNEL_USER_ID,
                },
                transport: {
                    method: "websocket",
                    session_id: streamerWebsocketSessionID,
                },
            }),
        },
    );

    if (response_follow.status != 202) {
        let data = await response_follow.json();
        console.error(
            "Failed to subscribe to channel.follow. API call returned status code " +
                response_follow.status,
        );
        console.error(data);
        process.exit(1);
    } else {
        const data3 = await response_follow.json();
        console.log(`Subscribed to channel.follow [${data3.data[0].id}]`);
    }
}
