// Alat bantu tes: Telegram dipalsukan, D1 diganti SQLite bawaan Node.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createBot } from "../src/bot";
import type { Env } from "../src/env";
import { fromLocal } from "../src/time";

export const GROUP = -1001234;
export const OTHER_GROUP = -1009999;
export const BOT_ID = 999;

/** Sekarang: Jumat 27 Nov 2026 10.00 WIB */
export const NOW = fromLocal(2026, 11, 27, 10, 0, 420);

const NAMES: Record<number, string> = { 1: "Budi", 2: "Siti", 3: "Andi" };
const USERNAMES: Record<number, string> = { 1: "budi_k" }; // Siti & Andi tidak punya username

// ---------- D1 palsu ----------
class FakeStmt {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new FakeStmt(this.db, this.sql, params);
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) };
  }
  async first() {
    return this.db.prepare(this.sql).get(...(this.params as never[])) ?? null;
  }
  async run() {
    this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true };
  }
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    raw: db,
    prepare: (sql: string) => new FakeStmt(db, sql),
    batch: async (stmts: FakeStmt[]) => {
      for (const s of stmts) await s.run();
      return [];
    },
  };
}

// ---------- update Telegram palsu ----------
let nextId = 100;

export function textUpdate(
  text: string,
  opts: { chatId?: number; userId?: number; replyTo?: Record<string, unknown> | number } = {},
) {
  const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0].length }] : [];
  const userId = opts.userId ?? 1;
  const replyTo =
    typeof opts.replyTo === "number"
      ? { message_id: opts.replyTo, date: 0, chat: { id: opts.chatId ?? GROUP, type: "supergroup" }, from: { id: BOT_ID, is_bot: true, first_name: "Bot" }, text: "?" }
      : opts.replyTo;
  const id = nextId++;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: opts.chatId ?? GROUP, type: "supergroup", title: "Keluarga" },
      from: { id: userId, is_bot: false, first_name: NAMES[userId] ?? "Orang", username: USERNAMES[userId] },
      text,
      entities,
      ...(replyTo ? { reply_to_message: replyTo } : {}),
    },
  } as never;
}

export function callbackUpdate(data: string, messageId: number, opts: { userId?: number; chatId?: number } = {}) {
  const userId = opts.userId ?? 1;
  const id = nextId++;
  return {
    update_id: id,
    callback_query: {
      id: `cb${id}`,
      from: { id: userId, is_bot: false, first_name: NAMES[userId] ?? "Orang", username: USERNAMES[userId] },
      chat_instance: "ci",
      data,
      message: {
        message_id: messageId,
        date: 0,
        chat: { id: opts.chatId ?? GROUP, type: "supergroup", title: "Keluarga" },
        from: { id: BOT_ID, is_bot: true, first_name: "Bot" },
        text: "menu",
      },
    },
  } as never;
}

// ---------- bot dengan API palsu ----------
export function setup() {
  const db = fakeD1();
  const env = {
    DB: db as unknown as D1Database,
    BOT_TOKEN: "test",
    WEBHOOK_SECRET: "s",
    ALLOWED_CHAT_IDS: `${GROUP}`,
    TZ_OFFSET_MINUTES: "420",
    TZ_LABEL: "WIB",
  } satisfies Env;

  const bot = createBot(env);
  bot.botInfo = {
    id: BOT_ID,
    is_bot: true,
    first_name: "Bot Keluarga",
    username: "keluarga_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as never;

  const sent: { method: string; payload: any; result?: any }[] = [];
  let memberStatus = "member";
  let botMsgId = 5000;
  bot.api.config.use(async (_prev, method, payload: any) => {
    let result: any = true;
    if (method === "getChatMember") result = { status: memberStatus, user: { id: payload.user_id } };
    if (method === "sendMessage") result = { message_id: botMsgId++, date: 0, chat: { id: payload.chat_id, type: "supergroup" }, text: payload.text };
    if (method === "editMessageText") result = { message_id: payload.message_id, date: 0, chat: { id: payload.chat_id, type: "supergroup" }, text: payload.text };
    sent.push({ method, payload, result });
    return { ok: true, result } as never;
  });

  const calls = (method: string) => sent.filter((s) => s.method === method);
  const texts = () => calls("sendMessage").map((s) => s.payload.text as string);
  const last = (method: string) => calls(method).at(-1);
  /** Semua label tombol di reply_markup sebuah panggilan. */
  const buttons = (call: { payload: any } | undefined): { text: string; callback_data: string }[] =>
    (call?.payload?.reply_markup?.inline_keyboard ?? []).flat();

  return { env, db, bot, sent, calls, texts, last, buttons, setMember: (s: string) => (memberStatus = s) };
}
