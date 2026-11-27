-- Pengingat. Waktu disimpan sebagai unix detik (UTC).
CREATE TABLE IF NOT EXISTS reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id         INTEGER NOT NULL,
  created_by      INTEGER,
  created_by_name TEXT,
  created_by_username TEXT,                        -- @username Telegram (boleh kosong)
  message         TEXT    NOT NULL,
  next_run        INTEGER NOT NULL,
  repeat_kind     TEXT    NOT NULL DEFAULT 'once', -- once | daily | weekly | monthly
  repeat_value    INTEGER,                         -- weekly: 0=Minggu..6=Sabtu, monthly: tanggal 1-31
  time_hm         TEXT,                            -- jam untuk pengingat rutin, mis. "07:00"
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due  ON reminders (active, next_run);
CREATE INDEX IF NOT EXISTS idx_reminders_chat ON reminders (chat_id, active);

-- Alur pembuatan pengingat lewat tombol yang sedang berjalan (satu per orang per chat).
-- Kedaluwarsa setelah 10 menit tidak ada aktivitas; dibersihkan cron tiap jam.
CREATE TABLE IF NOT EXISTS flows (
  chat_id           INTEGER NOT NULL,
  user_id           INTEGER NOT NULL,
  kind              TEXT    NOT NULL,             -- once | rutin
  step              TEXT    NOT NULL,             -- date | time | typetime | message | repeat | weekday | monthday
  data              TEXT    NOT NULL DEFAULT '{}', -- JSON: date, time, repeat, weekday, monthday, name
  menu_message_id   INTEGER,                      -- pesan bot yang berisi tombol
  prompt_message_id INTEGER,                      -- pesan bot yang harus di-reply (ketik jam / pesan)
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
