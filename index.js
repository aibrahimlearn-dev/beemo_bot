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
   🔒 GLOBAL LOCK (ONLY 1 PERSON AT A TIME)
========================= */

let botBusy = false;

/* =========================
   🕒 USER COOLDOWNS (30s per user)
========================= */

const userCooldowns = new Map();

function waitUserCooldown(userId) {
  const last = userCooldowns.get(userId) || 0;
  const now = Date.now();

  const waitTime = Math.max(0, 30000 - (now - last));

  return new Promise(resolve => {
    setTimeout(() => {
      userCooldowns.set(userId, Date.now());
      resolve();
    }, waitTime);
  });
}

/* =========================
   SESSION MEMORY
========================= */

const sessions = {};

function getSession(uid) {
  if (!sessions[uid]) sessions[uid] = { state: {}, history: [] };
  return sessions[uid];
}

/* =========================
   GEMINI CHAT
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

  const aiResponse = await limiter.schedule(() =>
    axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        system_instruction: {
          parts: [{ text: systemPrompt + "\n\n" + stateStr }]
        },
        contents: session.history
      }
    )
  );

  const rawReply =
    aiResponse.data.candidates[0].content.parts[0].text;

  const jsonMatch = rawReply.match(/\{"_state":.+\}/);

  if (jsonMatch) {
    try {
      const extracted = JSON.parse(jsonMatch[0])._state;
      Object.assign(session.state, extracted);
      console.log(`[${uid}] state:`, session.state);
    } catch (e) {
      console.error("State parse failed:", e.message);
    }
  }

  const cleanReply = rawReply
    .replace(/\{"_state":.+\}/, "")
    .trim();

  session.history.push({
    role: "model",
    parts: [{ text: cleanReply }]
  });

  return cleanReply;
}

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.send("working");
});

/* VERIFY WEBHOOK */
app.get("/webhook", (req, res) => {
  const verify_token = "123aaa";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === verify_token) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/* =========================
   MAIN WEBHOOK
========================= */

app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const userText = message.text?.body;
    const from = message.from;

    if (!userText) return res.sendStatus(200);

    /* =========================
       🔒 GLOBAL LOCK (ONLY 1 PERSON AT A TIME)
    ========================= */

    while (botBusy) {
      await new Promise(r => setTimeout(r, 1000));
    }

    botBusy = true;

    try {
      /* =========================
         USER COOLDOWN (30s)
      ========================= */

      await waitUserCooldown(from);

      /* =========================
         THINKING DELAY
      ========================= */

      await new Promise(r => setTimeout(r, 2000));

      const reply = await chat(from, userText);

      /* =========================
         7s TYPING SIMULATION
      ========================= */

      await new Promise(r => setTimeout(r, 7000));

      /* =========================
         SEND MESSAGE
      ========================= */

      await axios.post(
        `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: reply }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

    } finally {
      botBusy = false;
    }

    res.sendStatus(200);

  } catch (error) {
    botBusy = false;
    console.log("ERROR:", error.response?.data || error.message);
    res.sendStatus(200);
  }
});

/* =========================
   START SERVER
========================= */

app.listen(3000, () => {
  console.log("Server running on port 3000");
});