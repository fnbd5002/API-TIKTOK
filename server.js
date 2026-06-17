const express = require("express");
const app = express();

app.get("/", (req, res) => {
    res.send("API FUNCIONANDO");
});

app.get("/event", (req, res) => {
    res.json({
        success: true,
        message: "event endpoint funcionando"
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("SERVIDOR INICIADO");
});
