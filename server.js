/**
 * server.js
 * -------------------------------------------------------------
 * API sencilla en Node.js + Express que se conecta a un live de
 * TikTok (usando la librería "tiktok-live-connector" v2.x) y escucha:
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
 *
 * NOTA DE LA VERSIÓN: a partir de tiktok-live-connector v2.x la clase
 * principal se renombró de "WebcastPushConnection" a
 * "TikTokLiveConnection", y algunos campos de los eventos se movieron
 * (por ejemplo, antes "data.uniqueId" ahora es "data.user.uniqueId").
 * Este archivo ya está actualizado a esa versión.
 * -------------------------------------------------------------
 */

const express = require("express");
const cors = require("cors");
const { TikTokLiveConnection } = require("tiktok-live-connector");

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
 * Extrae uniqueId/nickname de forma segura. En v2.x estos datos vienen
 * anidados dentro de "data.user", a diferencia de v1.x donde estaban
 * directo en "data".
 */
function getUserFields(data) {
  const user = data.user || {};
  return {
    uniqueId: user.uniqueId || data.uniqueId || "desconocido",
    nickname: user.nickname || data.nickname || "desconocido",
  };
}

/**
 * Extrae los datos del regalo de forma segura. En v2.x viven dentro de
 * "data.gift" (nombre, tipo, diamantes), no sueltos en "data".
 */
function getGiftFields(data) {
  const gift = data.gift || {};
  return {
    giftName: gift.name || data.giftName || "Desconocido",
    giftType: gift.type ?? data.giftType ?? 0,
    diamondCount: gift.diamondCount ?? data.diamondCount ?? 0,
  };
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

  // v2.x requiere pasar un objeto de opciones (puede ir vacío {}).
  tiktokConnection = new TikTokLiveConnection(username, {
    enableExtendedGiftInfo: true,
  });

  const state = await tiktokConnection.connect();

  connectedUsername = username;
  roomId = state.roomId;
  isConnected = true;

  console.log(`Conectado al live de @${username} (roomId: ${roomId})`);

  // ---- Nuevos seguidores ----
  tiktokConnection.on("follow", (data) => {
    const { uniqueId, nickname } = getUserFields(data);
    stats.totalFollowers += 1;
    pushEvent("follow", { uniqueId, nickname });
  });

  // ---- Regalos (rosas y otras donaciones) ----
  tiktokConnection.on("gift", (data) => {
    const { giftName, giftType, diamondCount: diamondsPerUnit } = getGiftFields(data);
    const { uniqueId, nickname } = getUserFields(data);

    // Los regalos "streakables" (giftType === 1) se disparan varias
    // veces mientras el usuario mantiene presionado el botón.
    // Solo contamos cuando termina el streak (repeatEnd) para no
    // duplicar el conteo. Los regalos no-streakables se cuentan al toque.
    if (giftType === 1 && !data.repeatEnd) {
      return;
    }

    const repeatCount = data.repeatCount || 1;
    const diamondCount = diamondsPerUnit * repeatCount;

    stats.totalDonations += 1;
    stats.totalDiamonds += diamondCount;

    const esRosa =
      String(data.giftId) === "5655" ||
      giftName.toLowerCase().includes("rose") ||
      giftName.toLowerCase().includes("rosa");

    if (esRosa) {
      stats.totalRoses += repeatCount;
      pushEvent("rose", { uniqueId, nickname, count: repeatCount });
    } else {
      pushEvent("donation", { uniqueId, nickname, giftName, diamondCount, repeatCount });
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
