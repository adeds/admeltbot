import type { Bot } from "grammy";
import { createBot } from "./bot";
import type { Env } from "./env";
import { runDueReminders } from "./reminders";

/** Bandingkan secret tanpa bocor lewat waktu respons (timing-safe). */
function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

// Satu instance bot per isolate Worker (getMe cukup dipanggil sekali).
let cached: { token: string; bot: Bot; ready: Promise<void> } | undefined;

function getBot(env: Env) {
  if (!cached || cached.token !== env.BOT_TOKEN) {
    const bot = createBot(env);
    cached = { token: env.BOT_TOKEN, bot, ready: bot.init() };
  }
  return cached;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/webhook") {
      // Pastikan request benar dari Telegram (secret_token saat setWebhook).
      if (!secretMatches(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.WEBHOOK_SECRET)) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      const { bot, ready } = getBot(env);
      try {
        await ready;
      } catch (err) {
        cached = undefined; // coba init ulang di request berikutnya
        console.error("bot.init gagal:", err);
        return new Response("init error", { status: 500 }); // Telegram akan mengirim ulang
      }
      // Balas 200 ke Telegram secepatnya, proses di belakang.
      // Kalau telat membalas, Telegram mengirim ulang update dan bot bisa membalas dua kali.
      ctx.waitUntil(bot.handleUpdate(update as Parameters<Bot["handleUpdate"]>[0]).catch((err) => console.error("handleUpdate:", err)));
      return new Response("ok");
    }

    return new Response("Bot keluarga aktif ✅", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { bot } = getBot(env);
    ctx.waitUntil(runDueReminders(env, bot.api));
  },
} satisfies ExportedHandler<Env>;
