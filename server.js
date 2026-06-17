import express from "express";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();
const PORT = process.env.PORT || 3000;

let tiktok = null;
let ultimoEvento = {};

app.get("/", (req, res) => {
    res.send("API funcionando");
});

app.get("/connect/:username", async (req, res) => {
    try {
        const username = req.params.username;

        if (tiktok) {
            try {
                tiktok.disconnect();
            } catch {}
        }

        tiktok = new WebcastPushConnection(username);

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

        tiktok.on("like", (data) => {
            ultimoEvento = {
                tipo: "like",
                usuario: data.uniqueId,
                likes: data.likeCount
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

app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
});
