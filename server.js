const express = require("express");
const TikTokLive = require("tiktok-live-connector");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
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

console.log("TikTok Connector:", TikTokLive);

app.get("/", (req, res) => {
    res.json({
        online: true,
        username: TIKTOK_USERNAME,
        pendingEvents: events.length
    });
});

app.get("/events", (req, res) => {
    res.json(events);
    events = [];
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
