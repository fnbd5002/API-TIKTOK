const express = require("express");
const app = express();

const TikTok = require("tiktok-live-connector");

console.log("TIKTOK MODULE:");
console.log(TikTok);

app.get("/", (req, res) => {
    res.send("API FUNCIONANDO");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("SERVIDOR INICIADO");
});
