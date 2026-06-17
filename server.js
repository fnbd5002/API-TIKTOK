/**
 * server.js
 * -------------------------------------------------------------
 * API sencilla en Node.js + Express que se conecta a un live de
 * TikTok (usando la librería "tiktok-live-connector") y escucha:
 *
 *   - Nuevos seguidores      -> evento "follow"
 *   - Rosas donadas          -> evento "rose"   (regalo "Rose"/"Rosa")
 *   - Otras donaciones/regalos -> evento "donation"
 *
 * Roblox Studio NO puede recibir "push" (no es un servidor), así
 * que el patrón usado aquí es POLLING:
 *   1) Esta API guarda cada evento en una cola en memoria con un id
 *      incremental.
 *   2) Roblox llama cada X segundos a GET /events?since=<ultimoId>
 *      y recibe solo los eventos nuevos.
 *
 * Pensado para desplegarse en Render (usa process.env.PORT).
 * -------------------------------------------------------------
 */

const express = require("express");
const cors = require("cors");
const { WebcastPushConnection } = require("tiktok-live-connector");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------
// Estado global de la conexión a TikTok
// -----------------------------------------------------------------
let tiktokConnection = null;
let connectedUsername = null;
let roomId = null;
let isConnected = false;

// Cola de eventos en memoria (lo que Roblox va a leer)
let eventQueue = [];
let nextEventId = 1;
const MAX_QUEUE_LENGTH = 1000; // evita que crezca infinito si nadie hace polling

// Contadores acumulados (útiles para mostrar totales en Roblox)
const stats = {
  totalFollowers: 0,
  totalRoses: 0,
  totalDonations: 0,
  totalDiamonds: 0,
};

/**
 * Agrega un evento a la cola y recorta la cola si es muy larga.
 */
function pushEvent(type, data) {
  const event = {
    id: nextEventId++,
    type,
    data,
    timestamp: Date.now(),
  };
  eventQueue.push(event);
  if (eventQueue.length > MAX_QUEUE_LENGTH) {
    eventQueue = eventQueue.slice(eventQueue.length - MAX_QUEUE_LENGTH);
  }
  console.log(`[EVENT] ${type}:`, JSON.stringify(data));
  return event;
}

/**
 * Conecta (o reconecta) a un usuario de TikTok que esté en vivo
 * y registra los listeners de los eventos que nos interesan.
 */
async function connectToTikTok(username) {
  if (tiktokConnection) {
    try {
      tiktokConnection.disconnect();
    } catch (err) {
      // ignorar errores al desconectar la sesión anterior
    }
  }

  tiktokConnection = new WebcastPushConnection(username, {
    // opciones por defecto; se pueden ajustar si hace falta
    enableExtendedGiftInfo: true,
  });

  const state = await tiktokConnection.connect();

  connectedUsername = username;
  roomId = state.roomId;
  isConnected = true;

  console.log(`Conectado al live de @${username} (roomId: ${roomId})`);

  // ---- Nuevos seguidores ----
  tiktokConnection.on("follow", (data) => {
    stats.totalFollowers += 1;
    pushEvent("follow", {
      uniqueId: data.uniqueId,
      nickname: data.nickname,
    });
  });

  // ---- Regalos (rosas y otras donaciones) ----
  tiktokConnection.on("gift", (data) => {
    // Los regalos "streakables" (giftType === 1) se disparan varias
    // veces mientras el usuario mantiene presionado el botón.
    // Solo contamos cuando termina el streak (repeatEnd) para no
    // duplicar el conteo. Los regalos no-streakables se cuentan al toque.
    if (data.giftType === 1 && !data.repeatEnd) {
      return;
    }

    const repeatCount = data.repeatCount || 1;
    const diamondCount = (data.diamondCount || 0) * repeatCount;
    const giftName = data.giftName || "Desconocido";

    stats.totalDonations += 1;
    stats.totalDiamonds += diamondCount;

    const esRosa =
      data.giftId === 5655 || giftName.toLowerCase().includes("rose") || giftName.toLowerCase().includes("rosa");

    if (esRosa) {
      stats.totalRoses += repeatCount;
      pushEvent("rose", {
        uniqueId: data.uniqueId,
        nickname: data.nickname,
        count: repeatCount,
      });
    } else {
      pushEvent("donation", {
        uniqueId: data.uniqueId,
        nickname: data.nickname,
        giftName,
        diamondCount,
        repeatCount,
      });
    }
  });

  // ---- Manejo de desconexión del stream ----
  tiktokConnection.on("streamEnd", () => {
    console.log(`El live de @${username} terminó.`);
    isConnected = false;
  });

  tiktokConnection.on("disconnected", () => {
    isConnected = false;
  });

  return state;
}

// -----------------------------------------------------------------
// Rutas de la API
// -----------------------------------------------------------------

// Salud / info básica
app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensaje: "TikTok Live -> Roblox API funcionando",
    conectado: isConnected,
    usuario: connectedUsername,
  });
});

// Iniciar conexión con un usuario de TikTok que esté en vivo
// Body: { "username": "nombre_de_usuario" }
app.post("/connect", async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ ok: false, error: "Falta 'username' en el body" });
  }

  try {
    const state = await connectToTikTok(username);
    res.json({ ok: true, mensaje: `Conectado a @${username}`, roomId: state.roomId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Desconectar
app.post("/disconnect", (req, res) => {
  if (tiktokConnection) {
    tiktokConnection.disconnect();
  }
  isConnected = false;
  res.json({ ok: true, mensaje: "Desconectado" });
});

// Estado actual de la conexión
app.get("/status", (req, res) => {
  res.json({
    conectado: isConnected,
    usuario: connectedUsername,
    roomId,
  });
});

// Totales acumulados (seguidores, rosas, donaciones)
app.get("/stats", (req, res) => {
  res.json(stats);
});

// Eventos nuevos desde un id dado. Roblox debe llamar esto en bucle.
// Ejemplo: GET /events?since=0
app.get("/events", (req, res) => {
  const since = parseInt(req.query.since || "0", 10);
  const nuevos = eventQueue.filter((e) => e.id > since);
  const lastId = eventQueue.length > 0 ? eventQueue[eventQueue.length - 1].id : since;

  res.json({
    lastId,
    events: nuevos,
  });
});

// -----------------------------------------------------------------
// Arranque del servidor
// -----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);

  // Si se define la variable de entorno TIKTOK_USERNAME en Render,
  // la API se conecta automáticamente al arrancar.
  if (process.env.TIKTOK_USERNAME) {
    connectToTikTok(process.env.TIKTOK_USERNAME)
      .then(() => console.log(`Auto-conectado a @${process.env.TIKTOK_USERNAME}`))
      .catch((err) => console.error("Error al auto-conectar:", err.message));
  }
});
