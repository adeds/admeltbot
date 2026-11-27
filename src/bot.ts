import { Bot, type Context } from "grammy";
import { loadConfig, type Env } from "./env";
import { escapeHtml, splitMessage } from "./format";
import { countActive, deactivate, describeRow, getActive, insertReminder, listActive, MAX_ACTIVE_PER_CHAT } from "./reminders";
import { describeRepeat, formatDateTime, parseIngatkan, parseRutin, USAGE_INGATKAN, USAGE_RUTIN } from "./time";

const HELP = `<b>Halo! Aku bot pengingat keluarga.</b>

⏰ <b>Pengingat sekali</b>
/ingatkan 20-12-2026 08:00 jemput Nenek
/ingatkan besok 07:30 bawa kue
/ingatkan hari ini 17:00 angkat jemuran

🔁 <b>Pengingat rutin</b>
/rutin harian 07:00 minum obat
/rutin jumat 19:00 pengajian
/rutin tgl25 09:00 bayar listrik

📋 /daftar lihat pengingat · /hapus 12 hapus pengingat #12

Jam pakai format 24 jam, zona waktu grup.`;

const LIMIT_REACHED = `Pengingat aktif sudah ${MAX_ACTIVE_PER_CHAT}. Hapus yang tidak perlu dulu (/daftar, /hapus).`;

export function createBot(env: Env): Bot {
  const cfg = loadConfig(env);
  const bot = new Bot(env.BOT_TOKEN);
  const isAllowed = (ctx: Context) => ctx.chat !== undefined && cfg.allowedChats.has(String(ctx.chat.id));

  // ---------- jalan di semua chat (untuk setup) ----------

  bot.command("id", (ctx) =>
    ctx.reply(`ID chat ini: <code>${ctx.chat.id}</code>\nID kamu: <code>${ctx.from?.id ?? "-"}</code>`, { parse_mode: "HTML" }),
  );

  // Bot baru dimasukkan ke grup yang belum diizinkan: beri tahu ID grupnya.
  bot.on("my_chat_member", async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    if ((status === "member" || status === "administrator") && !isAllowed(ctx)) {
      await ctx
        .reply(
          `Halo! Bot ini belum diaktifkan untuk chat ini.\nID chat: <code>${ctx.chat.id}</code>\n` +
            "Pemilik bot perlu menambahkan ID ini ke ALLOWED_CHAT_IDS.",
          { parse_mode: "HTML" },
        )
        .catch(() => {});
    }
  });

  bot.filter((ctx) => !isAllowed(ctx)).command(["start", "bantuan", "help"], (ctx) =>
    ctx.reply(`Bot ini belum diaktifkan untuk chat ini.\nID chat: <code>${ctx.chat.id}</code>`, { parse_mode: "HTML" }),
  );

  // ---------- hanya chat yang diizinkan ----------

  const allowed = bot.filter(isAllowed);

  allowed.command(["start", "bantuan", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  allowed.command("ingatkan", async (ctx) => {
    if ((await countActive(env.DB, ctx.chat.id)) >= MAX_ACTIVE_PER_CHAT) return ctx.reply(LIMIT_REACHED);

    const parsed = parseIngatkan(ctx.match, Date.now(), cfg.tzOffset);
    if (!parsed.ok) return ctx.reply(parsed.error);

    const { at, message } = parsed.value;
    const id = await insertReminder(env.DB, {
      chatId: ctx.chat.id,
      userId: ctx.from?.id,
      userName: ctx.from?.first_name,
      message,
      nextRunMs: at,
      repeat: { kind: "once" },
    });
    await ctx.reply(
      `✅ Pengingat tersimpan (#${id})\n🗓 <b>${formatDateTime(at, cfg.tzOffset, cfg.tzLabel)}</b>\n📝 ${escapeHtml(message)}`,
      { parse_mode: "HTML" },
    );
  });

  allowed.command("rutin", async (ctx) => {
    if ((await countActive(env.DB, ctx.chat.id)) >= MAX_ACTIVE_PER_CHAT) return ctx.reply(LIMIT_REACHED);

    const parsed = parseRutin(ctx.match, Date.now(), cfg.tzOffset);
    if (!parsed.ok) return ctx.reply(parsed.error);

    const { repeat, time, message, next } = parsed.value;
    const id = await insertReminder(env.DB, {
      chatId: ctx.chat.id,
      userId: ctx.from?.id,
      userName: ctx.from?.first_name,
      message,
      nextRunMs: next,
      repeat,
      time,
    });
    await ctx.reply(
      `✅ Pengingat rutin tersimpan (#${id})\n🔁 <b>${describeRepeat(repeat, time)}</b>\n` +
        `🗓 Pertama: ${formatDateTime(next, cfg.tzOffset, cfg.tzLabel)}\n📝 ${escapeHtml(message)}`,
      { parse_mode: "HTML" },
    );
  });

  allowed.command("daftar", async (ctx) => {
    const rows = await listActive(env.DB, ctx.chat.id);
    if (rows.length === 0) return ctx.reply(`Belum ada pengingat aktif.\n\n${USAGE_INGATKAN}\n\n${USAGE_RUTIN}`);
    const body = rows.map((r) => describeRow(r, cfg)).join("\n\n");
    const text = `📋 <b>Pengingat aktif (${rows.length})</b>\n\n${body}\n\nHapus: /hapus &lt;nomor&gt;`;
    for (const part of splitMessage(text)) await ctx.reply(part, { parse_mode: "HTML" });
  });

  allowed.command("hapus", async (ctx) => {
    const id = Number(ctx.match.trim().replace(/^#/, ""));
    if (!Number.isInteger(id) || id <= 0) return ctx.reply("Format: /hapus <nomor>\nLihat nomornya di /daftar.");

    const row = await getActive(env.DB, ctx.chat.id, id);
    if (!row) return ctx.reply(`Pengingat #${id} tidak ditemukan.`);

    // Di grup: hanya pembuat pengingat atau admin grup.
    if (ctx.chat.type !== "private" && row.created_by !== ctx.from?.id) {
      const member = ctx.from ? await ctx.getChatMember(ctx.from.id) : undefined;
      if (!member || (member.status !== "creator" && member.status !== "administrator")) {
        return ctx.reply("Hanya pembuat pengingat atau admin grup yang bisa menghapusnya.");
      }
    }
    await deactivate(env.DB, id);
    await ctx.reply(`🗑 Pengingat #${id} dihapus.`);
  });

  bot.catch((err) => console.error("Error bot:", err.error));
  return bot;
}
