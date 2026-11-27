export interface Env {
  DB: D1Database;

  // Rahasia (npx wrangler secret put ...)
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  /** ID grup/chat yang diizinkan, dipisah koma. Secret supaya ID grup tidak ada di repo publik. */
  ALLOWED_CHAT_IDS: string;

  // vars di wrangler.jsonc
  TZ_OFFSET_MINUTES: string;
  TZ_LABEL: string;
}

export interface Config {
  allowedChats: Set<string>;
  tzOffset: number;
  tzLabel: string;
}

export function loadConfig(env: Env): Config {
  const offset = Number(env.TZ_OFFSET_MINUTES);
  return {
    allowedChats: new Set(
      (env.ALLOWED_CHAT_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    tzOffset: env.TZ_OFFSET_MINUTES && Number.isFinite(offset) ? offset : 420,
    tzLabel: env.TZ_LABEL || "WIB",
  };
}
