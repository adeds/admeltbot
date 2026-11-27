// Tes ujung-ke-ujung handler bot (command teks + cron).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDueReminders } from "../src/reminders";
import { fromLocal } from "../src/time";
import { GROUP, NOW, OTHER_GROUP, setup, textUpdate } from "./helpers";

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
    expect(texts()[2]).toContain("dari @budi_k");

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
