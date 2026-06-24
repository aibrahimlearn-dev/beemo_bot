require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "1mb" }));

process.on("unhandledRejection", e => console.error("Crash:", e?.message));
process.on("uncaughtException", e => console.error("Crash:", e?.message));

// ─── CONFIG ────────────────────────────────────────────

const WA_API = `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`;
const WA_HEADERS = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" };
const SYSTEM_PROMPT = fs.readFileSync("systemPrompt.txt", "utf-8");
const SESSION_TTL = 259200000; // 3 days in ms

// ─── SIMPLE SESSION (memory only, no file I/O) ─────────

const sessions = {}; // { phone: { data: {...}, expires: timestamp } }

function getSession(phone) {
  const now = Date.now();
  if (!sessions[phone] || now > sessions[phone].expires) {
    sessions[phone] = { data: {}, expires: now + SESSION_TTL };
  }
  return sessions[phone].data;
}

function setSession(phone, key, val) {
  const s = getSession(phone);
  s[key] = val;
  sessions[phone].expires = Date.now() + SESSION_TTL;
}

// ─── CHAT HISTORY ──────────────────────────────────────

const chatHistory = {};

function getHistory(phone) {
  if (!chatHistory[phone]) chatHistory[phone] = [];
  return chatHistory[phone];
}

function addHistory(phone, role, text) {
  const h = getHistory(phone);
  h.push({ role, content: text });
  if (h.length > 10) h.splice(0, h.length - 10);
}

// ─── DEEPSEEK ──────────────────────────────────────────

async function askAI(phone, userText) {
  const session = getSession(phone);
  const h = getHistory(phone);

  // Build context
  let ctx = "";
  const fields = { name: "Name", from: "From", dates: "Dates", duration: "Duration", workStudy: "Work/Study", roomType: "Room interest" };
  for (const [k, label] of Object.entries(fields)) {
    if (session[k]) ctx += `${label}: ${session[k]}\n`;
  }
  if (ctx) ctx = `[Guest info:\n${ctx}]\n\n`;

  // Gemini format: system_instruction + contents array
  const contents = [];
  for (const m of h) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: ctx + userText }]
  });

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: contents,
      },
      { timeout: 30000 }
    );

    const reply = res.data.candidates[0].content.parts[0].text;
    addHistory(phone, "user", userText);
    addHistory(phone, "assistant", reply);
    setSession(phone, "msgCount", (session.msgCount || 0) + 1);
    return reply;
  } catch (err) {
    const detail = err?.response?.data?.error?.message || err.message;
    console.error("❌ DeepSeek FAILED:", detail);
    console.error("   Full:", JSON.stringify(err?.response?.data || {}).substring(0, 200));
    return fallback(userText);
  }
}

function fallback(text) {
  const t = text.toLowerCase();
  if (t.includes("price") || t.includes("rate") || t.includes("cost") || t.includes("how much"))
    return "Here are our monthly rates (per person, all-inclusive):\n• 4-seater: ~18,000 PKR\n• 3-seater: ~22,000 PKR\n• 2-seater: ~24,000 PKR\n• 1-seater: ~28,000 PKR\n\nWould you like to see photos?";
  if (t.includes("photo") || t.includes("picture") || t.includes("pic") || t.includes("see") || t.includes("show"))
    return "Sure! Which would you like to see?\n1. Dorm rooms\n2. Common areas & facilities\n3. Food menu";
  if (t.includes("book") || t.includes("reserve") || t.includes("deposit") || t.includes("pay"))
    return "I can help with that! Your name aur kis date se room chahiye? Professor Yahya will confirm.";
  if (t.includes("location") || t.includes("where"))
    return "We're in I-11/2, Islamabad — House 1572, Street 8. Just 5 min from FAST, NUTECH, and Bahria University.";
  if (t.includes("hi") || t.includes("hello") || t.includes("hey") || t.includes("salam"))
    return "Hi! I'm Beemo from Ibrahim Hostel Islamabad 🏠\n\nAap kahan study ya job karte hain? Aur approximately kitne arse ke liye accommodation chahiye?";
  if (t.includes("name") || t.includes("who are you"))
    return "I'm Beemo, the booking assistant for Ibrahim Hostel Islamabad 🏠";
  // For anything else, give a real answer not a greeting
  if (t.includes("available") || t.includes("vacancy") || t.includes("space") || t.includes("seat"))
    return "Yes, we have availability! We have 4-seater, 3-seater, 2-seater, and 1-seater options. Kis date se chahiye aapko?";
  if (t.includes("week") || t.includes("night") || t.includes("short") || t.includes("day"))
    return "For short stays, we offer nightly rates. Aap kitne din ke liye chahiye?";
  if (t.includes("month") || t.includes("long") || t.includes("semester") || t.includes("year"))
    return "For long-term stays, we have monthly packages. Per person per month (all-inclusive):\n• 4-seater: ~18,000 PKR\n• 3-seater: ~22,000 PKR\n• 2-seater: ~24,000 PKR\n• 1-seater: ~28,000 PKR";
  if (t.includes("food") || t.includes("meal") || t.includes("khana") || t.includes("wifi") || t.includes("facility"))
    return "All our packages include: fiber WiFi per floor, 2 hygienic meals/day, CCTV + 24/7 guard, weekly laundry, and parking.";
  if (t.includes("fast") || t.includes("nust") || t.includes("nutech") || t.includes("bahria") || t.includes("university"))
    return "We're in I-11/2, Islamabad — just 5 min from FAST, NUTECH, Bahria, Air Uni, IIUI, and 10-15 min from NUST.";
  return "I can help you with rooms, prices, location, and bookings for Ibrahim Hostel Islamabad. Aap kya janna chahenge?";
}

// ─── SEND WHATSAPP ─────────────────────────────────────

async function send(to, text) {
  try {
    const r = await axios.post(WA_API, { messaging_product: "whatsapp", to, type: "text", text: { body: text } }, { headers: WA_HEADERS });
    if (r.status !== 200) console.error("WA status:", r.status, r.data);
  } catch (e) { console.error("WA err:", e?.response?.data || e.message); }
}

// ─── MAIN HANDLER ──────────────────────────────────────

async function handle(phone, text) {
  const s = getSession(phone);
  const t = text.trim();

  // First message or simple greeting
  if (!s.greeted) {
    setSession(phone, "greeted", true);
    // Only send intro for actual greetings
    if (/^(hi|hello|hey|salam|assalamualaikum|hii?|helloo?)\W*$/i.test(t)) {
      await send(phone, "Hi! I'm Beemo from Ibrahim Hostel Islamabad 🏠\n\nAap kahan study ya job karte hain? Aur approximately kitne arse ke liye accommodation chahiye?");
      return;
    }
    // Not a greeting — they asked something directly, skip intro
  }

  // Extract basic info
  const lower = t.toLowerCase();
  if (!s.name) {
    const m = t.match(/(?:i'm|my name is|call me|this is|i am|mera naam|naam|main\s+(\w+))\s+(\w+)/i);
    if (m) setSession(phone, "name", m[2]?.replace(/[^a-zA-Z\s-]/g, "").trim().substring(0, 50));
  }
  if (!s.from) {
    const m = t.match(/(?:from|se hoon|mein rehta|rehte hain)\s+(\w+(?:\s+\w+)?)/i);
    if (m) setSession(phone, "from", m[1].replace(/[^a-zA-Z0-9\s-]/g, "").trim().substring(0, 100));
  }

  // Handle intents
  const wantsPrice = /\b(price|rate|cost|how much|fee|rent|kitna|charges)\b/i.test(lower);
  const wantsBook = /\b(book|reserve|deposit|pay|hold|advance|confirm)\b/i.test(lower);
  const wantsPics = /\b(pic|photo|image|see|show|look|dekhao|dikhao)\b/i.test(lower);
  const wantsRooms = /\b(room|dorm|seater|accommodation|kamra)\b/i.test(lower);
  const wantsFac = /\b(facility|rooftop|wifi|food|meal|kitchen|security)\b/i.test(lower);
  const wantsHuman = /\b(human|agent|real person|staff|manager|yahya)\b/i.test(lower);
  const wants1Seat = /\b(1.?seater|one.?seater|single|private room)\b/i.test(lower);
  const wants2Seat = /\b(2.?seater|two.?seater)\b/i.test(lower);

  if (wants1Seat || wants2Seat) { await send(phone, "Those specific rooms are often booked and availability changes fast. Professor Yahya handles those personally — he'll guide you shortly."); return; }
  if (wantsPrice) { await send(phone, "Per person per month (all-inclusive — rent + 2 meals + WiFi + laundry):\n• 4-seater: ~18,000 PKR\n• 3-seater: ~22,000 PKR\n• 2-seater: ~24,000 PKR\n• 1-seater: ~28,000 PKR\n\nWhich room type interests you?"); return; }
  if (wantsHuman) { await send(phone, "I'll connect you with Professor Yahya 🙋 He'll reply here personally."); return; }
  if (wantsBook) { await send(phone, "Great! Could you share your name aur kis date se room chahiye? Professor Yahya will confirm."); return; }
  if (wantsRooms && wantsPics) { await send(phone, "I'd send you photos but the images aren't uploaded yet. Here are the options:\n• 4-seater: ~18,000 PKR\n• 3-seater: ~22,000 PKR\n• 2-seater: ~24,000 PKR\n• 1-seater: ~28,000 PKR\n\nWhich one interests you?"); return; }
  if (wantsFac && wantsPics) { await send(phone, "Facilities include: Rooftop terrace, coworking space, common kitchen, movie room, CCTV security, fiber WiFi, 2 meals/day. All included in the package!"); return; }

  // AI reply
  const reply = await askAI(phone, text);
  await send(phone, reply);
}

// ─── WEBHOOK ───────────────────────────────────────────

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const phone = msg.from;

    if (msg.type === "text") {
      const text = (msg.text.body || "").substring(0, 1000);
      console.log(`📩 ${phone.slice(-6)}: ${text.substring(0, 60)}`);
      await handle(phone, text);
    }

    if (msg.type === "interactive") {
      const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
      if (!reply) return res.sendStatus(200);
      console.log(`🔘 ${phone.slice(-6)}: ${reply.id}`);
      if (reply.id === "BOOK_NOW") {
        await send(phone, "Great choice! Could you share your name aur kis date se room chahiye? Professor Yahya will confirm.");
      } else if (reply.id === "SEND_ROOM_PICS") {
        await send(phone, "Room options (per person/month, all-inclusive):\n• 4-seater: ~18,000 PKR\n• 3-seater: ~22,000 PKR\n• 2-seater: ~24,000 PKR\n• 1-seater: ~28,000 PKR\n\nWant to book?");
      } else if (reply.id === "SEND_FACILITY_PICS") {
        await send(phone, "Facilities: Rooftop terrace, coworking space, kitchen, movie room, CCTV, fiber WiFi, 2 meals. All included!");
      } else if (reply.id === "BROWSE_ROOMS") {
        await send(phone, "🛏️ Room options (per person/month):\n1. 4-seater — ~18,000 PKR\n2. 3-seater — ~22,000 PKR\n3. 2-seater — ~24,000 PKR\n4. 1-seater — ~28,000 PKR");
      } else if (reply.id === "TALK_HUMAN") {
        await send(phone, "I'll connect you with Professor Yahya 🙋 He'll reply here.");
      } else {
        await handle(phone, reply.title);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook err:", e.message);
    res.sendStatus(200);
  }
});

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === (process.env.VERIFY_TOKEN || "ibrahim123"))
    return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.get("/", (req, res) => res.send("Beemo running"));

app.listen(process.env.PORT || 3000, () => console.log("Beemo online on " + (process.env.PORT || 3000)));
