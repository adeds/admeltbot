import { describe, expect, it } from "vitest";
import { formatDateTime, fromLocal, nextRun, parseIngatkan, parseRutin, toLocal } from "../src/time";

const WIB = 420;
// "Sekarang" = Jumat, 27 Nov 2026, 10.00 WIB
const NOW = fromLocal(2026, 11, 27, 10, 0, WIB);

function local(ms: number) {
  const p = toLocal(ms, WIB);
  return `${p.y}-${p.m}-${p.d} ${p.h}:${String(p.mi).padStart(2, "0")}`;
}

describe("parseIngatkan", () => {
  it("tanggal lengkap DD-MM-YYYY", () => {
    const r = parseIngatkan("20-12-2026 08:00 jemput Nenek di stasiun", NOW, WIB);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(local(r.value.at)).toBe("2026-12-20 8:00");
      expect(r.value.message).toBe("jemput Nenek di stasiun");
    }
  });

  it("slash, jam pakai titik", () => {
    const r = parseIngatkan("20/12/2026 19.30 arisan", NOW, WIB);
    expect(r.ok && local(r.value.at)).toBe("2026-12-20 19:30");
  });

  it("ISO YYYY-MM-DD", () => {
    const r = parseIngatkan("2026-12-20 08:00 tes", NOW, WIB);
    expect(r.ok && local(r.value.at)).toBe("2026-12-20 8:00");
  });

  it("tanpa tahun -> tahun ini", () => {
    const r = parseIngatkan("20-12 08:00 tes", NOW, WIB);
    expect(r.ok && local(r.value.at)).toBe("2026-12-20 8:00");
  });

  it("tanpa tahun yang sudah lewat -> tahun depan", () => {
    const r = parseIngatkan("1-11 08:00 tes", NOW, WIB);
    expect(r.ok && local(r.value.at)).toBe("2027-11-1 8:00");
  });

  it("29-02 tanpa tahun -> tahun kabisat berikutnya yang valid", () => {
    // 2027 bukan kabisat, 2026 juga bukan -> tidak valid dua-duanya
    expect(parseIngatkan("29-02 08:00 tes", NOW, WIB).ok).toBe(false);
  });

  it("besok, lusa, hari ini", () => {
    const b = parseIngatkan("besok 07:30 bawa kue", NOW, WIB);
    expect(b.ok && local(b.value.at)).toBe("2026-11-28 7:30");
    const l = parseIngatkan("lusa 07:30 x", NOW, WIB);
    expect(l.ok && local(l.value.at)).toBe("2026-11-29 7:30");
    const h = parseIngatkan("hari ini 17:00 angkat jemuran", NOW, WIB);
    expect(h.ok && local(h.value.at)).toBe("2026-11-27 17:00");
    expect(h.ok && h.value.message).toBe("angkat jemuran");
    const H = parseIngatkan("Hari Ini 17:00 x", NOW, WIB);
    expect(H.ok).toBe(true);
  });

  it("menolak waktu yang sudah lewat", () => {
    const r = parseIngatkan("hari ini 09:00 tes", NOW, WIB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sudah lewat/);
    expect(parseIngatkan("20-11-2026 08:00 tes", NOW, WIB).ok).toBe(false);
  });

  it("menolak input salah", () => {
    expect(parseIngatkan("", NOW, WIB).ok).toBe(false);
    expect(parseIngatkan("32-12-2026 08:00 x", NOW, WIB).ok).toBe(false);
    expect(parseIngatkan("31-11-2026 08:00 x", NOW, WIB).ok).toBe(false);
    expect(parseIngatkan("20-12-2026 25:00 x", NOW, WIB).ok).toBe(false);
    expect(parseIngatkan("20-12-2026 8 x", NOW, WIB).ok).toBe(false);
    expect(parseIngatkan("20-12-2026 08:00", NOW, WIB).ok).toBe(false);
    expect(parseIngatkan("20-12-2026 08:00 " + "a".repeat(501), NOW, WIB).ok).toBe(false);
  });

  it("pesan multi-baris tetap utuh", () => {
    const r = parseIngatkan("besok 08:00 baris satu\nbaris dua", NOW, WIB);
    expect(r.ok && r.value.message).toBe("baris satu\nbaris dua");
  });
});

describe("parseRutin", () => {
  it("harian: hari ini kalau jamnya belum lewat", () => {
    const r = parseRutin("harian 19:00 minum obat", NOW, WIB);
    expect(r.ok && local(r.value.next)).toBe("2026-11-27 19:00");
  });

  it("harian: besok kalau jamnya sudah lewat", () => {
    const r = parseRutin("harian 07:00 minum obat", NOW, WIB);
    expect(r.ok && local(r.value.next)).toBe("2026-11-28 7:00");
  });

  it("mingguan: jumat (hari ini) jam yang sudah lewat -> jumat depan", () => {
    const r = parseRutin("jumat 08:00 x", NOW, WIB);
    expect(r.ok && local(r.value.next)).toBe("2026-12-4 8:00");
    const r2 = parseRutin("Jumat 19:00 pengajian", NOW, WIB);
    expect(r2.ok && local(r2.value.next)).toBe("2026-11-27 19:00");
  });

  it("mingguan: senin, minggu, ahad", () => {
    const s = parseRutin("senin 07:00 x", NOW, WIB);
    expect(s.ok && local(s.value.next)).toBe("2026-11-30 7:00");
    const m = parseRutin("minggu 07:00 x", NOW, WIB);
    expect(m.ok && local(m.value.next)).toBe("2026-11-29 7:00");
    const a = parseRutin("ahad 07:00 x", NOW, WIB);
    expect(a.ok && local(a.value.next)).toBe("2026-11-29 7:00");
  });

  it("bulanan: tgl25 dan 'tgl 25'", () => {
    const r = parseRutin("tgl25 09:00 bayar listrik", NOW, WIB);
    expect(r.ok && local(r.value.next)).toBe("2026-12-25 9:00");
    const r2 = parseRutin("tgl 28 09:00 bayar air", NOW, WIB);
    expect(r2.ok && local(r2.value.next)).toBe("2026-11-28 9:00");
    expect(r2.ok && r2.value.message).toBe("bayar air");
  });

  it("bulanan: tgl31 di bulan pendek pakai hari terakhir", () => {
    const afterJan31 = fromLocal(2027, 1, 31, 10, 0, WIB);
    const next = nextRun({ kind: "monthly", day: 31 }, { h: 9, mi: 0 }, afterJan31, WIB);
    expect(local(next)).toBe("2027-2-28 9:00");
    const afterFeb = nextRun({ kind: "monthly", day: 31 }, { h: 9, mi: 0 }, next, WIB);
    expect(local(afterFeb)).toBe("2027-3-31 9:00");
  });

  it("pergantian tahun", () => {
    const dec = fromLocal(2026, 12, 31, 23, 0, WIB);
    expect(local(nextRun({ kind: "daily" }, { h: 7, mi: 0 }, dec, WIB))).toBe("2027-1-1 7:00");
    expect(local(nextRun({ kind: "monthly", day: 5 }, { h: 7, mi: 0 }, dec, WIB))).toBe("2027-1-5 7:00");
  });

  it("menolak input salah", () => {
    expect(parseRutin("", NOW, WIB).ok).toBe(false);
    expect(parseRutin("bulanan 07:00 x", NOW, WIB).ok).toBe(false);
    expect(parseRutin("tgl32 07:00 x", NOW, WIB).ok).toBe(false);
    expect(parseRutin("harian 7 x", NOW, WIB).ok).toBe(false);
    expect(parseRutin("harian 07:00", NOW, WIB).ok).toBe(false);
  });
});

describe("format", () => {
  it("formatDateTime bahasa Indonesia", () => {
    expect(formatDateTime(fromLocal(2026, 12, 20, 8, 0, WIB), WIB, "WIB")).toBe("Minggu, 20 Des 2026, 08.00 WIB");
  });

  it("zona waktu WITA", () => {
    const r = parseIngatkan("20-12-2026 08:00 x", NOW, 480);
    expect(r.ok && new Date(r.value.at).toISOString()).toBe("2026-12-20T00:00:00.000Z");
  });
});
