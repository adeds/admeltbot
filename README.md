# Bot Keluarga

Bot Telegram pengingat untuk grup keluarga. Jalan 100% gratis di Cloudflare Workers + D1.

## Fitur

| Command | Fungsi |
|---|---|
| `/ingatkan 20-12-2026 08:00 jemput Nenek` | Pengingat sekali. Tanggal juga bisa `20/12`, `2026-12-20`, `besok`, `lusa`, `hari ini`. Tanggal tanpa tahun yang sudah lewat otomatis jadi tahun depan. |
| `/rutin harian 07:00 minum obat` | Pengingat tiap hari |
| `/rutin jumat 19:00 pengajian` | Pengingat tiap minggu (`senin` sampai `minggu`, atau `ahad`) |
| `/rutin tgl25 09:00 bayar listrik` | Pengingat tiap bulan. Kalau bulan itu tidak punya tanggal tersebut (mis. tgl 31), dipakai hari terakhir bulan. |
| `/daftar` | Lihat semua pengingat aktif beserta nomornya |
| `/hapus 12` | Hapus pengingat #12 (hanya pembuatnya atau admin grup) |

Jam pakai format 24 jam (`08:00` atau `08.00`). Maksimal 50 pengingat aktif per grup.

Ada juga dua command bantu yang tidak muncul di menu:
- `/id`: menampilkan ID chat, dipakai saat setup
- `/bantuan`: menampilkan cara pakai

Bot tidak membaca dan tidak menyimpan chat grup. Yang disimpan hanya pengingat.

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
2. Isi ID itu di `wrangler.jsonc`, misalnya `"ALLOWED_CHAT_IDS": "-1001234567890"`. Untuk beberapa chat, pisahkan dengan koma.
3. Deploy ulang:
```bash
npm run deploy
```
4. Coba di grup: `/ingatkan hari ini 23:59 tes`, lalu `/daftar`.

Grup yang tidak ada di `ALLOWED_CHAT_IDS` diabaikan, kecuali untuk `/id`.

## Pengaturan (`wrangler.jsonc` → `vars`)

| Nama | Default | Arti |
|---|---|---|
| `ALLOWED_CHAT_IDS` | kosong | ID grup/chat yang boleh memakai bot |
| `TZ_OFFSET_MINUTES` / `TZ_LABEL` | 420 / WIB | Zona waktu. WITA = 480, WIT = 540. |

Setiap perubahan baru berlaku setelah `npm run deploy`.

## Catatan

- **Privacy mode bot dibiarkan nyala** (default dari BotFather). Bot hanya menerima command, tidak membaca obrolan lain. Kalau di grup ada bot lain, pilih command dari menu `/` supaya command dikirim sebagai `/ingatkan@namabot`.
- **ID grup bisa berubah.** Kalau grup biasa berubah jadi supergroup, Telegram memberi ID baru. Pengingat dipindahkan otomatis, tapi ID baru harus ditambahkan ke `ALLOWED_CHAT_IDS`. Ketik `/id` lagi di grup.
- **Akurasi waktu.** Cron mengecek setiap menit, jadi pengingat terkirim paling telat sekitar 1 menit dari jadwal.
- **Lihat log:** `npm run logs`
- **Tes:** `npm test`

## Struktur kode

```
src/index.ts      pintu masuk Worker: webhook Telegram + cron tiap menit
src/bot.ts        command /ingatkan, /rutin, /daftar, /hapus
src/time.ts       parsing & format tanggal/jam
src/reminders.ts  simpan & kirim pengingat
src/env.ts        pengaturan
src/format.ts     escape HTML, potong pesan panjang
schema.sql        tabel D1
scripts/setup.mjs pasang webhook + menu command
```
