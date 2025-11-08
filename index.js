// index.js
import express from "express";
import fetch from "node-fetch";
import { Low, JSONFile } from "lowdb";
import { fileURLToPath } from "url";
import path from "path";

// -------- CONFIG - put these into environment variables on Replit --------
// TELE_TOKEN = Telegram bot token (from BotFather)
// CHAT_ID   = your personal chat id (number)
// -----------------------------------------------------------------------

const TELE_TOKEN = process.env.TELE_TOKEN;
const CHAT_ID = process.env.CHAT_ID; // string or number
if (!TELE_TOKEN || !CHAT_ID) {
  console.error("Please set TELE_TOKEN and CHAT_ID in environment variables.");
  process.exit(1);
}

const TELE_BASE = `https://api.telegram.org/bot${TELE_TOKEN}`;
const app = express();
app.use(express.json()); // parse webhook JSON

// ----- lowdb setup (db.json in same folder) -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const file = path.join(__dirname, "db.json");
const adapter = new JSONFile(file);
const db = new Low(adapter);

async function initDB() {
  await db.read();
  db.data = db.data || { weekday: [], weekend: [] };
  await db.write();
}
await initDB();

// ---------- Helpers ----------
async function sendTelegram(text, parse_mode = "Markdown") {
  const url = `${TELE_BASE}/sendMessage`;
  const body = {
    chat_id: String(CHAT_ID),
    text,
    parse_mode
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.json();
  } catch (err) {
    console.error("Failed to send message:", err);
  }
}

function istDayType() {
  // returns "weekday" or "weekend" using Asia/Kolkata timezone
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "long"
  }).format(new Date());

  // weekdayName like "Monday"
  if (weekdayName === "Saturday" || weekdayName === "Sunday") return "weekend";
  return "weekday";
}

function prettyList(list) {
  if (!list || list.length === 0) return "_(empty)_";
  return list.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

// ---------- Command handling ----------
async function handleCommand(text, fromId) {
  // commands: /add <weekday|weekend> <task...>
  // /view <weekday|weekend>
  // /edit <weekday|weekend> <index> <new text>
  // /remove <weekday|weekend> <index>
  // /lists
  // /help

  const parts = text.trim().split(" ");
  const cmd = parts[0].toLowerCase();

  if (cmd === "/help") {
    return sendTelegram(
      `*Todo Bot Help*\n\n` +
        `/add <weekday|weekend> <task> - add a task\n` +
        `/view <weekday|weekend> - view tasks\n` +
        `/edit <weekday|weekend> <index> <new task> - edit\n` +
        `/remove <weekday|weekend> <index> - remove task\n` +
        `/lists - show both lists`
    );
  }

  if (cmd === "/lists") {
    await db.read();
    return sendTelegram(
      `*Weekday:*\n${prettyList(db.data.weekday)}\n\n*Weekend:*\n${prettyList(db.data.weekend)}`
    );
  }

  if (cmd === "/view") {
    const listName = parts[1];
    if (!["weekday", "weekend"].includes(listName)) {
      return sendTelegram("Usage: /view <weekday|weekend>");
    }
    await db.read();
    return sendTelegram(`*${listName}*\n${prettyList(db.data[listName])}`);
  }

  if (cmd === "/add") {
    const listName = parts[1];
    if (!["weekday", "weekend"].includes(listName)) {
      return sendTelegram("Usage: /add <weekday|weekend> <task>");
    }
    const task = parts.slice(2).join(" ").trim();
    if (!task) return sendTelegram("Please provide a task text.");
    await db.read();
    db.data[listName].push(task);
    await db.write();
    return sendTelegram(`Added to *${listName}*: ${task}`);
  }

  if (cmd === "/edit") {
    const listName = parts[1];
    const idx = Number(parts[2]);
    const newText = parts.slice(3).join(" ").trim();
    if (!["weekday", "weekend"].includes(listName) || !Number.isInteger(idx) || idx < 1 || !newText) {
      return sendTelegram("Usage: /edit <weekday|weekend> <index> <new text>");
    }
    await db.read();
    if (!db.data[listName][idx - 1]) return sendTelegram("Index out of range.");
    const old = db.data[listName][idx - 1];
    db.data[listName][idx - 1] = newText;
    await db.write();
    return sendTelegram(`Edited *${listName}* ${idx}: "${old}" → "${newText}"`);
  }

  if (cmd === "/remove") {
    const listName = parts[1];
    const idx = Number(parts[2]);
    if (!["weekday", "weekend"].includes(listName) || !Number.isInteger(idx) || idx < 1) {
      return sendTelegram("Usage: /remove <weekday|weekend> <index>");
    }
    await db.read();
    const item = db.data[listName].splice(idx - 1, 1);
    await db.write();
    if (!item.length) return sendTelegram("Index out of range.");
    return sendTelegram(`Removed from *${listName}*: ${item[0]}`);
  }

  // fallback: unrecognized command
  return sendTelegram("Unknown command. Use /help for commands.");
}

// ---------- Express routes ----------

// GET / - manual or cron trigger: send today's list
app.get("/", async (req, res) => {
  await db.read();
  const which = istDayType(); // weekday or weekend
  const list = db.data[which] || [];
  const header = `🗓️ *Good morning!* Here is your *${which}* list for today:\n\n`;
  await sendTelegram(header + prettyList(list));
  res.send("Sent today's to-do list.");
});

// POST /webhook - Telegram webhook for incoming messages
app.post("/webhook", async (req, res) => {
  try {
    const update = req.body;
    // minimal handling: only process message text
    if (update && update.message && update.message.text) {
      const text = update.message.text;
      const fromId = update.message.from.id;
      // only accept commands from the configured CHAT_ID (safety)
      if (String(fromId) !== String(CHAT_ID)) {
        // ignore other users
        return res.status(200).send("ignored");
      }
      // handle commands
      await handleCommand(text, fromId);
    }
    res.status(200).send("ok");
  } catch (err) {
    console.error("webhook error", err);
    res.status(500).send("error");
  }
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
