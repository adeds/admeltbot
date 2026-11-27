// Tes alur tombol /ingatkan & /rutin, tombol hapus di /daftar, dan @username di pengingat.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorMention, runDueReminders } from "../src/reminders";
import { fromLocal } from "../src/time";
import { callbackUpdate, NOW, setup, textUpdate } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW); // Jumat 27 Nov 2026 10.00 WIB
});
afterEach(() => vi.useRealTimers());

/** Mulai /ingatkan atau /rutin, kembalikan message_id pesan tombol. */
async function start(t: ReturnType<typeof setup>, cmd: string, userId = 1) {
  await t.bot.handleUpdate(textUpdate(cmd, { userId }));
  return t.last("sendMessage")!.result.message_id as number;
}

function reminders(t: ReturnType<typeof setup>) {
  return t.db.raw.prepare("SELECT * FROM reminders ORDER BY id").all() as any[];
}
function flows(t: ReturnType<typeof setup>) {
  return t.db.raw.prepare("SELECT * FROM flows").all() as any[];
}

describe("/ingatkan dengan tombol", () => {
  it("alur lengkap: Besok -> 08.00 -> balas pesan -> tersimpan", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan");
    expect(t.last("sendMessage")!.payload.text).toContain("Kapan?");
    expect(t.buttons(t.last("sendMessage")).map((b) => b.text)).toEqual(["Hari ini", "Besok", "Lusa", "📅 Pilih tanggal lain", "✖ Batal"]);

    await t.bot.handleUpdate(callbackUpdate("f:1:date:1", menu));
    const edit = t.last("editMessageText")!;
    expect(edit.payload.text).toContain("Sabtu, 28 Nov 2026");
    expect(edit.payload.text).toContain("Jam berapa?");
    expect(t.buttons(edit).map((b) => b.text)).toContain("05.00"); // besok: semua jam tampil

    await t.bot.handleUpdate(callbackUpdate("f:1:time:0800", menu));
    const prompt = t.last("sendMessage")!;
    expect(prompt.payload.reply_markup.force_reply).toBe(true);
    expect(prompt.payload.reply_markup.selective).toBe(true);
    expect(prompt.payload.text).toContain('href="tg://user?id=1"');

    await t.bot.handleUpdate(textUpdate("jemput Nenek", { replyTo: prompt.result.message_id }));
    const [r] = reminders(t);
    expect(r.next_run * 1000).toBe(fromLocal(2026, 11, 28, 8, 0, 420));
    expect(r.message).toBe("jemput Nenek");
    expect(r.created_by_username).toBe("budi_k");
    expect(t.last("sendMessage")!.payload.text).toContain("Pengingat tersimpan (#1)");
    // pesan tombol & pertanyaan dibersihkan
    const deleted = t.calls("deleteMessage").map((c) => c.payload.message_id);
    expect(deleted).toEqual(expect.arrayContaining([menu, prompt.result.message_id]));
    expect(flows(t)).toHaveLength(0);
  });

  it("Hari ini: jam yang sudah lewat tidak ditampilkan", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan");
    await t.bot.handleUpdate(callbackUpdate("f:1:date:0", menu));
    const labels = t.buttons(t.last("editMessageText")).map((b) => b.text);
    expect(labels).not.toContain("08.00");
    expect(labels).not.toContain("10.00"); // = sekarang
    expect(labels).toContain("12.00");
  });

  it("kalender: tanggal lewat tidak bisa diklik, bisa ke bulan depan, pilih tanggal", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan");
    await t.bot.handleUpdate(callbackUpdate("f:1:cal:", menu));
    const cal = t.buttons(t.last("editMessageText"));
    expect(cal.map((b) => b.text)).toContain("November 2026");
    expect(cal.find((b) => b.text === "26")).toBeUndefined(); // sudah lewat
    expect(cal.find((b) => b.text === "27")?.callback_data).toBe("f:1:day:20261127");
    expect(cal.find((b) => b.text === "›")?.callback_data).toBe("f:1:cal:202612");
    // tidak ada tombol mundur di bulan ini
    expect(cal.find((b) => b.text === "‹")).toBeUndefined();

    await t.bot.handleUpdate(callbackUpdate("f:1:cal:202612", menu));
    expect(t.buttons(t.last("editMessageText")).map((b) => b.text)).toContain("Desember 2026");

    await t.bot.handleUpdate(callbackUpdate("f:1:day:20261220", menu));
    expect(t.last("editMessageText")!.payload.text).toContain("Minggu, 20 Des 2026");

    // tanggal lewat lewat callback palsu ditolak
    const t2 = setup();
    const menu2 = await start(t2, "/ingatkan");
    await t2.bot.handleUpdate(callbackUpdate("f:1:day:20261101", menu2));
    expect(t2.last("answerCallbackQuery")!.payload.text).toContain("sudah lewat");
  });

  it("ketik jam sendiri: salah -> diminta ulang, benar -> lanjut", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan");
    await t.bot.handleUpdate(callbackUpdate("f:1:date:1", menu));
    await t.bot.handleUpdate(callbackUpdate("f:1:ttype:", menu));
    const p1 = t.last("sendMessage")!;
    expect(p1.payload.text).toContain("jam berapa?");

    await t.bot.handleUpdate(textUpdate("25:00", { replyTo: p1.result.message_id }));
    const p2 = t.last("sendMessage")!;
    expect(p2.payload.text).toContain("Format jam belum benar");

    await t.bot.handleUpdate(textUpdate("08.45", { replyTo: p2.result.message_id }));
    const p3 = t.last("sendMessage")!;
    expect(p3.payload.text).toContain("pesan pengingatnya apa?");

    await t.bot.handleUpdate(textUpdate("minum obat", { replyTo: p3.result.message_id }));
    expect(reminders(t)[0].next_run * 1000).toBe(fromLocal(2026, 11, 28, 8, 45, 420));
  });

  it("jam yang sudah lewat hari ini ditolak", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan");
    await t.bot.handleUpdate(callbackUpdate("f:1:date:0", menu));
    await t.bot.handleUpdate(callbackUpdate("f:1:time:0800", menu)); // tombol lama/palsu
    const ans = t.last("answerCallbackQuery")!.payload;
    expect(ans.text).toContain("sudah lewat");
    expect(ans.show_alert).toBe(true);
  });

  it("tombol orang lain tidak bisa diklik", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan", 1);
    await t.bot.handleUpdate(callbackUpdate("f:1:date:1", menu, { userId: 2 }));
    const ans = t.last("answerCallbackQuery")!.payload;
    expect(ans.text).toContain("milik orang lain");
    expect(ans.show_alert).toBe(true);
    expect(JSON.parse(flows(t)[0].data).date).toBeUndefined();
  });

  it("balasan teks yang bukan reply ke pertanyaan bot diabaikan", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan");
    await t.bot.handleUpdate(callbackUpdate("f:1:date:1", menu));
    await t.bot.handleUpdate(callbackUpdate("f:1:time:0800", menu));
    await t.bot.handleUpdate(textUpdate("ngobrol biasa"));
    expect(reminders(t)).toHaveLength(0);
    expect(flows(t)).toHaveLength(1);
  });

  it("Batal menghapus alur", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan");
    await t.bot.handleUpdate(callbackUpdate("f:1:x:", menu));
    expect(t.last("editMessageText")!.payload.text).toContain("Dibatalkan");
    expect(flows(t)).toHaveLength(0);
  });

  it("sesi kedaluwarsa setelah 10 menit, dan tombol dari pesan lama ditolak", async () => {
    const t = setup();
    const menu = await start(t, "/ingatkan");
    vi.setSystemTime(NOW + 11 * 60_000);
    await t.bot.handleUpdate(callbackUpdate("f:1:date:1", menu));
    expect(t.last("answerCallbackQuery")!.payload.text).toContain("sudah berakhir");

    const t2 = setup();
    const old = await start(t2, "/ingatkan");
    await start(t2, "/ingatkan"); // mulai ulang -> pesan lama tidak berlaku
    await t2.bot.handleUpdate(callbackUpdate("f:1:date:1", old));
    expect(t2.last("answerCallbackQuery")!.payload.text).toContain("sudah berakhir");
  });

  it("format teks lama tetap jalan", async () => {
    const t = setup();
    await t.bot.handleUpdate(textUpdate("/ingatkan besok 08:00 jemput"));
    expect(t.texts()[0]).toContain("Pengingat tersimpan");
    expect(flows(t)).toHaveLength(0);
  });
});

describe("/rutin dengan tombol", () => {
  it("tiap minggu -> Jumat -> 19.00 -> pesan", async () => {
    const t = setup();
    const menu = await start(t, "/rutin");
    expect(t.last("sendMessage")!.payload.text).toContain("Seberapa sering?");
    await t.bot.handleUpdate(callbackUpdate("f:1:rep:weekly", menu));
    expect(t.last("editMessageText")!.payload.text).toContain("Hari apa?");
    await t.bot.handleUpdate(callbackUpdate("f:1:wd:5", menu));
    expect(t.last("editMessageText")!.payload.text).toContain("tiap Jumat");
    await t.bot.handleUpdate(callbackUpdate("f:1:time:1900", menu));
    const prompt = t.last("sendMessage")!;
    await t.bot.handleUpdate(textUpdate("pengajian", { replyTo: prompt.result.message_id }));

    const [r] = reminders(t);
    expect(r.repeat_kind).toBe("weekly");
    expect(r.repeat_value).toBe(5);
    expect(r.time_hm).toBe("19:00");
    expect(r.next_run * 1000).toBe(fromLocal(2026, 11, 27, 19, 0, 420)); // Jumat ini
    expect(t.last("sendMessage")!.payload.text).toContain("tiap Jumat 19.00");
  });

  it("tiap bulan tanggal 31 dan tiap hari", async () => {
    const t = setup();
    let menu = await start(t, "/rutin");
    await t.bot.handleUpdate(callbackUpdate("f:1:rep:monthly", menu));
    expect(t.buttons(t.last("editMessageText")).filter((b) => /^\d+$/.test(b.text))).toHaveLength(31);
    await t.bot.handleUpdate(callbackUpdate("f:1:md:31", menu));
    await t.bot.handleUpdate(callbackUpdate("f:1:time:0900", menu));
    await t.bot.handleUpdate(textUpdate("bayar listrik", { replyTo: t.last("sendMessage")!.result.message_id }));
    expect(reminders(t)[0].next_run * 1000).toBe(fromLocal(2026, 11, 30, 9, 0, 420)); // Nov cuma 30 hari

    menu = await start(t, "/rutin");
    await t.bot.handleUpdate(callbackUpdate("f:1:rep:daily", menu));
    await t.bot.handleUpdate(callbackUpdate("f:1:time:0700", menu));
    await t.bot.handleUpdate(textUpdate("minum obat", { replyTo: t.last("sendMessage")!.result.message_id }));
    expect(reminders(t)[1].next_run * 1000).toBe(fromLocal(2026, 11, 28, 7, 0, 420));
  });

  it("tombol langkah yang salah (urutan) ditolak", async () => {
    const t = setup();
    const menu = await start(t, "/rutin");
    await t.bot.handleUpdate(callbackUpdate("f:1:wd:5", menu)); // belum pilih "tiap minggu"
    expect(t.last("answerCallbackQuery")!.payload.text).toContain("tidak berlaku");
  });
});

describe("/daftar dengan tombol hapus", () => {
  it("pembuat bisa hapus lewat tombol, daftar diperbarui", async () => {
    const t = setup();
    await t.bot.handleUpdate(textUpdate("/ingatkan besok 08:00 satu"));
    await t.bot.handleUpdate(textUpdate("/ingatkan besok 09:00 dua"));
    await t.bot.handleUpdate(textUpdate("/daftar"));
    const list = t.last("sendMessage")!;
    expect(t.buttons(list).map((b) => b.callback_data)).toEqual(["del:1", "del:2"]);

    await t.bot.handleUpdate(callbackUpdate("del:1", list.result.message_id));
    expect(t.last("answerCallbackQuery")!.payload.text).toContain("dihapus");
    const edit = t.last("editMessageText")!;
    expect(edit.payload.text).not.toContain("satu");
    expect(t.buttons(edit).map((b) => b.callback_data)).toEqual(["del:2"]);

    await t.bot.handleUpdate(callbackUpdate("del:2", list.result.message_id));
    expect(t.last("editMessageText")!.payload.text).toContain("Belum ada pengingat aktif");
  });

  it("orang lain (bukan admin) tidak bisa hapus; admin bisa", async () => {
    const t = setup();
    await t.bot.handleUpdate(textUpdate("/ingatkan besok 08:00 satu", { userId: 1 }));
    await t.bot.handleUpdate(textUpdate("/daftar"));
    const listId = t.last("sendMessage")!.result.message_id;

    await t.bot.handleUpdate(callbackUpdate("del:1", listId, { userId: 2 }));
    expect(t.last("answerCallbackQuery")!.payload.show_alert).toBe(true);
    expect(reminders(t)[0].active).toBe(1);

    t.setMember("administrator");
    await t.bot.handleUpdate(callbackUpdate("del:1", listId, { userId: 2 }));
    expect(reminders(t)[0].active).toBe(0);
  });
});

describe("pembuat pengingat ditampilkan sebagai @username", () => {
  it("punya username -> @username, tanpa username -> nama yang bisa diklik", async () => {
    const t = setup();
    await t.bot.handleUpdate(textUpdate("/ingatkan besok 08:00 dari budi", { userId: 1 }));
    await t.bot.handleUpdate(textUpdate("/ingatkan besok 08:00 dari siti", { userId: 2 }));
    vi.setSystemTime(fromLocal(2026, 11, 28, 8, 0, 420));
    await runDueReminders(t.env, t.bot.api);
    const sentReminders = t.texts().filter((x) => x.startsWith("⏰"));
    expect(sentReminders[0]).toContain("dari @budi_k");
    expect(sentReminders[0]).not.toContain("Budi");
    expect(sentReminders[1]).toContain('dari <a href="tg://user?id=2">Siti</a>');
  });

  it("pengingat lama tanpa data username tetap aman", () => {
    expect(authorMention({ created_by: 5, created_by_name: "Punk <og>", created_by_username: null })).toBe(
      '<a href="tg://user?id=5">Punk &lt;og&gt;</a>',
    );
    expect(authorMention({ created_by: null, created_by_name: null, created_by_username: null })).toBe("");
  });
});
