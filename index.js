require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "1mb" }));
process.on("unhandledRejection", e => console.error("💥", e?.message));
process.on("uncaughtException", e => console.error("💥", e?.message));

// ─── CONFIG ─────────────────────────────────────────────

const WA_API = `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;
const WA_H = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" };
const SYSTEM = fs.readFileSync("systemPrompt.txt", "utf-8");
const TTL = 259200000; // 3 days
const MAX_SESSIONS = 50;

// ─── SESSION ────────────────────────────────────────────

const $ = {};

function get$(phone) {
  const n = Date.now();
  if (!$[phone] || n > $[phone].exp) {
    if (Object.keys($).length >= MAX_SESSIONS) {
      const oldest = Object.entries($).sort((a, b) => a[1].exp - b[1].exp)[0];
      if (oldest) delete $[oldest[0]];
    }
    $[phone] = { d: {}, exp: n + TTL };
  }
  return $[phone].d;
}

function set$(phone, k, v) { const s = get$(phone); s[k] = v; $[phone].exp = Date.now() + TTL; }

// ─── HISTORY ────────────────────────────────────────────

const H = {};
function getH(phone) { if (!H[phone]) H[phone] = []; return H[phone]; }
function addH(phone, role, text) { const h = getH(phone); h.push({ role, content: text }); if (h.length > 8) h.splice(0, h.length - 8); }

// ─── ABUSE ──────────────────────────────────────────────

const ABUSE = [/ignore\s+(all\s+)?(previous|above|system).{0,20}(instruction|prompt|rule)/i,
  /(hack|crack|exploit|bypass|inject|malicious|virus|malware|attack)/i,
  /(credit.?card|password|bank.?account|ssn|social.?security)/i,
  /\b(cv|cvv|pin|otp|2fa)\b/i, /(fuck|shit|bitch|asshole|bastard)/i,
  /(kill|die|hurt|harm)\s+(yourself|you)/i];
function isAbuse(t) { return ABUSE.some(p => p.test(t)); }

// ─── WHATSAPP API ───────────────────────────────────────

async function txt(to, text) {
  try { await axios.post(WA_API, { messaging_product: "whatsapp", to, type: "text", text: { body: text } }, { headers: WA_H }); }
  catch (e) { console.error("WA txt:", e?.response?.data || e.message); }
}

async function img(to, url, caption) {
  try { await axios.post(WA_API, { messaging_product: "whatsapp", to, type: "image", image: { link: url, caption: caption || "" } }, { headers: WA_H }); return true; }
  catch (e) { console.error("WA img:", e?.response?.data || e.message); return false; }
}

async function btns(to, body, list) {
  try { await axios.post(WA_API, { messaging_product: "whatsapp", to, type: "interactive", interactive: { type: "button", body: { text: body }, action: { buttons: list.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.title.substring(0, 20) } })) } } }, { headers: WA_H }); }
  catch (e) { console.error("WA btns:", e?.response?.data || e.message); }
}

async function list(to, header, body, label, sections) {
  try { await axios.post(WA_API, { messaging_product: "whatsapp", to, type: "interactive", interactive: { type: "list", header: { type: "text", text: header.substring(0, 60) }, body: { text: body }, action: { button: label.substring(0, 20), sections } } }, { headers: WA_H }); }
  catch (e) { console.error("WA list:", e?.response?.data || e.message); }
}

// ─── MEDIA ──────────────────────────────────────────────

const ROOMS = [
  { url: "https://ibrahimhostel.com/images/4seater.jpg", cap: "4-seater — ~18,000" },
  { url: "https://ibrahimhostel.com/images/3seater.jpg", cap: "3-seater — ~22,000" },
  { url: "https://ibrahimhostel.com/images/2seater.jpg", cap: "2-seater — ~24,000" },
  { url: "https://ibrahimhostel.com/images/1seater.jpg", cap: "1-seater — ~28,000" },
];
const FACS = [
  { url: "https://ibrahimhostel.com/images/rooftop.jpg", cap: "Rooftop Terrace" },
  { url: "https://ibrahimhostel.com/images/food.jpg", cap: "Fresh meals included" },
  { url: "https://ibrahimhostel.com/images/wifi.jpg", cap: "Fiber WiFi" },
  { url: "https://ibrahimhostel.com/images/security.jpg", cap: "CCTV + 24/7 guard" },
];

async function showRooms(to) {
  await txt(to, "Here are our rooms —");
  let fail = 0;
  for (const r of ROOMS) { if (!await img(to, r.url, r.cap)) fail++; await new Promise(r => setTimeout(r, 300)); }
  if (fail) await txt(to, "Kuch photos abhi load nahi hui, thori der mein bhej dunga.");
}

async function showFacs(to) {
  await txt(to, "Our facilities:");
  let fail = 0;
  for (const f of FACS) { if (!await img(to, f.url, f.cap)) fail++; await new Promise(r => setTimeout(r, 300)); }
  if (fail) await txt(to, "Kuch photos abhi nahi aa sakin, baad mein bhejunga.");
}

// ─── MENU ───────────────────────────────────────────────

const MENU = [
  { title: "🛏️ Rooms", rows: [
    { id: "SEND_ROOM_PICS", title: "Room photos", description: "See the actual rooms" },
    { id: "BROWSE_ROOMS", title: "Room types & prices", description: "View all room options" },
  ]},
  { title: "🏠 Facilities", rows: [
    { id: "SEND_FACILITY_PICS", title: "Facilities", description: "Rooftop, WiFi, meals, security" },
  ]},
  { title: "📅 Booking", rows: [
    { id: "BOOK_NOW", title: "Book now", description: "Start the booking process" },
    { id: "TALK_HUMAN", title: "Talk to Professor Yahya", description: "He'll guide you" },
  ]},
];

// ─── FOLLOW-UP ──────────────────────────────────────────

const FU = {};
async function scheduleFU(phone) {
  const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 15, 0, 0);
  FU[phone] = t.getTime();
}
async function processFU() {
  while (true) {
    const n = Date.now();
    for (const [p, ts] of Object.entries(FU)) {
      if (n >= ts) {
        if (get$(p).blocked) { delete FU[p]; continue; }
        await txt(p, `Hi ${get$(p).name || ""} 👋 Beemo here — still looking? We have seats available.`);
        await btns(p, "What would you like?", [{ id: "BOOK_NOW", title: "✅ Book now" }, { id: "SEND_ROOM_PICS", title: "📸 Rooms" }, { id: "TALK_HUMAN", title: "🙋 Talk to staff" }]);
        delete FU[p];
      }
    }
    await new Promise(r => setTimeout(r, 60000));
  }
}

// ─── DEEPSEEK ───────────────────────────────────────────

async function ai(phone, text) {
  const session = get$(phone), h = getH(phone);
  let ctx = "";
  for (const [k, l] of Object.entries({ name: "Name", from: "From", dates: "Dates", duration: "Duration", workStudy: "Work/Study", roomType: "Room interest" }))
    if (session[k]) ctx += `${l}: ${session[k]}\n`;
  if (ctx) ctx = `[Known: ${ctx}]\n`;

  const msgs = [{ role: "system", content: SYSTEM }];
  for (const m of h) msgs.push(m);
  msgs.push({ role: "user", content: ctx + text });

  try {
    const r = await axios.post("https://api.deepseek.com/chat/completions",
      { model: "deepseek-chat", messages: msgs, max_tokens: 500, temperature: 0.7 },
      { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_KEY}`, "Content-Type": "application/json" }, timeout: 30000 });
    const reply = r.data.choices[0].message.content;
    addH(phone, "user", text); addH(phone, "assistant", reply);
    set$(phone, "msgCount", (session.msgCount || 0) + 1);
    return reply;
  } catch (e) {
    console.error("❌ AI:", e?.response?.data?.error?.message || e.message);
    return "I'm having a quick technical issue — one moment please! Try asking again or I'll get back to you shortly.";
  }
}

// ─── MAIN HANDLER ───────────────────────────────────────

async function handle(phone, text) {
  const t = text.trim().toLowerCase();

  // Abuse → silent block
  if (isAbuse(t)) { console.log(`🚫 ${phone.slice(-6)}`); set$(phone, "blocked", true); return; }

  // Dead convo → STFU
  const deadSignals = ["ok", "okay", "thanks", "thank you", "will see", "maybe later", "not now", "bye", "k", "sure", "no thanks"];
  if (!get$(phone).blocked) {
    const isDead = deadSignals.includes(t) || t.length < 3;
    set$(phone, "deadCount", isDead ? (get$(phone).deadCount || 0) + 1 : 0);
  }
  if ((get$(phone).deadCount || 0) >= 2 || (get$(phone).msgCount || 0) >= 30 || get$(phone).blocked) {
    if (!get$(phone).deadNotified) { set$(phone, "deadNotified", true); await txt(phone, "I've shared the main info. Professor Yahya will follow up with you."); }
    return;
  }

  const s = get$(phone);
  const count = (s.msgCount || 0) + 1;
  set$(phone, "msgCount", count);
  set$(phone, "_lastActive", Date.now());

  // Greeting → intro (one question)
  if (!s.greeted && /^(hi|hello|hey|salam|hii?|helloo?)\W*$/i.test(text.trim())) {
    set$(phone, "greeted", true);
    await txt(phone, "Hi! I'm Beemo from Ibrahim Hostel Islamabad 🏠\n\nAap kahan study ya job karte hain?");
    return;
  }
  if (!s.greeted) set$(phone, "greeted", true);

  // AI handles the rest
  const reply = await ai(phone, text);
  await txt(phone, reply);

  // Catalog menu after 4+ messages (once)
  if (count >= 4 && !s.menuShown) {
    set$(phone, "menuShown", true);
    await list(phone, "Aap kya dekhna chahenge? 👇", "Browse options:", "📋 Browse", MENU);
  }
}

// ─── WEBHOOK ────────────────────────────────────────────

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);
    const phone = msg.from;

    if (msg.type === "text") {
      console.log(`📩 ${phone.slice(-6)}: ${(msg.text.body || "").substring(0, 60)}`);
      if (get$(phone).blocked) return res.sendStatus(200);
      await handle(phone, (msg.text.body || "").substring(0, 1000));
    }

    if (msg.type === "interactive") {
      const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
      if (!reply) return res.sendStatus(200);
      console.log(`🔘 ${phone.slice(-6)}: ${reply.id}`);

      if (reply.id === "SEND_ROOM_PICS") { await showRooms(phone); await btns(phone, "Which one?", [{ id: "BOOK_NOW", title: "✅ Book" }, { id: "ASK_AGAIN", title: "❓ Questions" }]); }
      else if (reply.id === "SEND_FACILITY_PICS") await showFacs(phone);
      else if (reply.id === "BROWSE_ROOMS") await txt(phone, "Per person/month (all-inclusive):\n• 4-seater: ~18,000\n• 3-seater: ~22,000\n• 2-seater: ~24,000\n• 1-seater: ~28,000");
      else if (reply.id === "BOOK_NOW") { await txt(phone, "Great! Could you share your name aur kis date se room chahiye? Professor Yahya will confirm."); await scheduleFU(phone); }
      else if (reply.id === "TALK_HUMAN") await txt(phone, "Connecting you with Professor Yahya 🙋 He'll reply here.");
      else await handle(phone, reply.title);
    }

    res.sendStatus(200);
  } catch (e) { console.error("⚠️", e.message); res.sendStatus(200); }
});

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === (process.env.VERIFY_TOKEN || "ibrahim123"))
    return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.get("/", (_, res) => res.send("Beemo 🏠"));

app.listen(process.env.PORT || 3000, () => {
  console.log("Beemo online on", process.env.PORT || 3000);
  console.log("Key check:", process.env.DEEPSEEK_KEY?.substring(0, 10) || "MISSING", "...");
  processFU();
});
