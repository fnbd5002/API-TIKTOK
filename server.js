import express from "express";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();

let tiktok = null;
let ultimoEvento = {};

app.get("/connect/:username", async (req, res) => {
    const username = req.params.username;

    try {
        if (tiktok) {
            tiktok.disconnect();
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

        await tiktok.connect();

        res.json({
            success: true,
            conectadoA: username
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get("/eventos", (req, res) => {
    res.json(ultimoEvento);
});

app.listen(process.env.PORT || 3000);
