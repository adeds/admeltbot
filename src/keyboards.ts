// Tombol inline (di bawah pesan bot). Fungsi murni, mudah dites.
//
// Format callback_data (maks 64 byte):
//   f:<userId>:<op>:<nilai>   langkah alur buat pengingat, hanya boleh diklik pemilik alur
//   del:<id>                  hapus pengingat dari /daftar
//   noop                      tombol hiasan (judul kalender, sel kosong)

import { InlineKeyboard } from "grammy";
import type { ReminderRow } from "./reminders";
import { daysInMonth, fromLocal, toLocal } from "./time";

const DAY = 86_400_000;

export const MONTHS_LONG = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const WEEK_HEADER = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const BLANK = "·";

/** Jam yang tampil sebagai tombol. Jam lain lewat "Ketik jam lain". */
export const TIME_PRESETS = [
  "05:00", "06:00", "07:00", "08:00",
  "09:00", "10:00", "12:00", "13:00",
  "15:00", "16:00", "17:00", "18:00",
  "19:00", "20:00", "21:00",
];

/** Bulan ke depan yang bisa dipilih di kalender. */
export const CALENDAR_MONTHS_AHEAD = 12;

export const cb = {
  flow: (uid: number, op: string, val: string | number = "") => `f:${uid}:${op}:${val}`,
  del: (id: number) => `del:${id}`,
  noop: "noop",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function withCancel(kb: InlineKeyboard, uid: number): InlineKeyboard {
  return kb.row().text("✖ Batal", cb.flow(uid, "x"));
}

export function cancelKeyboard(uid: number): InlineKeyboard {
  return new InlineKeyboard().text("✖ Batal", cb.flow(uid, "x"));
}

// ---------- /ingatkan ----------

export function dateKeyboard(uid: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("Hari ini", cb.flow(uid, "date", 0))
    .text("Besok", cb.flow(uid, "date", 1))
    .text("Lusa", cb.flow(uid, "date", 2))
    .row()
    .text("📅 Pilih tanggal lain", cb.flow(uid, "cal"));
  return withCancel(kb, uid);
}

/** Kalender satu bulan. Tanggal yang sudah lewat tidak bisa dipilih. */
export function calendarKeyboard(uid: number, y: number, m: number, nowMs: number, offsetMin: number): InlineKeyboard {
  const today = toLocal(nowMs, offsetMin);
  const monthIndex = (yy: number, mm: number) => yy * 12 + (mm - 1);
  const current = monthIndex(today.y, today.m);
  const shown = monthIndex(y, m);
  const ym = (idx: number) => `${Math.floor(idx / 12)}${pad((idx % 12) + 1)}`;

  const kb = new InlineKeyboard();
  kb.text(shown > current ? "‹" : BLANK, shown > current ? cb.flow(uid, "cal", ym(shown - 1)) : cb.noop)
    .text(`${MONTHS_LONG[m - 1]} ${y}`, cb.noop)
    .text(shown < current + CALENDAR_MONTHS_AHEAD ? "›" : BLANK, shown < current + CALENDAR_MONTHS_AHEAD ? cb.flow(uid, "cal", ym(shown + 1)) : cb.noop)
    .row();
  for (const w of WEEK_HEADER) kb.text(w, cb.noop);
  kb.row();

  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Minggu
  const total = daysInMonth(y, m);
  let col = 0;
  for (let i = 0; i < firstWeekday; i++, col++) kb.text(BLANK, cb.noop);
  for (let d = 1; d <= total; d++) {
    const past = y < today.y || (y === today.y && (m < today.m || (m === today.m && d < today.d)));
    if (past) kb.text(BLANK, cb.noop);
    else kb.text(String(d), cb.flow(uid, "day", `${y}${pad(m)}${pad(d)}`));
    col++;
    if (col % 7 === 0 && d < total) kb.row();
  }
  while (col % 7 !== 0) {
    kb.text(BLANK, cb.noop);
    col++;
  }
  kb.row().text("« Kembali", cb.flow(uid, "back"));
  return withCancel(kb, uid);
}

/**
 * Pilihan jam. Kalau `date` = hari ini, jam yang sudah lewat disembunyikan.
 * `date` null untuk pengingat rutin (semua jam tampil).
 */
export function timeKeyboard(uid: number, date: string | null, nowMs: number, offsetMin: number): InlineKeyboard {
  let presets = TIME_PRESETS;
  if (date) {
    const [y, m, d] = date.split("-").map(Number);
    presets = presets.filter((t) => {
      const [h, mi] = t.split(":").map(Number);
      return fromLocal(y, m, d, h, mi, offsetMin) > nowMs + 60_000;
    });
  }
  const kb = new InlineKeyboard();
  presets.forEach((t, i) => {
    kb.text(t.replace(":", "."), cb.flow(uid, "time", t.replace(":", "")));
    if (i % 4 === 3) kb.row();
  });
  kb.row().text("⌨️ Ketik jam lain", cb.flow(uid, "ttype"));
  return withCancel(kb, uid);
}

// ---------- /rutin ----------

export function repeatKeyboard(uid: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("Tiap hari", cb.flow(uid, "rep", "daily"))
    .row()
    .text("Tiap minggu", cb.flow(uid, "rep", "weekly"))
    .row()
    .text("Tiap bulan", cb.flow(uid, "rep", "monthly"));
  return withCancel(kb, uid);
}

export function weekdayKeyboard(uid: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("Senin", cb.flow(uid, "wd", 1))
    .text("Selasa", cb.flow(uid, "wd", 2))
    .text("Rabu", cb.flow(uid, "wd", 3))
    .text("Kamis", cb.flow(uid, "wd", 4))
    .row()
    .text("Jumat", cb.flow(uid, "wd", 5))
    .text("Sabtu", cb.flow(uid, "wd", 6))
    .text("Minggu", cb.flow(uid, "wd", 0));
  return withCancel(kb, uid);
}

export function monthdayKeyboard(uid: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let d = 1; d <= 31; d++) {
    kb.text(String(d), cb.flow(uid, "md", d));
    if (d % 7 === 0) kb.row();
  }
  return withCancel(kb, uid);
}

// ---------- /daftar ----------

export function listKeyboard(rows: ReminderRow[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const row of rows) {
    const snippet = row.message.length > 20 ? `${row.message.slice(0, 19)}…` : row.message;
    kb.text(`🗑 Hapus #${row.id} · ${snippet.replace(/\s+/g, " ")}`, cb.del(row.id)).row();
  }
  return kb;
}

/** Tanggal lokal (YYYY-MM-DD) untuk "hari ini + n hari". */
export function localDateAfter(nowMs: number, days: number, offsetMin: number): string {
  const p = toLocal(nowMs + days * DAY, offsetMin);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
