// Simpan, tampilkan, dan kirim pengingat. Pengiriman lewat Cron.

import { GrammyError, type Api } from "grammy";
import type { Config, Env } from "./env";
import { loadConfig } from "./env";
import { escapeHtml } from "./format";
import { describeRepeat, formatDateTime, nextRun, type HM, type Repeat } from "./time";

export const MAX_ACTIVE_PER_CHAT = 50;

export interface ReminderRow {
  id: number;
  chat_id: number;
  created_by: number | null;
  created_by_name: string | null;
  message: string;
  next_run: number; // unix detik
  repeat_kind: "once" | "daily" | "weekly" | "monthly";
  repeat_value: number | null;
  time_hm: string | null;
  active: number;
  created_at: number;
}

export function rowRepeat(row: ReminderRow): Repeat {
  switch (row.repeat_kind) {
    case "daily":
      return { kind: "daily" };
    case "weekly":
      return { kind: "weekly", weekday: row.repeat_value ?? 0 };
    case "monthly":
      return { kind: "monthly", day: row.repeat_value ?? 1 };
    default:
      return { kind: "once" };
  }
}

function rowTime(row: ReminderRow): HM {
  const [h, mi] = (row.time_hm ?? "00:00").split(":").map(Number);
  return { h, mi };
}

export async function countActive(db: D1Database, chatId: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM reminders WHERE chat_id = ? AND active = 1").bind(chatId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertReminder(
  db: D1Database,
  r: { chatId: number; userId?: number; userName?: string; message: string; nextRunMs: number; repeat: Repeat; time?: HM },
): Promise<number> {
  const repeatValue = r.repeat.kind === "weekly" ? r.repeat.weekday : r.repeat.kind === "monthly" ? r.repeat.day : null;
  const timeHm = r.time ? `${String(r.time.h).padStart(2, "0")}:${String(r.time.mi).padStart(2, "0")}` : null;
  const row = await db
    .prepare(
      `INSERT INTO reminders (chat_id, created_by, created_by_name, message, next_run, repeat_kind, repeat_value, time_hm, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING id`,
    )
    .bind(
      r.chatId,
      r.userId ?? null,
      r.userName ?? null,
      r.message,
      Math.floor(r.nextRunMs / 1000),
      r.repeat.kind,
      repeatValue,
      timeHm,
      Math.floor(Date.now() / 1000),
    )
    .first<{ id: number }>();
  return row!.id;
}

export async function listActive(db: D1Database, chatId: number): Promise<ReminderRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM reminders WHERE chat_id = ? AND active = 1 ORDER BY next_run")
    .bind(chatId)
    .all<ReminderRow>();
  return results;
}

export async function getActive(db: D1Database, chatId: number, id: number): Promise<ReminderRow | null> {
  return db.prepare("SELECT * FROM reminders WHERE id = ? AND chat_id = ? AND active = 1").bind(id, chatId).first<ReminderRow>();
}

export async function deactivate(db: D1Database, id: number) {
  await db.prepare("UPDATE reminders SET active = 0 WHERE id = ?").bind(id).run();
}

/** Satu baris untuk /daftar (HTML). */
export function describeRow(row: ReminderRow, cfg: Config): string {
  const when = formatDateTime(row.next_run * 1000, cfg.tzOffset, cfg.tzLabel);
  const repeat = rowRepeat(row);
  const head =
    repeat.kind === "once" ? `<b>#${row.id}</b> · ${when}` : `<b>#${row.id}</b> · 🔁 ${describeRepeat(repeat, rowTime(row))}\n    berikutnya: ${when}`;
  return `${head}\n    ${escapeHtml(row.message)}`;
}

/** Dipanggil Cron tiap menit: kirim semua pengingat yang sudah jatuh tempo. */
export async function runDueReminders(env: Env, api: Api) {
  const cfg = loadConfig(env);
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const { results } = await env.DB.prepare("SELECT * FROM reminders WHERE active = 1 AND next_run <= ? ORDER BY next_run LIMIT 50")
    .bind(nowSec)
    .all<ReminderRow>();

  for (const row of results) {
    const repeat = rowRepeat(row);
    let text = `⏰ <b>Pengingat</b>\n${escapeHtml(row.message)}`;
    if (repeat.kind !== "once") text += `\n\n<i>🔁 ${describeRepeat(repeat, rowTime(row))}</i>`;
    if (row.created_by_name) text += `\n<i>dari ${escapeHtml(row.created_by_name)}</i>`;

    try {
      await api.sendMessage(row.chat_id, text, { parse_mode: "HTML" });
    } catch (err) {
      // Grup diubah Telegram jadi supergroup: ID grup berubah. Pindahkan pengingat ke ID baru.
      const newChatId = err instanceof GrammyError ? err.parameters?.migrate_to_chat_id : undefined;
      if (newChatId) {
        console.warn(`Grup ${row.chat_id} pindah ke ${newChatId}. Tambahkan ID baru ke ALLOWED_CHAT_IDS.`);
        await env.DB.prepare("UPDATE reminders SET chat_id = ? WHERE chat_id = ?").bind(newChatId, row.chat_id).run();
        continue;
      }
      // Bot dikeluarkan dari grup / grup tidak ada lagi: matikan pengingatnya.
      const gone = err instanceof GrammyError && (err.error_code === 403 || /chat not found/i.test(err.description));
      if (gone) {
        console.warn(`Pengingat #${row.id} dimatikan: ${err.description}`);
        await deactivate(env.DB, row.id);
      } else {
        console.error(`Gagal kirim pengingat #${row.id}, dicoba lagi menit berikutnya:`, err);
      }
      continue;
    }

    if (repeat.kind === "once") {
      await deactivate(env.DB, row.id);
    } else {
      const next = nextRun(repeat, rowTime(row), Math.max(nowMs, row.next_run * 1000), cfg.tzOffset);
      await env.DB.prepare("UPDATE reminders SET next_run = ? WHERE id = ?").bind(Math.floor(next / 1000), row.id).run();
    }
  }

  // Bersih-bersih sekali per jam (menit ke-0): hapus pengingat nonaktif yang lebih dari 30 hari.
  if (new Date(nowMs).getUTCMinutes() === 0) {
    await env.DB.prepare("DELETE FROM reminders WHERE active = 0 AND next_run < ?").bind(nowSec - 30 * 86400).run();
  }
}
