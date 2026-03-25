CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. SESSION
CREATE TABLE IF NOT EXISTS session (
  sid     VARCHAR       NOT NULL COLLATE "default" PRIMARY KEY,
  sess    JSON          NOT NULL,
  expire  TIMESTAMP(6)  NOT NULL
);

-- 2. CENTERS
CREATE TABLE IF NOT EXISTS centers (
  id               SERIAL        PRIMARY KEY,
  name             VARCHAR(255)  NOT NULL,
  address          TEXT,
  drive_folder_id  TEXT,
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- 3. USERS
CREATE TABLE IF NOT EXISTS users (
  id               SERIAL        PRIMARY KEY,
  google_id        VARCHAR(255)  UNIQUE,
  email            VARCHAR(255)  UNIQUE NOT NULL,
  name             VARCHAR(255)  NOT NULL,
  avatar           TEXT,
  role             VARCHAR(20)   NOT NULL
                                 CHECK (role IN ('super_admin', 'admin', 'teacher')),
  center_id        INTEGER       REFERENCES centers (id) ON DELETE SET NULL,
  drive_folder_id  TEXT,
  is_active        BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- 4. TEACHER_CENTERS (junction — multi-center support)
CREATE TABLE IF NOT EXISTS teacher_centers (
  teacher_id       INTEGER   NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
  center_id        INTEGER   NOT NULL REFERENCES centers (id)  ON DELETE CASCADE,
  is_primary       BOOLEAN   NOT NULL DEFAULT FALSE,
  drive_folder_id  TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (teacher_id, center_id)
);

-- 5. MODULES
CREATE TABLE IF NOT EXISTS modules (
  id          SERIAL        PRIMARY KEY,
  code        VARCHAR(100)  NOT NULL,
  name        VARCHAR(255)  NOT NULL,
  description TEXT,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- 6. STUDENTS
CREATE TABLE IF NOT EXISTS students (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  center_id   INTEGER      NOT NULL REFERENCES centers (id) ON DELETE RESTRICT,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- 7. ENROLLMENTS
CREATE TABLE IF NOT EXISTS enrollments (
  id               SERIAL    PRIMARY KEY,
  student_id       INTEGER   NOT NULL REFERENCES students (id)  ON DELETE RESTRICT,
  module_id        INTEGER   NOT NULL REFERENCES modules (id)   ON DELETE RESTRICT,
  center_id        INTEGER   NOT NULL REFERENCES centers (id)   ON DELETE RESTRICT,
  teacher_id       INTEGER   REFERENCES users (id)              ON DELETE SET NULL,
  drive_folder_id  TEXT,
  is_active        BOOLEAN   NOT NULL DEFAULT TRUE,
  enrolled_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 8. CERTIFICATE_STOCK
--    Dipertahankan hanya untuk menyimpan low_stock_threshold per center.
--    Quantity aktual kini dihitung dari certificate_stock_batches.
CREATE TABLE IF NOT EXISTS certificate_stock (
  id                   SERIAL    PRIMARY KEY,
  center_id            INTEGER   NOT NULL UNIQUE REFERENCES centers (id) ON DELETE CASCADE,
  quantity             INTEGER   NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold  INTEGER   NOT NULL DEFAULT 10,
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 9. MEDAL_STOCK
CREATE TABLE IF NOT EXISTS medal_stock (
  id                   SERIAL    PRIMARY KEY,
  center_id            INTEGER   NOT NULL UNIQUE REFERENCES centers (id) ON DELETE CASCADE,
  quantity             INTEGER   NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold  INTEGER   NOT NULL DEFAULT 10,
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 10. CERTIFICATE_STOCK_BATCHES
--     Mekanisme utama penomoran sertifikat.
--     range_start..range_end = rentang nomor yang dialokasikan ke center.
--     current_position = nomor berikutnya yang akan di-assign.
CREATE TABLE IF NOT EXISTS certificate_stock_batches (
  id                SERIAL    PRIMARY KEY,
  center_id         INTEGER   NOT NULL UNIQUE REFERENCES centers (id) ON DELETE RESTRICT,
  range_start       INTEGER   NOT NULL,
  range_end         INTEGER   NOT NULL,
  current_position  INTEGER   NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_range_valid
    CHECK (range_start <= range_end),
  CONSTRAINT chk_position_valid
    CHECK (current_position >= range_start AND current_position <= range_end + 1)
);

-- 11. REPORTS
CREATE TABLE IF NOT EXISTS reports (
  id                       SERIAL       PRIMARY KEY,
  enrollment_id            INTEGER      NOT NULL UNIQUE
                                        REFERENCES enrollments (id) ON DELETE CASCADE,
  teacher_id               INTEGER      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  academic_year            VARCHAR(20),
  period                   VARCHAR(100),
  score_creativity         VARCHAR(3)   CHECK (score_creativity        IN ('A+','A','B+','B')),
  score_critical_thinking  VARCHAR(3)   CHECK (score_critical_thinking IN ('A+','A','B+','B')),
  score_attention          VARCHAR(3)   CHECK (score_attention          IN ('A+','A','B+','B')),
  score_responsibility     VARCHAR(3)   CHECK (score_responsibility     IN ('A+','A','B+','B')),
  score_coding_skills      VARCHAR(3)   CHECK (score_coding_skills      IN ('A+','A','B+','B')),
  content                  TEXT,
  word_count               INTEGER      NOT NULL DEFAULT 0,
  is_draft                 BOOLEAN      NOT NULL DEFAULT TRUE,
  drive_file_id            TEXT,
  drive_file_name          TEXT,
  drive_uploaded_at        TIMESTAMP,
  created_at               TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- 12. CERTIFICATES
CREATE TABLE IF NOT EXISTS certificates (
  id                SERIAL       PRIMARY KEY,
  cert_unique_id    VARCHAR(50)  NOT NULL UNIQUE,
  enrollment_id     INTEGER      NOT NULL REFERENCES enrollments (id)   ON DELETE RESTRICT,
  teacher_id        INTEGER      NOT NULL REFERENCES users (id)          ON DELETE RESTRICT,
  center_id         INTEGER      NOT NULL REFERENCES centers (id)        ON DELETE RESTRICT,
  report_id         INTEGER      REFERENCES reports (id)       ON DELETE SET NULL,
  ptc_date          DATE         NOT NULL,
  is_reprint        BOOLEAN      NOT NULL DEFAULT FALSE,
  original_cert_id  INTEGER      REFERENCES certificates (id)  ON DELETE SET NULL,
  batch_id          UUID,
  scan_file_id      TEXT,
  scan_file_name    TEXT,
  scan_uploaded_at  TIMESTAMP,
  printed_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- 13. MEDALS
CREATE TABLE IF NOT EXISTS medals (
  id               SERIAL       PRIMARY KEY,
  medal_unique_id  VARCHAR(50)  NOT NULL UNIQUE,
  enrollment_id    INTEGER      NOT NULL REFERENCES enrollments (id)  ON DELETE RESTRICT,
  teacher_id       INTEGER      NOT NULL REFERENCES users (id)         ON DELETE RESTRICT,
  center_id        INTEGER      NOT NULL REFERENCES centers (id)       ON DELETE RESTRICT,
  report_id        INTEGER      REFERENCES reports (id)      ON DELETE SET NULL,
  ptc_date         DATE         NOT NULL,
  batch_id         UUID,
  printed_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);


-- ============================================================
-- UNIQUE INDEXES
-- ============================================================

-- Satu student hanya boleh punya satu enrollment aktif
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_enrollment
  ON enrollments (student_id)
  WHERE is_active = TRUE;

-- Satu teacher hanya boleh punya satu primary center
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_centers_one_primary
  ON teacher_centers (teacher_id)
  WHERE is_primary = TRUE;

-- Module code unik (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_code ON modules (UPPER(code));


-- ============================================================
-- SEQUENCE (medal — cert memakai certificate_stock_batches)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS medal_id_seq START 1;


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_session_expire                  ON session (expire);
CREATE INDEX IF NOT EXISTS idx_centers_is_active               ON centers (is_active);
CREATE INDEX IF NOT EXISTS idx_users_google_id                 ON users (google_id);
CREATE INDEX IF NOT EXISTS idx_users_email                     ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role                      ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_center_id                 ON users (center_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active                 ON users (is_active);
CREATE INDEX IF NOT EXISTS idx_teacher_centers_teacher_id      ON teacher_centers (teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_centers_center_id       ON teacher_centers (center_id);
CREATE INDEX IF NOT EXISTS idx_students_center_id              ON students (center_id);
CREATE INDEX IF NOT EXISTS idx_students_is_active              ON students (is_active);
CREATE INDEX IF NOT EXISTS idx_students_name                   ON students (name);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id          ON enrollments (student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_teacher_id          ON enrollments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_center_id           ON enrollments (center_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_module_id           ON enrollments (module_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_is_active           ON enrollments (is_active);
CREATE INDEX IF NOT EXISTS idx_cert_stock_batches_center_id    ON certificate_stock_batches (center_id);
CREATE INDEX IF NOT EXISTS idx_reports_enrollment_id           ON reports (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_reports_teacher_id              ON reports (teacher_id);
CREATE INDEX IF NOT EXISTS idx_reports_is_draft                ON reports (is_draft);
CREATE INDEX IF NOT EXISTS idx_reports_drive_uploaded_at       ON reports (drive_uploaded_at);
CREATE INDEX IF NOT EXISTS idx_certs_enrollment_id             ON certificates (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_certs_teacher_id                ON certificates (teacher_id);
CREATE INDEX IF NOT EXISTS idx_certs_center_id                 ON certificates (center_id);
CREATE INDEX IF NOT EXISTS idx_certs_is_reprint                ON certificates (is_reprint);
CREATE INDEX IF NOT EXISTS idx_certs_printed_at                ON certificates (printed_at);
CREATE INDEX IF NOT EXISTS idx_certs_ptc_date                  ON certificates (ptc_date);
CREATE INDEX IF NOT EXISTS idx_certs_batch_id                  ON certificates (batch_id);
CREATE INDEX IF NOT EXISTS idx_certs_scan_uploaded_at          ON certificates (scan_uploaded_at);
CREATE INDEX IF NOT EXISTS idx_medals_enrollment_id            ON medals (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_medals_teacher_id               ON medals (teacher_id);
CREATE INDEX IF NOT EXISTS idx_medals_center_id                ON medals (center_id);
CREATE INDEX IF NOT EXISTS idx_medals_printed_at               ON medals (printed_at);
CREATE INDEX IF NOT EXISTS idx_medals_ptc_date                 ON medals (ptc_date);
CREATE INDEX IF NOT EXISTS idx_medals_batch_id                 ON medals (batch_id);


-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Certificate Batch ────────────────────────────────────────

-- Assign cert_unique_id dari batch milik center
CREATE OR REPLACE FUNCTION fn_assign_cert_from_batch(p_center_id INTEGER)
RETURNS VARCHAR AS $$
DECLARE
  v_position  INTEGER;
  v_range_end INTEGER;
BEGIN
  SELECT current_position, range_end
  INTO   v_position, v_range_end
  FROM   certificate_stock_batches
  WHERE  center_id = p_center_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No certificate batch found for center_id %', p_center_id;
  END IF;

  IF v_position > v_range_end THEN
    RAISE EXCEPTION 'Certificate stock exhausted for center_id %', p_center_id;
  END IF;

  UPDATE certificate_stock_batches
  SET    current_position = current_position + 1,
         updated_at       = NOW()
  WHERE  center_id = p_center_id;

  RETURN 'CERT-' || LPAD(v_position::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Trigger function: set cert_unique_id otomatis saat INSERT
CREATE OR REPLACE FUNCTION fn_set_cert_unique_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cert_unique_id IS NULL OR NEW.cert_unique_id = '' THEN
    NEW.cert_unique_id := fn_assign_cert_from_batch(NEW.center_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tambah atau extend batch sertifikat untuk satu center
CREATE OR REPLACE FUNCTION fn_add_certificate_batch(
  p_center_id   INTEGER,
  p_range_start INTEGER,
  p_range_end   INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_existing RECORD;
BEGIN
  IF p_range_start > p_range_end THEN
    RAISE EXCEPTION 'range_start must be <= range_end';
  END IF;
  IF p_range_start <= 0 OR p_range_end <= 0 THEN
    RAISE EXCEPTION 'range_start and range_end must be positive integers';
  END IF;

  SELECT * INTO v_existing
  FROM   certificate_stock_batches
  WHERE  center_id = p_center_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO certificate_stock_batches
      (center_id, range_start, range_end, current_position)
    VALUES
      (p_center_id, p_range_start, p_range_end, p_range_start);

    RETURN jsonb_build_object(
      'action',           'created',
      'center_id',        p_center_id,
      'range_start',      p_range_start,
      'range_end',        p_range_end,
      'current_position', p_range_start,
      'available',        p_range_end - p_range_start + 1
    );
  ELSE
    IF p_range_end <= v_existing.range_end THEN
      RAISE EXCEPTION 'New range_end (%) must be greater than existing range_end (%)',
        p_range_end, v_existing.range_end;
    END IF;

    UPDATE certificate_stock_batches
    SET    range_end  = p_range_end,
           updated_at = NOW()
    WHERE  center_id = p_center_id;

    RETURN jsonb_build_object(
      'action',           'extended',
      'center_id',        p_center_id,
      'range_start',      v_existing.range_start,
      'range_end',        p_range_end,
      'current_position', v_existing.current_position,
      'available',        p_range_end - v_existing.current_position + 1
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_transfer_certificate_batch(
  p_from_center INTEGER,
  p_to_center   INTEGER,
  p_quantity    INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_from           RECORD;
  v_to             RECORD;
  v_transfer_start INTEGER;
  v_transfer_end   INTEGER;
  v_available      INTEGER;
  v_lock_first     INTEGER;
  v_lock_second    INTEGER;
BEGIN
  IF p_from_center = p_to_center THEN
    RAISE EXCEPTION 'Source and destination centers must be different';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  v_lock_first  := LEAST(p_from_center, p_to_center);
  v_lock_second := GREATEST(p_from_center, p_to_center);

  PERFORM id
  FROM    certificate_stock_batches
  WHERE   center_id = v_lock_first
  FOR UPDATE;

  PERFORM id
  FROM    certificate_stock_batches
  WHERE   center_id = v_lock_second
  FOR UPDATE;

  SELECT * INTO v_from
  FROM   certificate_stock_batches
  WHERE  center_id = p_from_center;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No batch found for source center_id %', p_from_center;
  END IF;

  v_available := v_from.range_end - v_from.current_position + 1;
  IF p_quantity > v_available THEN
    RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %',
      v_available, p_quantity;
  END IF;

  v_transfer_end   := v_from.range_end;
  v_transfer_start := v_from.range_end - p_quantity + 1;

  UPDATE certificate_stock_batches
  SET    range_end  = v_transfer_start - 1,
         updated_at = NOW()
  WHERE  center_id = p_from_center;

  SELECT * INTO v_to
  FROM   certificate_stock_batches
  WHERE  center_id = p_to_center;

  IF NOT FOUND THEN
    INSERT INTO certificate_stock_batches
      (center_id, range_start, range_end, current_position)
    VALUES
      (p_to_center, v_transfer_start, v_transfer_end, v_transfer_start);
  ELSE
    IF v_transfer_start != v_to.range_end + 1 THEN
      RAISE EXCEPTION
        'Transfer range is not contiguous with destination batch. Destination ends at %, transfer starts at %',
        v_to.range_end, v_transfer_start;
    END IF;

    UPDATE certificate_stock_batches
    SET    range_end  = v_transfer_end,
           updated_at = NOW()
    WHERE  center_id = p_to_center;
  END IF;

  RETURN jsonb_build_object(
    'from_center_id',  p_from_center,
    'to_center_id',    p_to_center,
    'transfer_start',  v_transfer_start,
    'transfer_end',    v_transfer_end,
    'quantity',        p_quantity,
    'from_remaining',  v_transfer_start - 1 - v_from.range_start + 1
  );
END;
$$ LANGUAGE plpgsql;

-- ── Medal Stock ──────────────────────────────────────────────

-- Kurangi stock medal (dengan lock)
CREATE OR REPLACE FUNCTION fn_decrement_medal_stock(
  p_center_id INTEGER,
  p_quantity  INTEGER DEFAULT 1
)
RETURNS JSONB AS $$
DECLARE
  v_quantity  INTEGER;
  v_threshold INTEGER;
BEGIN
  UPDATE medal_stock
  SET    quantity   = quantity - p_quantity,
         updated_at = NOW()
  WHERE  center_id = p_center_id
    AND  quantity  >= p_quantity
  RETURNING quantity, low_stock_threshold
  INTO v_quantity, v_threshold;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock medali tidak mencukupi atau center_id % tidak ditemukan', p_center_id;
  END IF;

  RETURN jsonb_build_object(
    'quantity',  v_quantity,
    'low_stock', v_quantity <= v_threshold
  );
END;
$$ LANGUAGE plpgsql;

-- Transfer medal stock antar center
CREATE OR REPLACE FUNCTION fn_transfer_stock(
  p_type        VARCHAR,
  p_from_center INTEGER,
  p_to_center   INTEGER,
  p_quantity    INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_from_qty INTEGER;
  v_to_qty   INTEGER;
BEGIN
  IF p_type NOT IN ('certificate', 'medal') THEN
    RAISE EXCEPTION 'Tipe tidak valid. Gunakan: certificate atau medal';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity harus lebih dari 0';
  END IF;
  IF p_from_center = p_to_center THEN
    RAISE EXCEPTION 'Center asal dan tujuan tidak boleh sama';
  END IF;

  IF p_type = 'medal' THEN
    UPDATE medal_stock
    SET    quantity   = quantity - p_quantity,
           updated_at = NOW()
    WHERE  center_id = p_from_center
      AND  quantity  >= p_quantity
    RETURNING quantity INTO v_from_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock tidak mencukupi atau center_id % tidak ditemukan', p_from_center;
    END IF;

    UPDATE medal_stock
    SET    quantity   = quantity + p_quantity,
           updated_at = NOW()
    WHERE  center_id = p_to_center
    RETURNING quantity INTO v_to_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Center tujuan dengan center_id % tidak ditemukan', p_to_center;
    END IF;
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

-- ── Report → Prints linking ──────────────────────────────────

-- Setelah report dibuat, link report_id ke cert & medal yang belum punya report
CREATE OR REPLACE FUNCTION fn_link_report_to_prints()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE certificates
  SET    report_id = NEW.id
  WHERE  enrollment_id = NEW.enrollment_id
    AND  report_id IS NULL;

  UPDATE medals
  SET    report_id = NEW.id
  WHERE  enrollment_id = NEW.enrollment_id
    AND  report_id IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Medal unique ID ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_generate_medal_id()
RETURNS VARCHAR AS $$
BEGIN
  RETURN 'MEDAL-' || LPAD(nextval('medal_id_seq')::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_set_medal_unique_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.medal_unique_id IS NULL OR NEW.medal_unique_id = '' THEN
    NEW.medal_unique_id := fn_generate_medal_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS trg_centers_updated_at ON centers;
CREATE TRIGGER trg_centers_updated_at
  BEFORE UPDATE ON centers
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_modules_updated_at ON modules;
CREATE TRIGGER trg_modules_updated_at
  BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_students_updated_at ON students;
CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_enrollments_updated_at ON enrollments;
CREATE TRIGGER trg_enrollments_updated_at
  BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_cert_stock_batches_updated_at ON certificate_stock_batches;
CREATE TRIGGER trg_cert_stock_batches_updated_at
  BEFORE UPDATE ON certificate_stock_batches
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

DROP TRIGGER IF EXISTS trg_certificates_unique_id ON certificates;
CREATE TRIGGER trg_certificates_unique_id
  BEFORE INSERT ON certificates
  FOR EACH ROW EXECUTE FUNCTION fn_set_cert_unique_id();

DROP TRIGGER IF EXISTS trg_medals_unique_id ON medals;
CREATE TRIGGER trg_medals_unique_id
  BEFORE INSERT ON medals
  FOR EACH ROW EXECUTE FUNCTION fn_set_medal_unique_id();

DROP TRIGGER IF EXISTS trg_reports_link_to_prints ON reports;
CREATE TRIGGER trg_reports_link_to_prints
  AFTER INSERT ON reports
  FOR EACH ROW EXECUTE FUNCTION fn_link_report_to_prints();


-- ============================================================
-- VIEWS
-- ============================================================
CREATE OR REPLACE VIEW vw_enrollment_status AS
SELECT
  e.id                                                             AS enrollment_id,
  s.name                                                           AS student_name,
  m.name                                                           AS module_name,
  u.name                                                           AS teacher_name,
  c.name                                                           AS center_name,
  COUNT(DISTINCT cert.id) FILTER (WHERE cert.is_reprint = FALSE)  AS cert_printed_count,
  COUNT(DISTINCT cert.id) FILTER (WHERE cert.is_reprint = TRUE)   AS cert_reprint_count,
  MAX(cert.printed_at)                                             AS last_cert_printed_at,
  BOOL_OR(cert.scan_file_id IS NOT NULL)                          AS cert_scan_uploaded,
  MAX(cert.scan_uploaded_at)                                       AS last_scan_uploaded_at,
  COUNT(DISTINCT med.id)                                           AS medal_printed_count,
  MAX(med.printed_at)                                              AS last_medal_printed_at,
  r.id                                                             AS report_id,
  r.is_draft                                                       AS report_is_draft,
  r.drive_file_id                                                  AS report_drive_file_id,
  r.drive_uploaded_at                                              AS report_uploaded_at,
  CASE
    WHEN r.drive_file_id IS NOT NULL            THEN 'complete'
    WHEN r.id IS NOT NULL AND r.is_draft = TRUE THEN 'report_drafted'
    WHEN BOOL_OR(cert.scan_file_id IS NOT NULL) THEN 'scan_uploaded'
    WHEN COUNT(DISTINCT cert.id) > 0            THEN 'cert_printed'
    ELSE                                             'pending'
  END                                                              AS enrollment_status
FROM       enrollments  e
JOIN       students     s    ON s.id = e.student_id
JOIN       modules      m    ON m.id = e.module_id
JOIN       users        u    ON u.id = e.teacher_id
JOIN       centers      c    ON c.id = e.center_id
LEFT JOIN  certificates cert ON cert.enrollment_id = e.id
LEFT JOIN  medals       med  ON med.enrollment_id  = e.id
LEFT JOIN  reports      r    ON r.enrollment_id    = e.id
GROUP BY
  e.id, s.name, m.name, u.name, c.name,
  r.id, r.is_draft, r.drive_file_id, r.drive_uploaded_at;

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
  cert.scan_file_id,
  cert.scan_uploaded_at,
  r.id                  AS report_id,
  r.is_draft            AS report_is_draft,
  r.drive_file_id       AS report_drive_file_id,
  r.drive_uploaded_at   AS report_uploaded_at,
  CASE
    WHEN r.drive_file_id   IS NOT NULL              THEN 'complete'
    WHEN r.id IS NOT NULL AND r.is_draft = TRUE     THEN 'report_drafted'
    WHEN r.id IS NOT NULL                           THEN 'complete'
    WHEN cert.scan_file_id IS NOT NULL              THEN 'scan_uploaded'
    WHEN cert.id           IS NOT NULL              THEN 'cert_printed'
    ELSE                                                 'not_started'
  END                   AS upload_status
FROM       enrollments  e
JOIN       users        u    ON u.id = e.teacher_id
JOIN       centers      c    ON c.id = e.center_id
JOIN       students     s    ON s.id = e.student_id
JOIN       modules      m    ON m.id = e.module_id
LEFT JOIN LATERAL (
  SELECT id, scan_file_id, scan_uploaded_at
  FROM   certificates
  WHERE  enrollment_id = e.id
  ORDER  BY printed_at DESC
  LIMIT  1
) cert ON TRUE
LEFT JOIN reports r ON r.enrollment_id = e.id
WHERE u.is_active = TRUE;


CREATE OR REPLACE VIEW vw_monthly_center_activity AS
WITH cert_monthly AS (
  SELECT
    center_id,
    DATE_TRUNC('month', printed_at)                          AS month,
    COUNT(*) FILTER (WHERE is_reprint = FALSE)               AS cert_printed,
    COUNT(*) FILTER (WHERE is_reprint = TRUE)                AS cert_reprinted,
    COUNT(*) FILTER (WHERE scan_file_id IS NOT NULL)         AS cert_scan_uploaded
  FROM   certificates
  GROUP  BY center_id, DATE_TRUNC('month', printed_at)
),
medal_monthly AS (
  SELECT
    center_id,
    DATE_TRUNC('month', printed_at) AS month,
    COUNT(*)                        AS medal_printed
  FROM   medals
  GROUP  BY center_id, DATE_TRUNC('month', printed_at)
),
all_months AS (
  SELECT center_id, month FROM cert_monthly
  UNION
  SELECT center_id, month FROM medal_monthly
)
SELECT
  c.id                                                AS center_id,
  c.name                                              AS center_name,
  am.month,
  COALESCE(cm.cert_printed, 0)                       AS cert_printed,
  COALESCE(cm.cert_reprinted, 0)                     AS cert_reprinted,
  COALESCE(cm.cert_scan_uploaded, 0)                 AS cert_scan_uploaded,
  COALESCE(mm.medal_printed, 0)                      AS medal_printed,
  COALESCE(cm.cert_printed, 0)
    + COALESCE(mm.medal_printed, 0)                  AS total_issued
FROM       all_months   am
JOIN       centers      c   ON c.id = am.center_id
LEFT JOIN  cert_monthly cm  ON cm.center_id = am.center_id AND cm.month = am.month
LEFT JOIN  medal_monthly mm ON mm.center_id = am.center_id AND mm.month = am.month
WHERE  c.is_active = TRUE
ORDER  BY am.month DESC, c.name;


CREATE OR REPLACE VIEW vw_stock_alerts AS
SELECT
  c.id                                                              AS center_id,
  c.name                                                            AS center_name,
  COALESCE(b.range_end - b.current_position + 1, 0)                AS cert_quantity,
  COALESCE(cs.low_stock_threshold, 10)                             AS cert_threshold,
  COALESCE(b.range_end - b.current_position + 1, 0)
    <= COALESCE(cs.low_stock_threshold, 10)                        AS cert_low_stock,
  b.range_start                                                     AS cert_range_start,
  b.range_end                                                       AS cert_range_end,
  b.current_position                                                AS cert_current_position,
  ms.quantity                                                       AS medal_quantity,
  ms.low_stock_threshold                                            AS medal_threshold,
  ms.quantity <= ms.low_stock_threshold                             AS medal_low_stock,
  (
    COALESCE(b.range_end - b.current_position + 1, 0)
      <= COALESCE(cs.low_stock_threshold, 10)
    OR ms.quantity <= ms.low_stock_threshold
  )                                                                 AS has_alert
FROM       centers               c
LEFT JOIN  certificate_stock_batches b  ON b.center_id = c.id
LEFT JOIN  certificate_stock     cs     ON cs.center_id = c.id
LEFT JOIN  medal_stock           ms     ON ms.center_id = c.id
WHERE  c.is_active = TRUE;


-- ============================================================
-- MIGRATION: existing database
-- Run this if the database already exists
-- ============================================================

ALTER TABLE teacher_centers
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;


-- ============================================================
-- SEED DATA (uncomment & sesuaikan sebelum pertama kali run)
-- ============================================================

-- INSERT INTO users (email, name, role, is_active)
-- VALUES ('superadmin@gmail.com', 'Super Admin', 'super_admin', TRUE)
-- ON CONFLICT (email) DO NOTHING;