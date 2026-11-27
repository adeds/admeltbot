# Bot Keluarga

Bot Telegram pengingat untuk grup keluarga. Jalan 100% gratis di Cloudflare Workers + D1.

## Fitur

### Pakai tombol (paling mudah)

- **`/ingatkan`** tanpa isi → pilih **Hari ini / Besok / Lusa / 📅 kalender** → pilih jam (atau ⌨️ ketik jam lain) → **balas** pertanyaan bot dengan isi pesannya.
- **`/rutin`** tanpa isi → pilih **Tiap hari / Tiap minggu (pilih hari) / Tiap bulan (pilih tanggal)** → pilih jam → balas dengan isi pesannya.
- **`/daftar`** → setiap pengingat punya tombol **🗑 Hapus**.

Tombol hanya bisa diklik orang yang memulai alurnya. Alur yang ditinggal lebih dari 10 menit kedaluwarsa. Setelah pengingat tersimpan, pesan tombol dan pertanyaan bot dihapus otomatis supaya grup tetap rapi.

### Ketik langsung (untuk yang sudah terbiasa)

| Command | Fungsi |
|---|---|
| `/ingatkan 20-12-2026 08:00 jemput Nenek` | Pengingat sekali. Tanggal juga bisa `20/12`, `2026-12-20`, `besok`, `lusa`, `hari ini`. Tanggal tanpa tahun yang sudah lewat otomatis jadi tahun depan. |
| `/rutin harian 07:00 minum obat` | Pengingat tiap hari |
| `/rutin jumat 19:00 pengajian` | Pengingat tiap minggu (`senin` sampai `minggu`, atau `ahad`) |
| `/rutin tgl25 09:00 bayar listrik` | Pengingat tiap bulan. Kalau bulan itu tidak punya tanggal tersebut (mis. tgl 31), dipakai hari terakhir bulan. |
| `/hapus 12` | Hapus pengingat #12 tanpa membuka `/daftar` (hanya pembuatnya atau admin grup). Tidak muncul di menu. |

Jam pakai format 24 jam (`08:00` atau `08.00`). Maksimal 50 pengingat aktif per grup.

Saat pengingat terkirim, pembuatnya ditampilkan sebagai `dari @username`. Kalau orangnya tidak punya username Telegram, yang tampil namanya sebagai mention yang bisa diklik.

Ada juga dua command bantu yang tidak muncul di menu:
- `/id`: menampilkan ID chat, dipakai saat setup
- `/bantuan`: menampilkan cara pakai

Bot tidak membaca dan tidak menyimpan chat grup. Yang disimpan hanya pengingat dan alur tombol yang sedang berjalan.

## Yang perlu disiapkan

1. Node.js 20 atau lebih baru
2. Akun Cloudflare (gratis, tanpa kartu kredit): https://dash.cloudflare.com/sign-up
3. Token bot dari `@BotFather`

## Cara memasang

Jalankan semua perintah di folder ini.

**1. Install dependency dan login Cloudflare**
```bash
npm install
```
```bash
npx wrangler login
```

**2. Buat database D1**
```bash
npx wrangler d1 create bot-keluarga-db
```
Salin `database_id` dari hasil perintah itu ke `wrangler.jsonc`, ganti tulisan `GANTI_DENGAN_DATABASE_ID`. Lalu buat tabelnya:
```bash
npm run db:init
```

**3. Deploy pertama**
```bash
npm run deploy
```
Catat URL yang muncul, misalnya `https://bot-keluarga.namakamu.workers.dev`.

**4. Simpan rahasia** (setiap perintah akan meminta kamu menempelkan nilainya)
```bash
npx wrangler secret put BOT_TOKEN
```
```bash
npx wrangler secret put WEBHOOK_SECRET
```
Untuk `WEBHOOK_SECRET`, isi string acak. Bisa dibuat dengan:
```bash
openssl rand -hex 32
```

**5. Pasang webhook dan menu command**
```bash
cp .dev.vars.example .dev.vars
```
Isi `.dev.vars` dengan `BOT_TOKEN`, `WEBHOOK_SECRET` (harus sama dengan langkah 4), dan `WORKER_URL` dari langkah 3. File ini tidak ikut ter-commit. Lalu:
```bash
npm run setup
```

**6. Aktifkan untuk grup keluarga**
1. Masukkan bot ke grup. Bot akan membalas dengan ID grup, atau ketik `/id`.
2. Simpan ID itu sebagai secret (perintah ini meminta kamu menempelkan ID-nya). Untuk beberapa chat, pisahkan dengan koma, mis. `-1001234567890,-1009876543210`:
```bash
npx wrangler secret put ALLOWED_CHAT_IDS
```
Secret langsung berlaku tanpa deploy ulang. ID grup sengaja tidak ditaruh di `wrangler.jsonc`, supaya tidak ikut ter-commit kalau repo-nya publik.

3. Coba di grup: `/ingatkan`, lalu `/daftar`.

Grup yang tidak ada di `ALLOWED_CHAT_IDS` diabaikan, kecuali untuk `/id`.

## Pengaturan (`wrangler.jsonc` → `vars`)

ID grup yang diizinkan (`ALLOWED_CHAT_IDS`) disimpan sebagai secret, lihat langkah 6.

| Nama | Default | Arti |
|---|---|---|
| `TZ_OFFSET_MINUTES` / `TZ_LABEL` | 420 / WIB | Zona waktu. WITA = 480, WIT = 540. |

Perubahan `vars` baru berlaku setelah `npm run deploy`.

## Catatan

- **Privacy mode bot dibiarkan nyala** (default dari BotFather). Bot hanya menerima command, tidak membaca obrolan lain. Kalau di grup ada bot lain, pilih command dari menu `/` supaya command dikirim sebagai `/ingatkan@namabot`.
- **ID grup bisa berubah.** Kalau grup biasa berubah jadi supergroup, Telegram memberi ID baru. Pengingat dipindahkan otomatis, tapi ID baru harus ditambahkan ke `ALLOWED_CHAT_IDS`. Ketik `/id` lagi di grup.
- **Akurasi waktu.** Cron mengecek setiap menit, jadi pengingat terkirim paling telat sekitar 1 menit dari jadwal.
- **Database sudah berjalan, lalu schema berubah?** Untuk instalasi baru cukup `npm run db:init`. Untuk database lama, jalankan perubahan kolom/tabel baru secara manual. Contoh perubahan yang sudah dilakukan:
  ```sql
  ALTER TABLE reminders ADD COLUMN created_by_username TEXT;
  ```
  Tabel `flows` cukup dibuat dengan `npm run db:init`, karena memakai `CREATE TABLE IF NOT EXISTS`.
- **Lihat log:** `npm run logs`
- **Tes:** `npm test`

## Struktur kode

```
src/index.ts      pintu masuk Worker: webhook Telegram + cron tiap menit
src/bot.ts        command /ingatkan, /rutin, /daftar (+ tombol hapus), /hapus
src/flow.ts       alur tombol: pilih tanggal/jam, balas dengan pesan
src/keyboards.ts  susunan tombol (tanggal, kalender, jam, hari, tanggal bulanan)
src/time.ts       parsing & format tanggal/jam
src/reminders.ts  simpan & kirim pengingat
src/env.ts        pengaturan
src/format.ts     escape HTML, potong pesan panjang
schema.sql        tabel D1
scripts/setup.mjs pasang webhook + menu command
```
