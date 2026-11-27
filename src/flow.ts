// Alur membuat pengingat lewat tombol:
//   /ingatkan  -> pilih tanggal -> pilih jam -> balas dengan pesan
//   /rutin     -> pilih tiap hari/minggu/bulan -> (hari / tanggal) -> pilih jam -> balas dengan pesan
//
// Status alur disimpan di tabel D1 `flows` (Worker tidak menyimpan apa pun di memori).
// Teks bebas (pesan, jam yang diketik) dikirim user sebagai REPLY ke pesan bot, supaya
// bot tetap menerimanya walau privacy mode menyala.

import { GrammyError, type Api, type Composer, type Context, type InlineKeyboard } from "grammy";
import type { Config, Env } from "./env";
import { escapeHtml } from "./format";
import {
  calendarKeyboard,
  cancelKeyboard,
  dateKeyboard,
  localDateAfter,
  monthdayKeyboard,
  repeatKeyboard,
  timeKeyboard,
  weekdayKeyboard,
  CALENDAR_MONTHS_AHEAD,
} from "./keyboards";
import { countActive, insertReminder, MAX_ACTIVE_PER_CHAT, savedOnceText, savedRutinText } from "./reminders";
import {
  checkMessage,
  DAY_NAMES,
  fromLocal,
  MONTH_NAMES,
  nextRun,
  parseTime,
  toLocal,
  type HM,
  type RecurringReminder,
} from "./time";

export const FLOW_TTL_SEC = 10 * 60;

export type FlowKind = "once" | "rutin";
export type FlowStep = "date" | "time" | "typetime" | "message" | "repeat" | "weekday" | "monthday";

export interface FlowData {
  name: string;
  username?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  repeat?: "daily" | "weekly" | "monthly";
  weekday?: number;
  monthday?: number;
}

export interface Flow {
  chatId: number;
  userId: number;
  kind: FlowKind;
  step: FlowStep;
  data: FlowData;
  menuMessageId: number | null;
  promptMessageId: number | null;
}

const NOT_YOURS = "Tombol ini milik orang lain 🙂 Ketik /ingatkan atau /rutin untuk membuat pengingatmu sendiri.";
const EXPIRED = "Sesi ini sudah berakhir. Mulai lagi dengan /ingatkan atau /rutin.";
const STALE = "Pilihan ini sudah tidak berlaku.";

// ---------- penyimpanan ----------

interface FlowRow {
  chat_id: number;
  user_id: number;
  kind: FlowKind;
  step: FlowStep;
  data: string;
  menu_message_id: number | null;
  prompt_message_id: number | null;
  updated_at: number;
}

export async function loadFlow(db: D1Database, chatId: number, userId: number, nowSec: number): Promise<Flow | null> {
  const row = await db
    .prepare("SELECT * FROM flows WHERE chat_id = ? AND user_id = ? AND updated_at > ?")
    .bind(chatId, userId, nowSec - FLOW_TTL_SEC)
    .first<FlowRow>();
  if (!row) return null;
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    kind: row.kind,
    step: row.step,
    data: JSON.parse(row.data) as FlowData,
    menuMessageId: row.menu_message_id,
    promptMessageId: row.prompt_message_id,
  };
}

async function saveFlow(db: D1Database, f: Flow, nowSec: number) {
  await db
    .prepare(
      `INSERT INTO flows (chat_id, user_id, kind, step, data, menu_message_id, prompt_message_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (chat_id, user_id) DO UPDATE SET
         kind = excluded.kind, step = excluded.step, data = excluded.data,
         menu_message_id = excluded.menu_message_id, prompt_message_id = excluded.prompt_message_id,
         updated_at = excluded.updated_at`,
    )
    .bind(f.chatId, f.userId, f.kind, f.step, JSON.stringify(f.data), f.menuMessageId, f.promptMessageId, nowSec)
    .run();
}

async function deleteFlow(db: D1Database, chatId: number, userId: number) {
  await db.prepare("DELETE FROM flows WHERE chat_id = ? AND user_id = ?").bind(chatId, userId).run();
}

// ---------- teks ----------

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_NAMES[wd]}, ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function repeatSoFar(f: Flow): string {
  switch (f.data.repeat) {
    case "daily":
      return "tiap hari";
    case "weekly":
      return f.data.weekday === undefined ? "tiap minggu" : `tiap ${DAY_NAMES[f.data.weekday]}`;
    case "monthly":
      return f.data.monthday === undefined ? "tiap bulan" : `tiap tanggal ${f.data.monthday}`;
    default:
      return "";
  }
}

/** Ringkasan pilihan sejauh ini, tampil di atas tombol. */
function header(f: Flow, cfg: Config): string {
  const time = f.data.time ? ` ${f.data.time.replace(":", ".")} ${cfg.tzLabel}` : "";
  if (f.kind === "once") {
    const lines = ["⏰ <b>Pengingat baru</b>"];
    if (f.data.date) lines.push(`🗓 ${formatDate(f.data.date)}${time ? `,${time}` : ""}`);
    return lines.join("\n");
  }
  const lines = ["🔁 <b>Pengingat rutin baru</b>"];
  const rep = repeatSoFar(f);
  if (rep) lines.push(`🔁 ${rep}${time ? `,${time}` : ""}`);
  return lines.join("\n");
}

function mention(f: Flow): string {
  return `<a href="tg://user?id=${f.userId}">${escapeHtml(f.data.name || "Kamu")}</a>`;
}

// ---------- tampilan ----------

function ignoreNotModified(err: unknown) {
  if (err instanceof GrammyError && /not modified/i.test(err.description)) return;
  throw err;
}

async function showMenu(api: Api, f: Flow, cfg: Config, body: string, kb?: InlineKeyboard) {
  if (!f.menuMessageId) return;
  await api
    .editMessageText(f.chatId, f.menuMessageId, `${header(f, cfg)}\n\n${body}`, { parse_mode: "HTML", reply_markup: kb })
    .catch(ignoreNotModified);
}

async function deleteMessage(api: Api, chatId: number, messageId: number | null) {
  if (messageId) await api.deleteMessage(chatId, messageId).catch(() => {});
}

/** Kirim pesan yang harus di-reply user (force reply hanya untuk orang ini). */
async function sendPrompt(api: Api, f: Flow, html: string, placeholder: string) {
  await deleteMessage(api, f.chatId, f.promptMessageId);
  const sent = await api.sendMessage(f.chatId, html, {
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: placeholder },
  });
  f.promptMessageId = sent.message_id;
}

async function showTimeStep(api: Api, f: Flow, cfg: Config, nowMs: number) {
  f.step = "time";
  await showMenu(api, f, cfg, "Jam berapa?", timeKeyboard(f.userId, f.kind === "once" ? f.data.date! : null, nowMs, cfg.tzOffset));
}

/** Jam sudah dipilih/diketik: lanjut minta pesan. Mengembalikan pesan error kalau jamnya tidak valid. */
async function applyTime(api: Api, f: Flow, cfg: Config, time: HM, nowMs: number): Promise<string | null> {
  if (f.kind === "once") {
    const [y, m, d] = f.data.date!.split("-").map(Number);
    if (fromLocal(y, m, d, time.h, time.mi, cfg.tzOffset) <= nowMs) return "Jam itu sudah lewat. Pilih jam lain ya.";
  }
  f.data.time = `${String(time.h).padStart(2, "0")}:${String(time.mi).padStart(2, "0")}`;
  f.step = "message";
  await showMenu(api, f, cfg, "📝 Tinggal pesannya. Ketik dengan <b>membalas</b> pesan di bawah.", cancelKeyboard(f.userId));
  await sendPrompt(api, f, `${mention(f)}, pesan pengingatnya apa?\n<i>Balas pesan ini.</i>`, "mis. jemput Nenek di stasiun");
  return null;
}

// ---------- mulai alur ----------

export async function startFlow(ctx: Context, env: Env, cfg: Config, kind: FlowKind) {
  const chat = ctx.chat!;
  const from = ctx.from!;
  if ((await countActive(env.DB, chat.id)) >= MAX_ACTIVE_PER_CHAT) {
    return ctx.reply(`Pengingat aktif sudah ${MAX_ACTIVE_PER_CHAT}. Hapus yang tidak perlu dulu (/daftar).`);
  }
  const nowSec = Math.floor(Date.now() / 1000);

  // Alur lama orang ini (kalau ada) dibatalkan.
  const old = await loadFlow(env.DB, chat.id, from.id, nowSec);
  if (old) {
    await ctx.api.editMessageText(chat.id, old.menuMessageId!, "❌ Dibatalkan (diganti yang baru).").catch(() => {});
    await deleteMessage(ctx.api, chat.id, old.promptMessageId);
  }

  const f: Flow = {
    chatId: chat.id,
    userId: from.id,
    kind,
    step: kind === "once" ? "date" : "repeat",
    data: { name: from.first_name, username: from.username },
    menuMessageId: null,
    promptMessageId: null,
  };
  const body = kind === "once" ? "Kapan?" : "Seberapa sering?";
  const kb = kind === "once" ? dateKeyboard(from.id) : repeatKeyboard(from.id);
  const sent = await ctx.reply(`${header(f, cfg)}\n\n${body}`, {
    parse_mode: "HTML",
    reply_markup: kb,
    reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id, allow_sending_without_reply: true } : undefined,
  });
  f.menuMessageId = sent.message_id;
  await saveFlow(env.DB, f, nowSec);
}

// ---------- handler tombol & balasan ----------

export function registerFlow(allowed: Composer<Context>, env: Env, cfg: Config) {
  allowed.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

  allowed.callbackQuery(/^f:(\d+):([a-z]+):(.*)$/, async (ctx) => {
    const uid = Number(ctx.match[1]);
    const op = ctx.match[2];
    const val = ctx.match[3];
    if (ctx.from.id !== uid) return ctx.answerCallbackQuery({ text: NOT_YOURS, show_alert: true });

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const f = await loadFlow(env.DB, ctx.chat!.id, uid, nowSec);
    if (!f || f.menuMessageId !== ctx.callbackQuery.message?.message_id) {
      await ctx.answerCallbackQuery({ text: EXPIRED, show_alert: true });
      await ctx.editMessageReplyMarkup().catch(() => {});
      return;
    }

    const error = await handleOp(ctx.api, f, cfg, op, val, nowMs);
    if (error === "cancelled") {
      await deleteFlow(env.DB, f.chatId, f.userId);
      return ctx.answerCallbackQuery({ text: "Dibatalkan" });
    }
    if (error) return ctx.answerCallbackQuery({ text: error, show_alert: true });
    await saveFlow(env.DB, f, nowSec);
    await ctx.answerCallbackQuery();
  });

  // Balasan teks untuk langkah "ketik jam" dan "pesan".
  allowed.on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const f = await loadFlow(env.DB, ctx.chat.id, ctx.from.id, nowSec);
    if (!f || (f.step !== "message" && f.step !== "typetime")) return next();
    const repliedTo = ctx.message.reply_to_message?.message_id;
    if (ctx.chat.type !== "private" && repliedTo !== f.promptMessageId) return next();

    if (f.step === "typetime") {
      const time = parseTime(text);
      const error = time ? await applyTime(ctx.api, f, cfg, time, nowMs) : "Format jam belum benar. Contoh: 08:30 atau 19.00.";
      if (error) await sendPrompt(ctx.api, f, `${escapeHtml(error)}\n${mention(f)}, jam berapa?\n<i>Balas pesan ini.</i>`, "mis. 08:30");
      await saveFlow(env.DB, f, nowSec);
      return;
    }

    // step === "message"
    const msgError = checkMessage(text);
    if (msgError) {
      await sendPrompt(ctx.api, f, `${escapeHtml(msgError)}\n${mention(f)}, pesan pengingatnya apa?\n<i>Balas pesan ini.</i>`, "mis. jemput Nenek");
      await saveFlow(env.DB, f, nowSec);
      return;
    }
    await finish(ctx, env, cfg, f, text, nowMs);
  });
}

async function handleOp(api: Api, f: Flow, cfg: Config, op: string, val: string, nowMs: number): Promise<string | null> {
  const is = (kind: FlowKind, step: FlowStep) => f.kind === kind && f.step === step;

  switch (op) {
    case "x":
      await showMenu(api, f, cfg, "❌ Dibatalkan.");
      await deleteMessage(api, f.chatId, f.promptMessageId);
      return "cancelled";

    case "date": {
      if (!is("once", "date")) return STALE;
      const offset = Number(val);
      if (![0, 1, 2].includes(offset)) return STALE;
      f.data.date = localDateAfter(nowMs, offset, cfg.tzOffset);
      await showTimeStep(api, f, cfg, nowMs);
      return null;
    }

    case "cal": {
      if (!is("once", "date")) return STALE;
      const today = toLocal(nowMs, cfg.tzOffset);
      let y = today.y;
      let m = today.m;
      if (/^\d{6}$/.test(val)) {
        y = Number(val.slice(0, 4));
        m = Number(val.slice(4));
      }
      const offsetMonths = (y - today.y) * 12 + (m - today.m);
      if (m < 1 || m > 12 || offsetMonths < 0 || offsetMonths > CALENDAR_MONTHS_AHEAD) return STALE;
      await showMenu(api, f, cfg, "Pilih tanggal:", calendarKeyboard(f.userId, y, m, nowMs, cfg.tzOffset));
      return null;
    }

    case "back":
      if (!is("once", "date")) return STALE;
      await showMenu(api, f, cfg, "Kapan?", dateKeyboard(f.userId));
      return null;

    case "day": {
      if (!is("once", "date") || !/^\d{8}$/.test(val)) return STALE;
      const date = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6)}`;
      if (date < localDateAfter(nowMs, 0, cfg.tzOffset)) return "Tanggal itu sudah lewat.";
      f.data.date = date;
      await showTimeStep(api, f, cfg, nowMs);
      return null;
    }

    case "time": {
      if (f.step !== "time" || !/^\d{4}$/.test(val)) return STALE;
      const time = parseTime(`${val.slice(0, 2)}:${val.slice(2)}`);
      if (!time) return STALE;
      return applyTime(api, f, cfg, time, nowMs);
    }

    case "ttype":
      if (f.step !== "time") return STALE;
      f.step = "typetime";
      await showMenu(api, f, cfg, "⌨️ Ketik jamnya dengan <b>membalas</b> pesan di bawah.", cancelKeyboard(f.userId));
      await sendPrompt(api, f, `${mention(f)}, jam berapa? Contoh: 08:30 atau 19.00\n<i>Balas pesan ini.</i>`, "mis. 08:30");
      return null;

    case "rep":
      if (!is("rutin", "repeat")) return STALE;
      if (val === "daily") {
        f.data.repeat = "daily";
        await showTimeStep(api, f, cfg, nowMs);
      } else if (val === "weekly") {
        f.data.repeat = "weekly";
        f.step = "weekday";
        await showMenu(api, f, cfg, "Hari apa?", weekdayKeyboard(f.userId));
      } else if (val === "monthly") {
        f.data.repeat = "monthly";
        f.step = "monthday";
        await showMenu(
          api,
          f,
          cfg,
          "Tanggal berapa?\n<i>Kalau bulannya tidak punya tanggal itu (mis. 31), dipakai hari terakhir bulan.</i>",
          monthdayKeyboard(f.userId),
        );
      } else return STALE;
      return null;

    case "wd": {
      const wd = Number(val);
      if (!is("rutin", "weekday") || !Number.isInteger(wd) || wd < 0 || wd > 6) return STALE;
      f.data.weekday = wd;
      await showTimeStep(api, f, cfg, nowMs);
      return null;
    }

    case "md": {
      const md = Number(val);
      if (!is("rutin", "monthday") || !Number.isInteger(md) || md < 1 || md > 31) return STALE;
      f.data.monthday = md;
      await showTimeStep(api, f, cfg, nowMs);
      return null;
    }

    default:
      return STALE;
  }
}

/** Simpan pengingat, bersihkan pesan-pesan alur, kirim konfirmasi. */
async function finish(ctx: Context, env: Env, cfg: Config, f: Flow, message: string, nowMs: number) {
  const [h, mi] = f.data.time!.split(":").map(Number);
  const time: HM = { h, mi };
  const replyTo = { message_id: ctx.msg!.message_id, allow_sending_without_reply: true };
  let text: string;

  if (f.kind === "once") {
    const [y, m, d] = f.data.date!.split("-").map(Number);
    const at = fromLocal(y, m, d, h, mi, cfg.tzOffset);
    if (at <= nowMs) {
      await deleteFlow(env.DB, f.chatId, f.userId);
      await showMenu(ctx.api, f, cfg, "⌛ Waktunya sudah lewat saat pesan diketik. Ulangi dengan /ingatkan.");
      return;
    }
    const id = await insertReminder(env.DB, {
      chatId: f.chatId,
      userId: f.userId,
      userName: f.data.name,
      userUsername: f.data.username,
      message,
      nextRunMs: at,
      repeat: { kind: "once" },
    });
    text = savedOnceText(id, at, message, cfg);
  } else {
    const repeat: RecurringReminder["repeat"] =
      f.data.repeat === "weekly"
        ? { kind: "weekly", weekday: f.data.weekday! }
        : f.data.repeat === "monthly"
          ? { kind: "monthly", day: f.data.monthday! }
          : { kind: "daily" };
    const next = nextRun(repeat, time, nowMs, cfg.tzOffset);
    const id = await insertReminder(env.DB, {
      chatId: f.chatId,
      userId: f.userId,
      userName: f.data.name,
      userUsername: f.data.username,
      message,
      nextRunMs: next,
      repeat,
      time,
    });
    text = savedRutinText(id, repeat, time, next, message, cfg);
  }

  await deleteFlow(env.DB, f.chatId, f.userId);
  // Pesan tombol & pertanyaan tidak diperlukan lagi: hapus supaya grup tetap rapi.
  await deleteMessage(ctx.api, f.chatId, f.menuMessageId);
  await deleteMessage(ctx.api, f.chatId, f.promptMessageId);
  await ctx.reply(text, { parse_mode: "HTML", reply_parameters: replyTo });
}
