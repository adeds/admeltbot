// Pasang webhook Telegram + menu command. Jalankan sekali setelah deploy:
//   npm run setup
// Membaca BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL dari file .dev.vars.

import { readFileSync } from "node:fs";

function readDevVars() {
  let text;
  try {
    text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  } catch {
    console.error("File .dev.vars tidak ditemukan. Salin .dev.vars.example jadi .dev.vars lalu isi.");
    process.exit(1);
  }
  const vars = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

const { BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL } = readDevVars();
for (const [k, v] of Object.entries({ BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL })) {
  if (!v) {
    console.error(`${k} kosong di .dev.vars`);
    process.exit(1);
  }
}

// Menu yang muncul saat orang mengetik "/" di grup.
const commands = [
  { command: "ingatkan", description: "Pengingat sekali: /ingatkan 20-12 08:00 pesan" },
  { command: "rutin", description: "Pengingat rutin: /rutin harian 07:00 pesan" },
  { command: "daftar", description: "Lihat semua pengingat aktif" },
  { command: "hapus", description: "Hapus pengingat: /hapus 12" },
];

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

const webhookUrl = `${WORKER_URL.replace(/\/+$/, "")}/webhook`;
await call("setWebhook", {
  url: webhookUrl,
  secret_token: WEBHOOK_SECRET,
  allowed_updates: ["message", "my_chat_member"],
  drop_pending_updates: true,
});
console.log(`✅ Webhook terpasang: ${webhookUrl}`);

await call("setMyCommands", { commands });
console.log("✅ Menu command terpasang");

const me = await call("getMe", {});
console.log(`🤖 Bot: @${me.username}`);
