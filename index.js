import express from "express";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();

app.use(express.json());

let tiktokConnection = null;
let currentUser = null;

let events = [];
let connected = false;

// ========================
// Conectar a TikTok
// ========================

async function connectTikTok(username) {
    try {

        connected = false;

        if (tiktokConnection) {
            try {
                tiktokConnection.disconnect();
            } catch {}
        }

        events = [];

        tiktokConnection = new WebcastPushConnection(username);

        await tiktokConnection.connect();

        connected = true;
        currentUser = username;

        console.log(`✅ Conectado a ${username}`);

        // REGALOS
        tiktokConnection.on("gift", data => {

            events.push({
                type: "gift",
                user: data.uniqueId,
                gift: data.giftName,
                amount: data.repeatCount,
                timestamp: Date.now()
            });

            console.log(
                `🎁 ${data.uniqueId} envió ${data.giftName}`
            );
        });

        // NUEVOS SEGUIDORES
        tiktokConnection.on("follow", data => {

            events.push({
                type: "follow",
                user: data.uniqueId,
                timestamp: Date.now()
            });

            console.log(
                `➕ ${data.uniqueId} siguió la cuenta`
            );
        });

        // LIKES
        tiktokConnection.on("like", data => {

            events.push({
                type: "like",
                user: data.uniqueId,
                likes: data.likeCount,
                timestamp: Date.now()
            });

        });

    } catch (err) {

        connected = false;

        console.error(
            "❌ Error conectando:",
            err.message
        );
    }
}

// ========================
// RUTAS
// ========================

app.get("/", (req, res) => {

    res.json({
        status: "online",
        connected,
        currentUser
    });

});

// Cambiar usuario TikTok
app.post("/set-user", async (req, res) => {

    const username =
        req.body.username?.replace("@", "");

    if (!username) {
        return res.status(400).json({
            success: false,
            error: "username requerido"
        });
    }

    res.json({
        success: true,
        connecting: username
    });

    connectTikTok(username);
});

// Obtener eventos
app.get("/events", (req, res) => {

    res.json({
        connected,
        currentUser,
        events
    });

});

// Limpiar eventos
app.post("/clear-events", (req, res) => {

    events = [];

    res.json({
        success: true
    });

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `🚀 API iniciada en puerto ${PORT}`
    );

});
