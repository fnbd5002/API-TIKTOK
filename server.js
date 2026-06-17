const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// CAMBIA ESTO POR TU USUARIO DE TIKTOK
const TIKTOK_USERNAME = "TU_USUARIO";

let events = [];

function addEvent(type, data) {
    events.push({
        type,
        timestamp: Date.now(),
        data
    });

    if (events.length > 100) {
        events.shift();
    }
}

const tiktokLive = new WebcastPushConnection(TIKTOK_USERNAME);

tiktokLive.connect()
    .then(() => {
        console.log("Conectado al live");
    })
    .catch(console.error);

// FOLLOW
tiktokLive.on("follow", (data) => {
    addEvent("follow", {
        user: data.uniqueId
    });
});

// LIKE
tiktokLive.on("like", (data) => {
    addEvent("like", {
        user: data.uniqueId,
        totalLikes: data.totalLikeCount
    });
});

// COMENTARIO
tiktokLive.on("chat", (data) => {
    addEvent("chat", {
        user: data.uniqueId,
        message: data.comment
    });
});

// REGALO
tiktokLive.on("gift", (data) => {
    addEvent("gift", {
        user: data.uniqueId,
        giftId: data.giftId,
        giftName: data.giftName,
        repeatCount: data.repeatCount
    });
});

// Obtener todos los eventos pendientes
app.get("/events", (req, res) => {
    res.json(events);
    events = [];
});

// Estado
app.get("/", (req, res) => {
    res.json({
        online: true,
        connectedTo: TIKTOK_USERNAME,
        pendingEvents: events.length
    });
});

app.listen(PORT, () => {
    console.log(`API iniciada en puerto ${PORT}`);
});
