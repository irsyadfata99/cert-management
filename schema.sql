-- ============================================================
-- SCHEMA: Certificate & Medal Management System
-- Version: 2.2 (Final)
-- Stack: PostgreSQL + Express.js + React (Vite)
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- 1. SESSION (untuk connect-pg-simple)
-- ============================================================
CREATE TABLE IF NOT EXISTS session (
  sid     VARCHAR       NOT NULL COLLATE "default" PRIMARY KEY,
  sess    JSON          NOT NULL,
  expire  TIMESTAMP(6)  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_expire
  ON session (expire);


-- ============================================================
-- 2. CENTERS (cabang)
-- ============================================================
CREATE TABLE IF NOT EXISTS centers (
  id               SERIAL        PRIMARY KEY,
  name             VARCHAR(255)  NOT NULL,
  address          TEXT,
  drive_folder_id  TEXT,
  -- ID folder Google Drive milik center ini
  -- diisi otomatis saat Super Admin tambah center
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP     NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 3. USERS (super_admin, admin, teacher dalam 1 tabel)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id               SERIAL        PRIMARY KEY,
  google_id        VARCHAR(255)  UNIQUE,
  -- NULL saat admin/teacher baru didaftarkan
  -- diisi saat user pertama kali login Google
  email            VARCHAR(255)  UNIQUE NOT NULL,
  name             VARCHAR(255)  NOT NULL,
  avatar           TEXT,
  role             VARCHAR(20)   NOT NULL
                                 CHECK (role IN ('super_admin', 'admin', 'teacher')),
  center_id        INTEGER       REFERENCES centers (id) ON DELETE SET NULL,
  -- super_admin : NULL
  -- admin       : NULL (akses semua center)
  -- teacher     : WAJIB diisi
  drive_folder_id  TEXT,
  -- ID folder Google Drive khusus milik teacher ini
  -- NULL untuk super_admin dan admin
  access_token     TEXT,
  refresh_token    TEXT,
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP     NOT NULL DEFAULT NOW(),

  -- Hanya teacher yang wajib punya center_id
  CONSTRAINT chk_teacher_has_center
    CHECK (role != 'teacher' OR center_id IS NOT NULL),

  -- Hanya teacher yang boleh punya drive_folder_id
  CONSTRAINT chk_drive_folder_only_teacher
    CHECK (role != 'teacher' OR drive_folder_id IS NOT NULL OR is_active = FALSE)
);


-- ============================================================
-- 4. MODULES (program / materi)
-- ============================================================
CREATE TABLE IF NOT EXISTS modules (
  id          SERIAL        PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,
  description TEXT,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 5. STUDENTS (murid per center)
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
  id          SERIAL        PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,
  center_id   INTEGER       NOT NULL REFERENCES centers (id) ON DELETE RESTRICT,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 6. ENROLLMENTS
-- 1 student hanya boleh punya 1 enrollment aktif dalam 1 waktu
-- re-enroll = nonaktifkan yang lama, buat record baru
-- ============================================================
CREATE TABLE IF NOT EXISTS enrollments (
  id               SERIAL    PRIMARY KEY,
  student_id       INTEGER   NOT NULL REFERENCES students (id) ON DELETE RESTRICT,
  module_id        INTEGER   NOT NULL REFERENCES modules (id)  ON DELETE RESTRICT,
  center_id        INTEGER   NOT NULL REFERENCES centers (id)  ON DELETE RESTRICT,
  teacher_id       INTEGER   REFERENCES users (id) ON DELETE SET NULL,
  drive_folder_id  TEXT,
  -- ID folder Google Drive untuk enrollment ini
  -- format: [StudentName - ModuleName] di dalam folder teacher
  is_active        BOOLEAN   NOT NULL DEFAULT TRUE,
  enrolled_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Pastikan 1 student hanya punya 1 enrollment aktif
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_enrollment
  ON enrollments (student_id)
  WHERE is_active = TRUE;


-- ============================================================
-- 7. CERTIFICATE_STOCK (per center, terpisah dari medal)
-- ============================================================
CREATE TABLE IF NOT EXISTS certificate_stock (
  id                   SERIAL   PRIMARY KEY,
  center_id            INTEGER  NOT NULL UNIQUE REFERENCES centers (id) ON DELETE CASCADE,
  quantity             INTEGER  NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold  INTEGER  NOT NULL DEFAULT 10,
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 8. MEDAL_STOCK (per center, terpisah dari certificate)
-- ============================================================
CREATE TABLE IF NOT EXISTS medal_stock (
  id                   SERIAL   PRIMARY KEY,
  center_id            INTEGER  NOT NULL UNIQUE REFERENCES centers (id) ON DELETE CASCADE,
  quantity             INTEGER  NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold  INTEGER  NOT NULL DEFAULT 10,
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 9. REPORTS
-- Teacher WAJIB upload PDF ke Drive sebelum bisa print
-- 1 enrollment hanya punya 1 report
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id                 SERIAL    PRIMARY KEY,
  enrollment_id      INTEGER   NOT NULL UNIQUE REFERENCES enrollments (id) ON DELETE CASCADE,
  teacher_id         INTEGER   NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  content            TEXT      NOT NULL,
  -- isi raport, minimum 200 kata (validasi di backend)
  word_count         INTEGER   NOT NULL DEFAULT 0,
  drive_file_id      TEXT,
  -- ID file PDF di Google Drive, NULL jika belum upload
  drive_file_name    TEXT,
  drive_uploaded_at  TIMESTAMP,
  -- diisi saat upload berhasil
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 10. CERTIFICATES
-- Setiap print (termasuk reprint) = 1 record baru
-- ============================================================
CREATE TABLE IF NOT EXISTS certificates (
  id                SERIAL        PRIMARY KEY,
  cert_unique_id    VARCHAR(50)   NOT NULL UNIQUE,
  -- format: CERT-{YYYY}-{NNNNN} contoh: CERT-2025-00001
  -- di-generate otomatis via trigger
  enrollment_id     INTEGER       NOT NULL REFERENCES enrollments (id) ON DELETE RESTRICT,
  teacher_id        INTEGER       NOT NULL REFERENCES users (id)       ON DELETE RESTRICT,
  center_id         INTEGER       NOT NULL REFERENCES centers (id)     ON DELETE RESTRICT,
  report_id         INTEGER       NOT NULL REFERENCES reports (id)     ON DELETE RESTRICT,
  -- wajib ada report yang sudah di-upload sebelum bisa print
  ptc_date          DATE          NOT NULL,
  -- tanggal PTC yang diinput teacher saat print (bukan tanggal print)
  is_reprint        BOOLEAN       NOT NULL DEFAULT FALSE,
  original_cert_id  INTEGER       REFERENCES certificates (id) ON DELETE SET NULL,
  -- NULL jika print pertama
  -- diisi dengan id certificate asli jika ini reprint
  printed_at        TIMESTAMP     NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 11. MEDALS
-- Setiap print = 1 record baru
-- TIDAK ada fitur reprint untuk medal
-- ============================================================
CREATE TABLE IF NOT EXISTS medals (
  id               SERIAL       PRIMARY KEY,
  medal_unique_id  VARCHAR(50)  NOT NULL UNIQUE,
  -- format: MEDAL-{YYYY}-{NNNNN} contoh: MEDAL-2025-00001
  -- di-generate otomatis via trigger
  enrollment_id    INTEGER      NOT NULL REFERENCES enrollments (id) ON DELETE RESTRICT,
  teacher_id       INTEGER      NOT NULL REFERENCES users (id)       ON DELETE RESTRICT,
  center_id        INTEGER      NOT NULL REFERENCES centers (id)     ON DELETE RESTRICT,
  report_id        INTEGER      NOT NULL REFERENCES reports (id)     ON DELETE RESTRICT,
  -- wajib ada report yang sudah di-upload sebelum bisa print
  ptc_date         DATE         NOT NULL,
  -- tanggal PTC yang diinput teacher saat print (bukan tanggal print)
  printed_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SEQUENCES untuk auto-generate unique ID
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS cert_id_seq  START 1;
CREATE SEQUENCE IF NOT EXISTS medal_id_seq START 1;


-- ============================================================
-- INDEXES
-- ============================================================

-- Centers
CREATE INDEX IF NOT EXISTS idx_centers_is_active
  ON centers (is_active);

-- Users
CREATE INDEX IF NOT EXISTS idx_users_google_id
  ON users (google_id);
CREATE INDEX IF NOT EXISTS idx_users_email
  ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role
  ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_center_id
  ON users (center_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active
  ON users (is_active);

-- Students
CREATE INDEX IF NOT EXISTS idx_students_center_id
  ON students (center_id);
CREATE INDEX IF NOT EXISTS idx_students_is_active
  ON students (is_active);
CREATE INDEX IF NOT EXISTS idx_students_name
  ON students (name);

-- Enrollments
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id
  ON enrollments (student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_teacher_id
  ON enrollments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_center_id
  ON enrollments (center_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_module_id
  ON enrollments (module_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_is_active
  ON enrollments (is_active);

-- Reports
CREATE INDEX IF NOT EXISTS idx_reports_enrollment_id
  ON reports (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_reports_teacher_id
  ON reports (teacher_id);
CREATE INDEX IF NOT EXISTS idx_reports_drive_uploaded_at
  ON reports (drive_uploaded_at);

-- Certificates
CREATE INDEX IF NOT EXISTS idx_certificates_enrollment_id
  ON certificates (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_certificates_teacher_id
  ON certificates (teacher_id);
CREATE INDEX IF NOT EXISTS idx_certificates_center_id
  ON certificates (center_id);
CREATE INDEX IF NOT EXISTS idx_certificates_is_reprint
  ON certificates (is_reprint);
CREATE INDEX IF NOT EXISTS idx_certificates_printed_at
  ON certificates (printed_at);
CREATE INDEX IF NOT EXISTS idx_certificates_ptc_date
  ON certificates (ptc_date);

-- Medals
CREATE INDEX IF NOT EXISTS idx_medals_enrollment_id
  ON medals (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_medals_teacher_id
  ON medals (teacher_id);
CREATE INDEX IF NOT EXISTS idx_medals_center_id
  ON medals (center_id);
CREATE INDEX IF NOT EXISTS idx_medals_printed_at
  ON medals (printed_at);
CREATE INDEX IF NOT EXISTS idx_medals_ptc_date
  ON medals (ptc_date);


-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update kolom updated_at
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Generate cert_unique_id: CERT-2025-00001
CREATE OR REPLACE FUNCTION fn_generate_cert_id()
RETURNS VARCHAR AS $$
BEGIN
  RETURN 'CERT-'  || TO_CHAR(NOW(), 'YYYY') || '-' ||
         LPAD(nextval('cert_id_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Generate medal_unique_id: MEDAL-2025-00001
CREATE OR REPLACE FUNCTION fn_generate_medal_id()
RETURNS VARCHAR AS $$
BEGIN
  RETURN 'MEDAL-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
         LPAD(nextval('medal_id_seq')::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Kurangi stock certificate + cek low stock
CREATE OR REPLACE FUNCTION fn_decrement_certificate_stock(p_center_id INTEGER)
RETURNS JSONB AS $$
DECLARE
  v_quantity   INTEGER;
  v_threshold  INTEGER;
BEGIN
  UPDATE certificate_stock
    SET quantity   = quantity - 1,
        updated_at = NOW()
    WHERE center_id = p_center_id
    RETURNING quantity, low_stock_threshold
    INTO v_quantity, v_threshold;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock sertifikat untuk center_id % tidak ditemukan', p_center_id;
  END IF;

  RETURN jsonb_build_object(
    'quantity',  v_quantity,
    'low_stock', v_quantity <= v_threshold
  );
END;
$$ LANGUAGE plpgsql;

-- Kurangi stock medal + cek low stock
CREATE OR REPLACE FUNCTION fn_decrement_medal_stock(p_center_id INTEGER)
RETURNS JSONB AS $$
DECLARE
  v_quantity   INTEGER;
  v_threshold  INTEGER;
BEGIN
  UPDATE medal_stock
    SET quantity   = quantity - 1,
        updated_at = NOW()
    WHERE center_id = p_center_id
    RETURNING quantity, low_stock_threshold
    INTO v_quantity, v_threshold;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock medali untuk center_id % tidak ditemukan', p_center_id;
  END IF;

  RETURN jsonb_build_object(
    'quantity',  v_quantity,
    'low_stock', v_quantity <= v_threshold
  );
END;
$$ LANGUAGE plpgsql;

-- Transfer stock antar center (certificate atau medal)
-- Dijalankan dalam 1 transaksi atomic di backend
-- Fungsi ini hanya helper validasi & update, transaksi dihandle di Node.js
CREATE OR REPLACE FUNCTION fn_transfer_stock(
  p_type        VARCHAR,   -- 'certificate' atau 'medal'
  p_from_center INTEGER,
  p_to_center   INTEGER,
  p_quantity    INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_from_qty  INTEGER;
  v_to_qty    INTEGER;
  v_table     VARCHAR;
BEGIN
  -- Validasi tipe
  IF p_type NOT IN ('certificate', 'medal') THEN
    RAISE EXCEPTION 'Tipe tidak valid. Gunakan certificate atau medal';
  END IF;

  -- Validasi quantity
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity harus lebih dari 0';
  END IF;

  v_table := CASE p_type
    WHEN 'certificate' THEN 'certificate_stock'
    WHEN 'medal'       THEN 'medal_stock'
  END;

  -- Kurangi from_center (dengan lock untuk mencegah race condition)
  IF p_type = 'certificate' THEN
    UPDATE certificate_stock
      SET quantity   = quantity - p_quantity,
          updated_at = NOW()
      WHERE center_id = p_from_center
        AND quantity  >= p_quantity
      RETURNING quantity INTO v_from_qty;
  ELSE
    UPDATE medal_stock
      SET quantity   = quantity - p_quantity,
          updated_at = NOW()
      WHERE center_id = p_from_center
        AND quantity  >= p_quantity
      RETURNING quantity INTO v_from_qty;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock tidak mencukupi atau center_id % tidak ditemukan', p_from_center;
  END IF;

  -- Tambah to_center
  IF p_type = 'certificate' THEN
    UPDATE certificate_stock
      SET quantity   = quantity + p_quantity,
          updated_at = NOW()
      WHERE center_id = p_to_center
      RETURNING quantity INTO v_to_qty;
  ELSE
    UPDATE medal_stock
      SET quantity   = quantity + p_quantity,
          updated_at = NOW()
      WHERE center_id = p_to_center
      RETURNING quantity INTO v_to_qty;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Center tujuan dengan center_id % tidak ditemukan', p_to_center;
  END IF;

  RETURN jsonb_build_object(
    'type',           p_type,
    'from_center_id', p_from_center,
    'to_center_id',   p_to_center,
    'quantity',       p_quantity,
    'from_remaining', v_from_qty,
    'to_new_total',   v_to_qty
  );
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto updated_at
CREATE TRIGGER trg_centers_updated_at
  BEFORE UPDATE ON centers
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_modules_updated_at
  BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_enrollments_updated_at
  BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- Auto-generate cert_unique_id sebelum INSERT
CREATE OR REPLACE FUNCTION fn_set_cert_unique_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cert_unique_id IS NULL OR NEW.cert_unique_id = '' THEN
    NEW.cert_unique_id := fn_generate_cert_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_certificates_unique_id
  BEFORE INSERT ON certificates
  FOR EACH ROW EXECUTE FUNCTION fn_set_cert_unique_id();

-- Auto-generate medal_unique_id sebelum INSERT
CREATE OR REPLACE FUNCTION fn_set_medal_unique_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.medal_unique_id IS NULL OR NEW.medal_unique_id = '' THEN
    NEW.medal_unique_id := fn_generate_medal_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_medals_unique_id
  BEFORE INSERT ON medals
  FOR EACH ROW EXECUTE FUNCTION fn_set_medal_unique_id();


-- ============================================================
-- VIEWS
-- ============================================================

-- Status upload report per teacher (untuk monitoring admin)
CREATE OR REPLACE VIEW vw_teacher_upload_status AS
SELECT
  u.id                  AS teacher_id,
  u.name                AS teacher_name,
  u.email               AS teacher_email,
  c.id                  AS center_id,
  c.name                AS center_name,
  e.id                  AS enrollment_id,
  s.name                AS student_name,
  m.name                AS module_name,
  r.id                  AS report_id,
  r.word_count,
  r.drive_file_id,
  r.drive_uploaded_at,
  CASE
    WHEN r.drive_file_id  IS NOT NULL THEN 'uploaded'
    WHEN r.id             IS NOT NULL THEN 'draft'
    ELSE                                   'not_started'
  END                   AS upload_status
FROM enrollments e
JOIN users    u ON u.id = e.teacher_id
JOIN centers  c ON c.id = e.center_id
JOIN students s ON s.id = e.student_id
JOIN modules  m ON m.id = e.module_id
LEFT JOIN reports r ON r.enrollment_id = e.id
WHERE e.is_active = TRUE
  AND u.is_active = TRUE;


-- Jumlah certificate & medal tercetak per center per bulan
CREATE OR REPLACE VIEW vw_monthly_center_activity AS
SELECT
  c.id                                                        AS center_id,
  c.name                                                      AS center_name,
  DATE_TRUNC('month', COALESCE(cert.printed_at, med.printed_at)) AS month,
  COUNT(DISTINCT cert.id) FILTER (WHERE cert.is_reprint = FALSE) AS cert_printed,
  COUNT(DISTINCT cert.id) FILTER (WHERE cert.is_reprint = TRUE)  AS cert_reprinted,
  COUNT(DISTINCT med.id)                                          AS medal_printed,
  COUNT(DISTINCT cert.id) + COUNT(DISTINCT med.id)               AS total_issued
FROM centers c
LEFT JOIN certificates cert ON cert.center_id = c.id
LEFT JOIN medals       med  ON med.center_id  = c.id
WHERE c.is_active = TRUE
GROUP BY
  c.id,
  c.name,
  DATE_TRUNC('month', COALESCE(cert.printed_at, med.printed_at))
ORDER BY month DESC, c.name;


-- Stock alert: center dengan stock di bawah threshold
CREATE OR REPLACE VIEW vw_stock_alerts AS
SELECT
  c.id                                          AS center_id,
  c.name                                        AS center_name,
  cs.quantity                                   AS cert_quantity,
  cs.low_stock_threshold                        AS cert_threshold,
  cs.quantity <= cs.low_stock_threshold         AS cert_low_stock,
  ms.quantity                                   AS medal_quantity,
  ms.low_stock_threshold                        AS medal_threshold,
  ms.quantity <= ms.low_stock_threshold         AS medal_low_stock,
  (
    cs.quantity <= cs.low_stock_threshold OR
    ms.quantity <= ms.low_stock_threshold
  )                                             AS has_alert
FROM centers c
LEFT JOIN certificate_stock cs ON cs.center_id = c.id
LEFT JOIN medal_stock       ms ON ms.center_id = c.id
WHERE c.is_active = TRUE;


-- ============================================================
-- SEED DATA
-- Uncomment dan sesuaikan sebelum dijalankan pertama kali
-- ============================================================

-- Super Admin pertama (ganti dengan email Google kamu)
-- INSERT INTO users (email, name, role)
-- VALUES ('superadmin@gmail.com', 'Super Admin', 'super_admin')
-- ON CONFLICT (email) DO NOTHING;