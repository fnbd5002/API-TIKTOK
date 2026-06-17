import express from "express";
import { TikTokLiveConnection } from "tiktok-live-connector";

const app = express();

let tiktok = null;
let ultimoEvento = {};

app.get("/", (req, res) => {
    res.send("API funcionando");
});

app.get("/connect/:username", async (req, res) => {
    try {
        const username = req.params.username;

        if (tiktok) {
            tiktok.disconnect();
        }

        tiktok = new TikTokLiveConnection(username);

        tiktok.on("follow", (data) => {
            ultimoEvento = {
                tipo: "follow",
                usuario: data.uniqueId
            };
        });

        tiktok.on("gift", (data) => {
            ultimoEvento = {
                tipo: "gift",
                usuario: data.uniqueId,
                regalo: data.giftName
            };
        });

        await tiktok.connect();

        res.json({
            success: true,
            conectadoA: username
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get("/eventos", (req, res) => {
    res.json(ultimoEvento);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
