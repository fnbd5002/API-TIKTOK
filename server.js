const express = require("express");
const app = express();

app.use(express.json());

let currentUser = null;

app.post("/setuser", async (req, res) => {
    const username = req.body.username;

    if (!username) {
        return res.status(400).json({
            success: false
        });
    }

    try {
        // desconectar conexión anterior
        if (currentUser?.disconnect) {
            currentUser.disconnect();
        }

        // aquí crearías la nueva conexión TikTok
        currentUser = {
            username
        };

        res.json({
            success: true,
            username
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.get("/status", (req, res) => {
    res.json({
        username: currentUser?.username || null
    });
});

app.listen(process.env.PORT || 3000);
