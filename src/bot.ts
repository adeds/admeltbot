import { Bot, GrammyError, type Context } from "grammy";
import { loadConfig, type Config, type Env } from "./env";
import { registerFlow, startFlow } from "./flow";
import { splitMessage } from "./format";
import { listKeyboard } from "./keyboards";
import {
  countActive,
  deactivate,
  getActive,
  insertReminder,
  listActive,
  listText,
  MAX_ACTIVE_PER_CHAT,
  savedOnceText,
  savedRutinText,
  type ReminderRow,
} from "./reminders";
import { parseIngatkan, parseRutin } from "./time";

const HELP = `<b>Halo! Aku bot pengingat keluarga.</b>

👆 <b>Cara paling mudah: pakai tombol</b>
Ketik /ingatkan atau /rutin saja, lalu pilih tanggal dan jam lewat tombol.

⌨️ <b>Atau ketik langsung</b>
/ingatkan 20-12-2026 08:00 jemput Nenek
/ingatkan besok 07:30 bawa kue
/rutin harian 07:00 minum obat
/rutin jumat 19:00 pengajian
/rutin tgl25 09:00 bayar listrik

📋 /daftar lihat & hapus pengingat

Jam pakai format 24 jam, zona waktu grup.`;

const LIMIT_REACHED = `Pengingat aktif sudah ${MAX_ACTIVE_PER_CHAT}. Hapus yang tidak perlu dulu (/daftar).`;

async function isAdmin(ctx: Context, userId: number): Promise<boolean> {
  const member = await ctx.getChatMember(userId).catch(() => undefined);
  return member?.status === "creator" || member?.status === "administrator";
}

/** Boleh hapus: di chat pribadi selalu; di grup hanya pembuat pengingat atau admin grup. */
async function canDelete(ctx: Context, row: ReminderRow): Promise<boolean> {
  if (ctx.chat?.type === "private") return true;
  if (!ctx.from) return false;
  return row.created_by === ctx.from.id || isAdmin(ctx, ctx.from.id);
}

/** Kirim isi /daftar dengan tombol hapus (tombol ditempel di pesan terakhir). */
async function sendList(ctx: Context, env: Env, cfg: Config) {
  const rows = await listActive(env.DB, ctx.chat!.id);
  if (rows.length === 0) return ctx.reply("Belum ada pengingat aktif.\nKetik /ingatkan atau /rutin untuk membuat.");
  const parts = splitMessage(listText(rows, cfg));
  for (const [i, part] of parts.entries()) {
    await ctx.reply(part, { parse_mode: "HTML", reply_markup: i === parts.length - 1 ? listKeyboard(rows) : undefined });
  }
}

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
    if (!ctx.match.trim()) return startFlow(ctx, env, cfg, "once"); // tanpa isi -> pakai tombol
    if ((await countActive(env.DB, ctx.chat.id)) >= MAX_ACTIVE_PER_CHAT) return ctx.reply(LIMIT_REACHED);

    const parsed = parseIngatkan(ctx.match, Date.now(), cfg.tzOffset);
    if (!parsed.ok) return ctx.reply(`${parsed.error}\n\nAtau ketik /ingatkan saja untuk memilih lewat tombol.`);

    const { at, message } = parsed.value;
    const id = await insertReminder(env.DB, {
      chatId: ctx.chat.id,
      userId: ctx.from?.id,
      userName: ctx.from?.first_name,
      userUsername: ctx.from?.username,
      message,
      nextRunMs: at,
      repeat: { kind: "once" },
    });
    await ctx.reply(savedOnceText(id, at, message, cfg), { parse_mode: "HTML" });
  });

  allowed.command("rutin", async (ctx) => {
    if (!ctx.match.trim()) return startFlow(ctx, env, cfg, "rutin"); // tanpa isi -> pakai tombol
    if ((await countActive(env.DB, ctx.chat.id)) >= MAX_ACTIVE_PER_CHAT) return ctx.reply(LIMIT_REACHED);

    const parsed = parseRutin(ctx.match, Date.now(), cfg.tzOffset);
    if (!parsed.ok) return ctx.reply(`${parsed.error}\n\nAtau ketik /rutin saja untuk memilih lewat tombol.`);

    const { repeat, time, message, next } = parsed.value;
    const id = await insertReminder(env.DB, {
      chatId: ctx.chat.id,
      userId: ctx.from?.id,
      userName: ctx.from?.first_name,
      userUsername: ctx.from?.username,
      message,
      nextRunMs: next,
      repeat,
      time,
    });
    await ctx.reply(savedRutinText(id, repeat, time, next, message, cfg), { parse_mode: "HTML" });
  });

  allowed.command("daftar", (ctx) => sendList(ctx, env, cfg));

  // Tidak ada di menu (hapus lewat tombol 🗑 di /daftar), tapi tetap jalan kalau diketik.
  allowed.command("hapus", async (ctx) => {
    const id = Number(ctx.match.trim().replace(/^#/, ""));
    if (!Number.isInteger(id) || id <= 0) return sendList(ctx, env, cfg); // tanpa nomor -> tampilkan daftar bertombol

    const row = await getActive(env.DB, ctx.chat.id, id);
    if (!row) return ctx.reply(`Pengingat #${id} tidak ditemukan.`);
    if (!(await canDelete(ctx, row))) return ctx.reply("Hanya pembuat pengingat atau admin grup yang bisa menghapusnya.");

    await deactivate(env.DB, id);
    await ctx.reply(`🗑 Pengingat #${id} dihapus.`);
  });

  // Tombol 🗑 di /daftar.
  allowed.callbackQuery(/^del:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const chatId = ctx.chat!.id;
    const row = await getActive(env.DB, chatId, id);
    if (row && !(await canDelete(ctx, row))) {
      return ctx.answerCallbackQuery({ text: "Hanya pembuat pengingat atau admin grup yang bisa menghapusnya.", show_alert: true });
    }
    if (row) await deactivate(env.DB, id);
    await ctx.answerCallbackQuery({ text: row ? `🗑 Pengingat #${id} dihapus` : `Pengingat #${id} sudah tidak ada` });

    // Perbarui daftar di pesan yang sama.
    const rows = await listActive(env.DB, chatId);
    const parts = rows.length ? splitMessage(listText(rows, cfg)) : [];
    const edit =
      parts.length === 0
        ? ctx.editMessageText("Belum ada pengingat aktif.\nKetik /ingatkan atau /rutin untuk membuat.")
        : parts.length === 1
          ? ctx.editMessageText(parts[0], { parse_mode: "HTML", reply_markup: listKeyboard(rows) })
          : ctx.editMessageReplyMarkup({ reply_markup: listKeyboard(rows) });
    await edit.catch((err) => {
      if (!(err instanceof GrammyError && /not modified/i.test(err.description))) throw err;
    });
  });

  // Alur tombol /ingatkan & /rutin (callback + balasan teks).
  registerFlow(allowed, env, cfg);

  // Tombol dari chat yang tidak diizinkan / tombol lain: hentikan loading di HP.
  bot.on("callback_query", (ctx) => ctx.answerCallbackQuery().catch(() => {}));

  bot.catch((err) => console.error("Error bot:", err.error));
  return bot;
}
