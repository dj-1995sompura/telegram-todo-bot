// ========================
// Telegram To-Do Bot (Cloud + Auto Reminder)
// ========================

import express from "express";
import fetch from "node-fetch";
import cron from "node-cron";

const app = express();
app.use(express.json());

// ----- Environment Variables -----
const TELE_TOKEN = process.env.TELE_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const JSONBIN_URL = process.env.JSONBIN_URL;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

if (!TELE_TOKEN || !CHAT_ID || !JSONBIN_URL || !JSONBIN_KEY) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

const TELE_BASE = `https://api.telegram.org/bot${TELE_TOKEN}`;

// ========================
// JSONBin Cloud Storage Helpers (fixed)
// ========================
async function getData() {
  try {
    const res = await fetch(`${JSONBIN_URL}/latest`, {
      headers: { "X-Master-Key": JSONBIN_KEY }
    });
    const json = await res.json();
    return json.record || { weekday: [], weekend: [] };
  } catch (err) {
    console.error("❌ Failed to fetch data:", err);
    return { weekday: [], weekend: [] };
  }
}

async function saveData(data) {
  try {
    const res = await fetch(JSONBIN_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY,
        "X-Bin-Versioning": "false"   // 🧠 prevent stale versions
      },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("❌ JSONBin save failed:", errText);
    } else {
      console.log("✅ Data saved to JSONBin.");
    }
  } catch (err) {
    console.error("❌ Failed to save data:", err);
  }
}

// ========================
// Telegram Utility
// ========================
async function sendTelegram(text, parse_mode = "Markdown") {
  const body = {
    chat_id: CHAT_ID,
    text,
    parse_mode
  };
  try {
    await fetch(`${TELE_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error("❌ Telegram send error:", err);
  }
}

// ========================
// Core Helpers
// ========================
function formatList(list) {
  if (!list || list.length === 0) return "_(empty)_";
  return list.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

function getListTypeByDay() {
  const day = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: "long" });
  return day === "Saturday" || day === "Sunday" ? "weekend" : "weekday";
}

// ========================
// Command Handler
// ========================
async function handleCommand(text, fromId) {
  if (String(fromId) !== String(CHAT_ID)) return; // safety check
  const parts = text.trim().split(" ");
  const cmd = parts[0].toLowerCase();

  const db = await getData();

  switch (cmd) {
    case "/help":
      return sendTelegram(
        `*To-Do Bot Commands*\n\n` +
        `/add <weekday|weekend> <task>\n` +
        `/view <weekday|weekend>\n` +
        `/edit <weekday|weekend> <index> <new task>\n` +
        `/remove <weekday|weekend> <index>\n` +
        `/lists — view both lists\n`
      );

    case "/lists":
      return sendTelegram(
        `*Weekday:*\n${formatList(db.weekday)}\n\n*Weekend:*\n${formatList(db.weekend)}`
      );

    case "/view": {
      const list = parts[1];
      if (!["weekday", "weekend"].includes(list))
        return sendTelegram("Usage: /view <weekday|weekend>");
      return sendTelegram(`*${list}*\n${formatList(db[list])}`);
    }

    case "/add": {
      const list = parts[1];
      const task = parts.slice(2).join(" ").trim();
      if (!["weekday", "weekend"].includes(list) || !task)
        return sendTelegram("Usage: /add <weekday|weekend> <task>");
      db[list].push(task);
      await saveData(db);
      return sendTelegram(`✅ Added to *${list}*: ${task}`);
    }

    case "/edit": {
      const list = parts[1];
      const idx = Number(parts[2]);
      const newText = parts.slice(3).join(" ").trim();
      if (!["weekday", "weekend"].includes(list) || !idx || !newText)
        return sendTelegram("Usage: /edit <weekday|weekend> <index> <new text>");
      if (!db[list][idx - 1]) return sendTelegram("❌ Index out of range.");
      const old = db[list][idx - 1];
      db[list][idx - 1] = newText;
      await saveData(db);
      return sendTelegram(`✏️ Edited *${list}* ${idx}: "${old}" → "${newText}"`);
    }

    case "/remove": {
      const list = parts[1];
      const idx = Number(parts[2]);
      if (!["weekday", "weekend"].includes(list) || !idx)
        return sendTelegram("Usage: /remove <weekday|weekend> <index>");
      const item = db[list].splice(idx - 1, 1);
      await saveData(db);
      return item.length
        ? sendTelegram(`🗑️ Removed from *${list}*: ${item[0]}`)
        : sendTelegram("❌ Index out of range.");
    }

    default:
      return sendTelegram("Unknown command. Use /help for usage.");
  }
}

// ========================
// Express Routes
// ========================
app.get("/", async (req, res) => {
  const db = await getData();
  const listType = getListTypeByDay();
  const list = db[listType];
  const msg = list.length
    ? `🗓️ Good morning, Digi!\nYour *${listType}* tasks:\n\n${formatList(list)}`
    : `✅ You have no *${listType}* tasks today!`;
  await sendTelegram(msg);
  res.send("✅ Daily list sent to Telegram.");
});

app.post("/webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("Incoming update:", JSON.stringify(update, null, 2));
    if (update?.message?.text) {
      await handleCommand(update.message.text, update.message.from.id);
    }
    res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("error");
  }
});

// ========================
// Internal Cron (10 AM IST)
// ========================
cron.schedule(
  "0 10 * * *",
  async () => {
    console.log("⏰ Running daily 10 AM reminder...");
    const db = await getData();
    const listType = getListTypeByDay();
    const list = db[listType];
    const msg = list.length
      ? `🗓️ Good morning, Digi!\nYour *${listType}* tasks:\n\n${formatList(list)}`
      : `✅ No *${listType}* tasks today! Enjoy your day ☀️`;
    await sendTelegram(msg);
  },
  { timezone: "Asia/Kolkata" }
);

// ========================
// Start Server
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
