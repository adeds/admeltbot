// Parsing dan format tanggal/jam untuk pengingat. Tanpa library.
// Semua waktu disimpan sebagai epoch ms UTC; "lokal" = UTC + offset zona waktu grup.

const MIN = 60_000;
const DAY = 86_400_000;

export const MAX_MESSAGE_LENGTH = 500;

export const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const WEEKDAYS: Record<string, number> = {
  minggu: 0,
  ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6,
};

export type Repeat =
  | { kind: "once" }
  | { kind: "daily" }
  | { kind: "weekly"; weekday: number }
  | { kind: "monthly"; day: number };

export interface HM {
  h: number;
  mi: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const USAGE_INGATKAN =
  "Format: /ingatkan <tanggal> <jam> <pesan>\n" +
  "Contoh:\n" +
  "/ingatkan 20-12-2026 08:00 jemput Nenek\n" +
  "/ingatkan 20/12 08.00 jemput Nenek\n" +
  "/ingatkan besok 07:30 bawa kue\n" +
  "/ingatkan hari ini 17:00 angkat jemuran";

export const USAGE_RUTIN =
  "Format: /rutin <kapan> <jam> <pesan>\n" +
  "Contoh:\n" +
  "/rutin harian 07:00 minum obat\n" +
  "/rutin jumat 19:00 pengajian\n" +
  "/rutin tgl25 09:00 bayar listrik";

// ---------- konversi lokal <-> UTC ----------

export interface LocalParts {
  y: number;
  m: number; // 1-12
  d: number;
  wd: number; // 0=Minggu
  h: number;
  mi: number;
}

export function toLocal(utcMs: number, offsetMin: number): LocalParts {
  const t = new Date(utcMs + offsetMin * MIN);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    wd: t.getUTCDay(),
    h: t.getUTCHours(),
    mi: t.getUTCMinutes(),
  };
}

export function fromLocal(y: number, m: number, d: number, h: number, mi: number, offsetMin: number): number {
  return Date.UTC(y, m - 1, d, h, mi) - offsetMin * MIN;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isValidDate(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

// ---------- parsing token ----------

export function parseTime(token: string): HM | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(token);
  if (!match) return null;
  const h = Number(match[1]);
  const mi = Number(match[2]);
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

interface DateToken {
  y: number;
  m: number;
  d: number;
  /** false kalau user tidak menulis tahun (mis. "20-12"): boleh digeser ke tahun depan. */
  fixed: boolean;
}

export function parseDateToken(token: string, nowMs: number, offsetMin: number): DateToken | null {
  const t = token.toLowerCase();
  const relative: Record<string, number> = { hariini: 0, besok: 1, lusa: 2 };
  if (t in relative) {
    const p = toLocal(nowMs + relative[t] * DAY, offsetMin);
    return { y: p.y, m: p.m, d: p.d, fixed: true };
  }

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return isValidDate(y, m, d) ? { y, m, d, fixed: true } : null;
  }

  match = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?$/.exec(t);
  if (match) {
    const d = Number(match[1]);
    const m = Number(match[2]);
    const hasYear = match[3] !== undefined;
    let y = hasYear ? Number(match[3]) : toLocal(nowMs, offsetMin).y;
    if (!hasYear && !isValidDate(y, m, d)) y += 1; // mis. 29-02 di tahun non-kabisat
    if (!isValidDate(y, m, d)) return null;
    return { y, m, d, fixed: hasYear };
  }
  return null;
}

/** Pisahkan kata pertama dari sisa teks. */
function splitFirst(text: string): [string, string] {
  const match = /^(\S+)\s*([\s\S]*)$/.exec(text.trim());
  return match ? [match[1], match[2]] : ["", ""];
}

export function checkMessage(message: string): string | null {
  if (!message.trim()) return "Pesan pengingatnya apa?";
  if (message.length > MAX_MESSAGE_LENGTH) return `Pesan terlalu panjang (maksimal ${MAX_MESSAGE_LENGTH} karakter).`;
  return null;
}

// ---------- /ingatkan ----------

export interface OnceReminder {
  at: number; // epoch ms UTC
  message: string;
}

export function parseIngatkan(args: string, nowMs: number, offsetMin: number): ParseResult<OnceReminder> {
  let text = args.trim();
  if (!text) return { ok: false, error: USAGE_INGATKAN };

  // "hari ini" terdiri dari dua kata.
  let dateWord: string;
  if (/^hari\s+ini(\s|$)/i.test(text)) {
    dateWord = "hariini";
    text = text.replace(/^hari\s+ini\s*/i, "");
  } else {
    [dateWord, text] = splitFirst(text);
  }
  const [timeWord, message] = splitFirst(text);

  const date = parseDateToken(dateWord, nowMs, offsetMin);
  if (!date) return { ok: false, error: `Tanggal "${dateWord}" tidak dikenali.\n\n${USAGE_INGATKAN}` };

  const time = parseTime(timeWord);
  if (!time) {
    const shown = timeWord || "(kosong)";
    return { ok: false, error: `Jam "${shown}" tidak dikenali. Pakai format 24 jam, mis. 08:00 atau 19.30.\n\n${USAGE_INGATKAN}` };
  }

  const msgError = checkMessage(message);
  if (msgError) return { ok: false, error: `${msgError}\n\n${USAGE_INGATKAN}` };

  let at = fromLocal(date.y, date.m, date.d, time.h, time.mi, offsetMin);
  if (at <= nowMs && !date.fixed) {
    // "20-12" yang sudah lewat tahun ini -> tahun depan.
    at = fromLocal(date.y + 1, date.m, date.d, time.h, time.mi, offsetMin);
  }
  if (at <= nowMs) {
    return { ok: false, error: "Waktunya sudah lewat. Coba tanggal atau jam lain." };
  }
  return { ok: true, value: { at, message: message.trim() } };
}

// ---------- /rutin ----------

export interface RecurringReminder {
  repeat: Exclude<Repeat, { kind: "once" }>;
  time: HM;
  message: string;
  next: number; // epoch ms UTC
}

export function parseRutin(args: string, nowMs: number, offsetMin: number): ParseResult<RecurringReminder> {
  let [kindWord, text] = splitFirst(args);
  if (!kindWord) return { ok: false, error: USAGE_RUTIN };
  let kind = kindWord.toLowerCase();

  // "tgl 25" -> "tgl25"
  if ((kind === "tgl" || kind === "tanggal") && /^\d{1,2}(\s|$)/.test(text)) {
    const [num, rest] = splitFirst(text);
    kind += num;
    text = rest;
  }

  let repeat: RecurringReminder["repeat"];
  const monthly = /^(?:tgl|tanggal)(\d{1,2})$/.exec(kind);
  if (kind === "harian" || kind === "tiaphari" || kind === "setiaphari") {
    repeat = { kind: "daily" };
  } else if (kind in WEEKDAYS) {
    repeat = { kind: "weekly", weekday: WEEKDAYS[kind] };
  } else if (monthly) {
    const day = Number(monthly[1]);
    if (day < 1 || day > 31) return { ok: false, error: `Tanggal ${day} tidak valid (1-31).` };
    repeat = { kind: "monthly", day };
  } else {
    return {
      ok: false,
      error: `"${kindWord}" tidak dikenali. Pakai: harian, nama hari (senin..minggu), atau tgl<angka>.\n\n${USAGE_RUTIN}`,
    };
  }

  const [timeWord, message] = splitFirst(text);
  const time = parseTime(timeWord);
  if (!time) {
    const shown = timeWord || "(kosong)";
    return { ok: false, error: `Jam "${shown}" tidak dikenali. Pakai format 24 jam, mis. 07:00.\n\n${USAGE_RUTIN}` };
  }

  const msgError = checkMessage(message);
  if (msgError) return { ok: false, error: `${msgError}\n\n${USAGE_RUTIN}` };

  return {
    ok: true,
    value: { repeat, time, message: message.trim(), next: nextRun(repeat, time, nowMs, offsetMin) },
  };
}

/** Waktu berikutnya (> afterMs) untuk pengingat rutin. */
export function nextRun(repeat: RecurringReminder["repeat"], time: HM, afterMs: number, offsetMin: number): number {
  const now = toLocal(afterMs, offsetMin);
  const at = (y: number, m: number, d: number) => fromLocal(y, m, d, time.h, time.mi, offsetMin);

  if (repeat.kind === "daily") {
    const today = at(now.y, now.m, now.d);
    return today > afterMs ? today : today + DAY;
  }

  if (repeat.kind === "weekly") {
    const diff = (repeat.weekday - now.wd + 7) % 7;
    const candidate = at(now.y, now.m, now.d) + diff * DAY;
    return candidate > afterMs ? candidate : candidate + 7 * DAY;
  }

  // monthly: kalau bulan itu tidak punya tanggal tsb (mis. 31 Feb), pakai hari terakhir bulan.
  for (let i = 0; i < 3; i++) {
    const mIndex = now.m - 1 + i;
    const y = now.y + Math.floor(mIndex / 12);
    const m = (mIndex % 12) + 1;
    const d = Math.min(repeat.day, daysInMonth(y, m));
    const candidate = at(y, m, d);
    if (candidate > afterMs) return candidate;
  }
  throw new Error("nextRun monthly: tidak menemukan jadwal");
}

// ---------- format ----------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatHM(time: HM): string {
  return `${pad(time.h)}.${pad(time.mi)}`;
}

/** "Minggu, 20 Des 2026, 08.00 WIB" */
export function formatDateTime(utcMs: number, offsetMin: number, tzLabel: string): string {
  const p = toLocal(utcMs, offsetMin);
  return `${DAY_NAMES[p.wd]}, ${p.d} ${MONTH_NAMES[p.m - 1]} ${p.y}, ${pad(p.h)}.${pad(p.mi)} ${tzLabel}`;
}

/** "tiap hari 07.00", "tiap Jumat 19.00", "tiap tanggal 25, 09.00" */
export function describeRepeat(repeat: Repeat, time: HM): string {
  switch (repeat.kind) {
    case "daily":
      return `tiap hari ${formatHM(time)}`;
    case "weekly":
      return `tiap ${DAY_NAMES[repeat.weekday]} ${formatHM(time)}`;
    case "monthly":
      return `tiap tanggal ${repeat.day}, ${formatHM(time)}`;
    default:
      return "sekali";
  }
}
