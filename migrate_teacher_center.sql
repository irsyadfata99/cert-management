-- ============================================================
-- MIGRATION: Multi-Center Teacher Support
-- Description: Memungkinkan satu teacher di-assign ke lebih dari
--              satu center. center_id di tabel users tetap ada
--              sebagai "primary center" agar tidak breaking.
-- ============================================================

-- ============================================================
-- 1. TABEL BARU: teacher_centers (junction table)
-- ============================================================

CREATE TABLE IF NOT EXISTS teacher_centers (
  teacher_id  INTEGER   NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  center_id   INTEGER   NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  is_primary  BOOLEAN   NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (teacher_id, center_id)
);

-- Constraint: setiap teacher hanya boleh punya SATU primary center
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_centers_one_primary
  ON teacher_centers (teacher_id)
  WHERE is_primary = TRUE;

-- Index untuk query umum
CREATE INDEX IF NOT EXISTS idx_teacher_centers_teacher_id ON teacher_centers (teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_centers_center_id  ON teacher_centers (center_id);

-- ============================================================
-- 2. HAPUS CONSTRAINT chk_teacher_has_center
--    (tidak lagi relevan karena center disimpan di teacher_centers)
-- ============================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_teacher_has_center;

-- ============================================================
-- 3. MIGRATE DATA EXISTING
--    Semua teacher yang sudah punya center_id di tabel users
--    → masukkan ke teacher_centers sebagai primary center.
--    Dengan ON CONFLICT DO NOTHING, migration aman dijalankan
--    berulang kali (idempotent).
-- ============================================================

INSERT INTO teacher_centers (teacher_id, center_id, is_primary)
SELECT id, center_id, TRUE
FROM users
WHERE role = 'teacher'
  AND center_id IS NOT NULL
ON CONFLICT (teacher_id, center_id) DO NOTHING;

-- ============================================================
-- CATATAN:
-- - Kolom center_id di tabel users TIDAK dihapus.
--   Tetap dipakai sebagai "primary center" untuk backward
--   compatibility dan referensi cepat tanpa JOIN.
-- - Saat teacher di-assign ke center baru via API, masukkan
--   ke teacher_centers. Update users.center_id hanya jika
--   is_primary = TRUE.
-- - Saat teacher di-remove dari center, hapus dari
--   teacher_centers. Jika center yang dihapus adalah primary,
--   set center lain sebagai primary (atau null jika tidak ada).
-- ============================================================