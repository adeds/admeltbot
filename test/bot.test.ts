// Tes ujung-ke-ujung handler bot: Telegram dipalsukan, D1 diganti SQLite bawaan Node.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBot } from "../src/bot";
import type { Env } from "../src/env";
import { runDueReminders } from "../src/reminders";
import { fromLocal } from "../src/time";

const GROUP = -1001234;
const OTHER_GROUP = -1009999;
const BOT_ID = 999;

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
function fakeD1() {
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

// ---------- helper ----------
let msgId = 100;
function textUpdate(text: string, opts: { chatId?: number; userId?: number; replyTo?: Record<string, unknown> } = {}) {
  const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0].length }] : [];
  return {
    update_id: msgId,
    message: {
      message_id: msgId++,
      date: Math.floor(Date.now() / 1000),
      chat: { id: opts.chatId ?? GROUP, type: "supergroup", title: "Keluarga" },
      from: { id: opts.userId ?? 1, is_bot: false, first_name: opts.userId === 2 ? "Siti" : "Budi" },
      text,
      entities,
      ...(opts.replyTo ? { reply_to_message: opts.replyTo } : {}),
    },
  };
}

function setup() {
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

  const sent: { method: string; payload: any }[] = [];
  let memberStatus = "member";
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    if (method === "getChatMember") return { ok: true, result: { status: memberStatus, user: { id: 1 } } } as never;
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: GROUP, type: "supergroup" } } } as never;
  });

  const texts = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.payload.text as string);
  return { env, db, bot, sent, texts, setMember: (s: string) => (memberStatus = s) };
}

// Sekarang: Jumat 27 Nov 2026 10.00 WIB
const NOW = fromLocal(2026, 11, 27, 10, 0, 420);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("whitelist", () => {
  it("grup lain diabaikan, kecuali /id dan /start", async () => {
    const { bot, texts } = setup();
    await bot.handleUpdate(textUpdate("/ingatkan besok 08:00 x", { chatId: OTHER_GROUP }) as never);
    await bot.handleUpdate(textUpdate("@keluarga_bot halo", { chatId: OTHER_GROUP }) as never);
    expect(texts()).toHaveLength(0);

    await bot.handleUpdate(textUpdate("/id", { chatId: OTHER_GROUP }) as never);
    await bot.handleUpdate(textUpdate("/start", { chatId: OTHER_GROUP }) as never);
    expect(texts()[0]).toContain(String(OTHER_GROUP));
    expect(texts()[1]).toContain("belum diaktifkan");
  });
});

describe("pengingat", () => {
  it("/ingatkan -> /daftar -> cron kirim -> nonaktif", async () => {
    const { bot, env, texts, db } = setup();
    await bot.handleUpdate(textUpdate("/ingatkan besok 08:00 jemput <Nenek>") as never);
    expect(texts()[0]).toContain("Pengingat tersimpan (#1)");
    expect(texts()[0]).toContain("Sabtu, 28 Nov 2026, 08.00 WIB");
    expect(texts()[0]).toContain("&lt;Nenek&gt;"); // HTML di-escape

    await bot.handleUpdate(textUpdate("/daftar") as never);
    expect(texts()[1]).toContain("#1");

    // Belum waktunya
    await runDueReminders(env, bot.api);
    expect(texts()).toHaveLength(2);

    vi.setSystemTime(fromLocal(2026, 11, 28, 8, 0, 420) + 5000);
    await runDueReminders(env, bot.api);
    expect(texts()[2]).toContain("⏰ <b>Pengingat</b>");
    expect(texts()[2]).toContain("jemput &lt;Nenek&gt;");
    expect(texts()[2]).toContain("dari Budi");

    // Tidak terkirim dua kali
    await runDueReminders(env, bot.api);
    expect(texts()).toHaveLength(3);
    expect(db.raw.prepare("SELECT active FROM reminders WHERE id = 1").get()).toEqual({ active: 0 });
  });

  it("/rutin dijadwalkan ulang setelah terkirim", async () => {
    const { bot, env, texts, db } = setup();
    await bot.handleUpdate(textUpdate("/rutin harian 07:00 minum obat") as never);
    expect(texts()[0]).toContain("tiap hari 07.00");
    expect(texts()[0]).toContain("Sabtu, 28 Nov 2026, 07.00 WIB");

    vi.setSystemTime(fromLocal(2026, 11, 28, 7, 0, 420));
    await runDueReminders(env, bot.api);
    expect(texts()[1]).toContain("minum obat");
    const row = db.raw.prepare("SELECT next_run, active FROM reminders WHERE id = 1").get() as { next_run: number; active: number };
    expect(row.active).toBe(1);
    expect(row.next_run * 1000).toBe(fromLocal(2026, 11, 29, 7, 0, 420));
  });

  it("format salah dibalas petunjuk", async () => {
    const { bot, texts } = setup();
    await bot.handleUpdate(textUpdate("/ingatkan kapan-kapan 08:00 x") as never);
    expect(texts()[0]).toContain("tidak dikenali");
    await bot.handleUpdate(textUpdate("/ingatkan@keluarga_bot besok 08:00 x") as never);
    expect(texts()[1]).toContain("Pengingat tersimpan");
  });

  it("/hapus: orang lain ditolak, pembuat/admin boleh", async () => {
    const { bot, texts, setMember } = setup();
    await bot.handleUpdate(textUpdate("/ingatkan besok 08:00 x", { userId: 1 }) as never);
    await bot.handleUpdate(textUpdate("/hapus 1", { userId: 2 }) as never);
    expect(texts()[1]).toContain("Hanya pembuat");

    setMember("administrator");
    await bot.handleUpdate(textUpdate("/hapus 1", { userId: 2 }) as never);
    expect(texts()[2]).toContain("dihapus");

    await bot.handleUpdate(textUpdate("/hapus 1", { userId: 1 }) as never);
    expect(texts()[3]).toContain("tidak ditemukan");
  });
});

describe("tanpa AI", () => {
  it("pesan biasa dan mention tidak dibalas", async () => {
    const { bot, texts } = setup();
    await bot.handleUpdate(textUpdate("selamat pagi semua") as never);
    await bot.handleUpdate(textUpdate("@keluarga_bot halo") as never);
    await bot.handleUpdate(textUpdate("/tanya halo") as never);
    expect(texts()).toHaveLength(0);
  });

  it("/bantuan hanya berisi fitur pengingat", async () => {
    const { bot, texts } = setup();
    await bot.handleUpdate(textUpdate("/bantuan") as never);
    expect(texts()[0]).toContain("/ingatkan");
    expect(texts()[0]).toContain("/rutin");
    expect(texts()[0]).not.toContain("AI");
  });
});
