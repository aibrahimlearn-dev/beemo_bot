const fs = require("fs");
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const Bottleneck = require("bottleneck");

const app = express();
app.use(express.json());

/* =========================
   CONFIG
========================= */

const limiter = new Bottleneck({
  minTime: 2000
});

const systemPrompt = fs.readFileSync("systemPrompt.txt", "utf-8");

/* =========================
   GLOBAL QUEUE (ONE USER AT A TIME)
========================= */

const queue = [];
let processing = false;

/* =========================
   USER DATA
========================= */

const sessions = {};
const buffers = new Map();
const timers = new Map();
const lastReply = new Map();

/* =========================
   SESSION
========================= */

function getSession(uid) {
  if (!sessions[uid]) {
    sessions[uid] = { state: {}, history: [] };
  }
  return sessions[uid];
}

/* =========================
   GEMINI
========================= */

async function chat(uid, userText) {
  const session = getSession(uid);

  session.history.push({
    role: "user",
    parts: [{ text: userText }]
  });

  if (session.history.length > 6) {
    session.history = session.history.slice(-6);
  }

  const stateStr = Object.keys(session.state).length
    ? `[Lead so far: ${JSON.stringify(session.state)}]`
    : "";

  const res = await limiter.schedule(() =>
    axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        system_instruction: {
          parts: [{
            text:
              systemPrompt +
              "\n\nUse short replies (3–4 lines). Mix English + Roman Urdu. Use 'aap'. No Hindi." +
              "\n\n" + stateStr
          }]
        },
        contents: session.history
      }
    )
  );

  const raw = res.data.candidates[0].content.parts[0].text;

  const clean = raw.replace(/\{"_state":.+\}/, "").trim();

  session.history.push({
    role: "model",
    parts: [{ text: clean }]
  });

  return clean;
}

/* =========================
   SEND MESSAGE
========================= */

async function sendWhatsApp(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

/* =========================
   PROCESS ONE USER (STRICT QUEUE)
========================= */

async function processQueue() {
  if (processing) return;
  if (queue.length === 0) return;

  processing = true;

  const userId = queue.shift();
  const msgs = buffers.get(userId) || [];

  buffers.delete(userId);

  if (msgs.length === 0) {
    processing = false;
    return processQueue();
  }

  const now = Date.now();
  const last = lastReply.get(userId) || 0;

  if (now - last < 30000) {
    queue.push(userId);
    processing = false;
    return setTimeout(processQueue, 3000);
  }

  const combined = msgs.join("\n");

  const reply = await chat(userId, combined);

  await new Promise(r => setTimeout(r, 5000)); // typing delay

  await sendWhatsApp(userId, reply);

  lastReply.set(userId, Date.now());

  processing = false;

  processQueue();
}

/* =========================
   QUEUE MESSAGE
========================= */

function queueMessage(userId, text) {
  if (!buffers.has(userId)) buffers.set(userId, []);

  buffers.get(userId).push(text);

  if (!queue.includes(userId)) {
    queue.push(userId);
  }

  if (timers.get(userId)) {
    clearTimeout(timers.get(userId));
  }

  timers.set(
    userId,
    setTimeout(() => {
      processQueue();
    }, 6000) // batching window
  );
}

/* =========================
   WEBHOOK
========================= */

app.post("/webhook", async (req, res) => {
  const message =
    req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message) return res.sendStatus(200);

  const from = message.from;
  const text = message.text?.body;

  if (!text) return res.sendStatus(200);

  queueMessage(from, text);

  res.sendStatus(200);
});

/* =========================
   SERVER
========================= */

app.get("/", (req, res) => res.send("Beemo running"));

app.listen(3000, () => {
  console.log("Server running on port 3000");
});