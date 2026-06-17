const express = require("express");
const app = express();

let lastEvent = null;

app.use(express.json());

app.post("/event", (req, res) => {
    lastEvent = req.body;
    res.json({ success: true });
});

app.get("/event", (req, res) => {
    res.json(lastEvent || {});
});

app.listen(3000);
