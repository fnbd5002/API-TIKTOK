/**
 * server.js
 * -------------------------------------------------------------
 * API sencilla en Node.js + Express que se conecta a un live de
 * TikTok usando Tik.Tools (https://tik.tools) -- un servicio de
 * terceros NO afiliado a TikTok, con un nivel gratuito real (sin
 * tarjeta de crédito) -- y escucha:
 *
 *   - Nuevos seguidores      -> evento "follow"
 *   - Rosas donadas          -> evento "rose"   (regalo "Rose")
 *   - Otras donaciones/regalos -> evento "donation"
 *
 * Roblox Studio NO puede recibir "push" (no es un servidor), así
 * que el patrón usado aquí es POLLING:
 *   1) Esta API guarda cada evento en una cola en memoria con un id
 *      incremental.
 *   2) Roblox llama cada X segundos a GET /events?since=<ultimoId>
 *      y recibe solo los eventos nuevos.
 *
 * CÓMO FUNCIONA TIK.TOOLS:
 *   1) POST /authentication/jwt con tu apiKey -> te da un token JWT
 *      de corta duración para un usuario de TikTok específico.
 *   2) Te conectas a un WebSocket con ese token y recibes eventos
 *      en tiempo real: chat, gift, like, follow, share, etc.
 *   3) El plan gratis ("Sandbox") permite sesiones de hasta 2 horas;
 *      por eso este archivo reconecta automáticamente cuando el
 *      WebSocket se cierra.
 *
 * Para obtener tu propia clave gratuita (recomendado en vez de la
 * clave de demostración pública, que tiene límites mucho más bajos):
 *   1) Entra a https://tik.tools/login e inicia sesión con Google.
 *   2) Copia tu API key del dashboard.
 *   3) En Render, agrega la variable de entorno TIKTOOL_API_KEY con
 *      esa clave.
 *
 * Pensado para desplegarse en Render (usa process.env.PORT).
 * -------------------------------------------------------------
 */

const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const TIKTOOL_API = "https://api.tik.tools";
const TIKTOOL_WS = "wss://api.tik.tools";

// La clave de demostración pública ("your_api_key") funciona SIN registrarte,
// pero con límites muy bajos (sesiones de 10 min). Para uso real, consigue tu
// propia clave gratis en https://tik.tools/login y ponla en la variable de
// entorno TIKTOOL_API_KEY.
const TIKTOOL_API_KEY = process.env.TIKTOOL_API_KEY || "your_api_key";

// -----------------------------------------------------------------
// Estado global de la conexión a TikTok
// -----------------------------------------------------------------
let ws = null;
let connectedUsername = null;
let isConnected = false;
let reconnectTimer = null;

// Cola de eventos en memoria (lo que Roblox va a leer)
let eventQueue = [];
let nextEventId = 1;
const MAX_QUEUE_LENGTH = 1000;

// Contadores acumulados
const stats = {
  totalFollowers: 0,
  totalRoses: 0,
  totalDonations: 0,
  totalDiamonds: 0,
};

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

function getUserFields(data) {
  const user = data.user || {};
  return {
    uniqueId: user.uniqueId || "desconocido",
    nickname: user.nickname || user.uniqueId || "desconocido",
  };
}

/**
 * Pide un token JWT de corta duración para conectarse al live de
 * un usuario específico.
 */
async function getJwt(username) {
  const res = await fetch(`${TIKTOOL_API}/authentication/jwt?apiKey=${encodeURIComponent(TIKTOOL_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_creators: [username],
      expire_after: 7000, // ~2 horas, el máximo del plan gratis
      max_websockets: 1,
    }),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json || !json.data || !json.data.token) {
    throw new Error(
      `No se pudo obtener token para @${username} (HTTP ${res.status}): ${JSON.stringify(json)}`
    );
  }

  return json.data.token;
}

/**
 * Procesa cada mensaje que llega por el WebSocket y lo clasifica en
 * follow / rose / donation, igual que antes.
 */
// Guarda los últimos mensajes crudos que llegan del WebSocket, sin filtrar,
// para poder diagnosticar qué está enviando realmente Tik.Tools.
let rawMessageLog = [];
const MAX_RAW_LOG = 30;

function logRawMessage(raw) {
  rawMessageLog.push({ timestamp: Date.now(), raw: raw.slice(0, 2000) });
  if (rawMessageLog.length > MAX_RAW_LOG) {
    rawMessageLog = rawMessageLog.slice(rawMessageLog.length - MAX_RAW_LOG);
  }
}

function handleMessage(raw) {
  logRawMessage(raw);
  let e;
  try {
    e = JSON.parse(raw);
  } catch (err) {
    return;
  }

  if (!e || !e.event || e.event === "roomInfo") {
    return;
  }

  const data = e.data || {};

  if (e.event === "follow") {
    const { uniqueId, nickname } = getUserFields(data);
    stats.totalFollowers += 1;
    pushEvent("follow", { uniqueId, nickname });
    return;
  }

  if (e.event === "gift") {
    // Los regalos en racha (combo) reenvían el mismo evento varias veces
    // con repeatEnd:false hasta que el usuario suelta el botón. Esperamos
    // a repeatEnd:true para contar el total final, igual que antes.
    if (data.repeatEnd === false) {
      return;
    }

    const { uniqueId, nickname } = getUserFields(data);
    const giftName = data.giftName || "Desconocido";
    const repeatCount = data.repeatCount || 1;
    const diamondCount = (data.diamondCount || 0) * repeatCount;

    stats.totalDonations += 1;
    stats.totalDiamonds += diamondCount;

    const esRosa =
      Number(data.giftId) === 5655 ||
      giftName.toLowerCase().includes("rose") ||
      giftName.toLowerCase().includes("rosa");

    if (esRosa) {
      stats.totalRoses += repeatCount;
      pushEvent("rose", { uniqueId, nickname, count: repeatCount });
    } else {
      pushEvent("donation", { uniqueId, nickname, giftName, diamondCount, repeatCount });
    }
  }
}

/**
 * Conecta (o reconecta) al live de un usuario de TikTok.
 * Se reconecta solo cuando el WebSocket se cierra (las sesiones del
 * plan gratis duran máximo ~2 horas).
 */
function connectToTikTok(username) {
  return new Promise(async (resolve, reject) => {
    if (ws) {
      try {
        ws.removeAllListeners();
        ws.close();
      } catch (err) {
        // ignorar
      }
      ws = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    let token;
    try {
      token = await getJwt(username);
    } catch (err) {
      return reject(err);
    }

    connectedUsername = username;
    ws = new WebSocket(`${TIKTOOL_WS}?uniqueId=${encodeURIComponent(username)}&jwtKey=${encodeURIComponent(token)}`);

    let settled = false;

    ws.on("open", () => {
      isConnected = true;
      settled = true;
      console.log(`Conectado al live de @${username}`);
      resolve({ username });
    });

    ws.on("message", (raw) => handleMessage(raw.toString()));

    ws.on("close", (code, reason) => {
      isConnected = false;
      console.log(`Conexión cerrada con @${username} (code ${code}): ${reason}`);

      // Reconectar automáticamente si seguimos "queriendo" este usuario
      // (es decir, no se llamó a /disconnect mientras tanto).
      if (connectedUsername === username) {
        reconnectTimer = setTimeout(() => {
          connectToTikTok(username).catch((err) =>
            console.error(`Error al reconectar a @${username}:`, err.message)
          );
        }, 3000);
      }
    });

    ws.on("error", (err) => {
      console.error("Error de WebSocket:", err.message);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function disconnectFromTikTok() {
  connectedUsername = null;
  isConnected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.close();
    } catch (err) {
      // ignorar
    }
    ws = null;
  }
}

// -----------------------------------------------------------------
// Rutas de la API
// -----------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensaje: "TikTok Live -> Roblox API funcionando (vía Tik.Tools)",
    conectado: isConnected,
    usuario: connectedUsername,
  });
});

app.post("/connect", async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ ok: false, error: "Falta 'username' en el body" });
  }

  try {
    await connectToTikTok(username);
    res.json({ ok: true, mensaje: `Conectado a @${username}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/disconnect", (req, res) => {
  disconnectFromTikTok();
  res.json({ ok: true, mensaje: "Desconectado" });
});

app.get("/status", (req, res) => {
  res.json({
    conectado: isConnected,
    usuario: connectedUsername,
  });
});

app.get("/stats", (req, res) => {
  res.json(stats);
});

app.get("/debug/raw", (req, res) => {
  res.json({
    isConnected,
    connectedUsername,
    totalRawMessages: rawMessageLog.length,
    messages: rawMessageLog,
  });
});

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

  if (process.env.TIKTOK_USERNAME) {
    connectToTikTok(process.env.TIKTOK_USERNAME)
      .then(() => console.log(`Auto-conectado a @${process.env.TIKTOK_USERNAME}`))
      .catch((err) => console.error("Error al auto-conectar:", err.message));
  }
});
