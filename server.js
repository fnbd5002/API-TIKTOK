import express from "express";
import { WebcastPushConnection } from "tiktok-live-connector";

const app = express();
const PORT = process.env.PORT || 3000;

const tiktok = new WebcastPushConnection("TU_USUARIO");

let ultimoEvento = {};

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

tiktok.connect();

app.get("/", (req, res) => {
    res.send("API funcionando");
});

app.get("/eventos", (req, res) => {
    res.json(ultimoEvento);
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado en ${PORT}`);
});
