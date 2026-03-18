

BEGIN;

TRUNCATE TABLE session;

-- Data transaksi utama
DELETE FROM reports;
DELETE FROM medals;
DELETE FROM certificates;

-- Stock (hapus data kuantitas, bukan tabel)
DELETE FROM certificate_stock_batches;
DELETE FROM certificate_stock;
DELETE FROM medal_stock;

-- Enrollments
DELETE FROM enrollments;

-- Teacher centers junction dulu sebelum users
DELETE FROM teacher_centers;

DELETE FROM users WHERE role IN ('teacher', 'admin');

DELETE FROM students;
DELETE FROM modules;
DELETE FROM centers;

-- ── 3. Reset semua sequences ke 1 ───────────────────────────

-- Transaksi
ALTER SEQUENCE reports_id_seq                  RESTART WITH 1;
ALTER SEQUENCE medals_id_seq                   RESTART WITH 1;
ALTER SEQUENCE certificates_id_seq             RESTART WITH 1;
ALTER SEQUENCE enrollments_id_seq              RESTART WITH 1;
ALTER SEQUENCE certificate_stock_batches_id_seq RESTART WITH 1;
ALTER SEQUENCE certificate_stock_id_seq        RESTART WITH 1;
ALTER SEQUENCE medal_stock_id_seq              RESTART WITH 1;
ALTER SEQUENCE medal_id_seq                    RESTART WITH 1;

-- Master data
ALTER SEQUENCE students_id_seq                 RESTART WITH 1;
ALTER SEQUENCE modules_id_seq                  RESTART WITH 1;
ALTER SEQUENCE centers_id_seq                  RESTART WITH 1;

COMMIT;