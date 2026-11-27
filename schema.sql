-- Pengingat. Waktu disimpan sebagai unix detik (UTC).
CREATE TABLE IF NOT EXISTS reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id         INTEGER NOT NULL,
  created_by      INTEGER,
  created_by_name TEXT,
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
