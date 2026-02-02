import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

const BOT_USER_ID = process.env.BOT_USER_ID; // This is the User ID of the chat bot
const CLIENT_ID = process.env.CLIENT_ID_OF_APP;
const Redirect_URI = process.env.REDIRECT_URI_OF_APP;
const CHAT_CHANNEL_USER_ID = process.env.STREAMER_USER_ID; // This is the User ID of the channel that the bot will join and listen to chat messages of
const EVENTSUB_WEBSOCKET_URL = process.env.EVENTSUB_WEBSOCKET_URL;
const OAUTH_TOKEN = process.env.BOT_OAUTH_TOKEN;
const STREAMER_OAUTH_TOKEN = process.env.STREAMER_OAUTH_TOKEN;
const GITHUB_URL = process.env.GITHUB_URL;
let botWebsocketSessionID;
let streamerWebsocketSessionID;

// Start executing the bot from here
(async () => {
    if (!OAUTH_TOKEN) {
        await getOAuthToken();
        console.error(
            "No BOT_OAUTH_TOKEN found. Open the URL above, authorize the bot account, then set BOT_OAUTH_TOKEN in your .env and restart.",
        );
        process.exit(1);
    }

    if (!STREAMER_OAUTH_TOKEN) {
        await getStreamerOAuthToken();
        console.error(
            "No STREAMER_OAUTH_TOKEN found. Open the URL above, authorize the streamer account, then set STREAMER_OAUTH_TOKEN in your .env and restart.",
        );
        process.exit(1);
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
        "moderator:read:followers",
    ];

    const url = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${Redirect_URI}&response_type=token&scope=${Scopes.join("%20")}`;

    console.log(
        "To authorize the bot, please open the following URL in your browser:\n",
    );
    console.log(url);

    // Note: Implicit grant requires manual copy of the token from the redirect URL.
}

async function getStreamerOAuthToken() {
    let Scopes = ["channel:read:subscriptions", "moderator:read:followers"];

    const url = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${Redirect_URI}&response_type=token&scope=${Scopes.join("%20")}`;

    console.log(
        "To authorize the streamer account, please open the following URL in your browser:\n",
    );
    console.log(url);
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
