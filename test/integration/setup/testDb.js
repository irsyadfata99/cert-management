require("dotenv").config({ path: ".env.test" });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const truncateAll = async () => {
  await pool.query(`
    TRUNCATE TABLE
      medals,
      certificates,
      reports,
      enrollments,
      certificate_stock_batches,
      certificate_stock,
      medal_stock,
      students,
      modules,
      teacher_centers,
      users,
      centers,
      session
    RESTART IDENTITY CASCADE
  `);
};

const seedCenter = async ({
  name = "Test Center",
  address = "Jl. Test No. 1",
} = {}) => {
  const result = await pool.query(
    `INSERT INTO centers (name, address, drive_folder_id)
     VALUES ($1, $2, 'dummy_folder_id')
     RETURNING *`,
    [name, address],
  );

  await pool.query(
    `INSERT INTO certificate_stock (center_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [result.rows[0].id],
  );
  await pool.query(
    `INSERT INTO medal_stock (center_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [result.rows[0].id],
  );

  return result.rows[0];
};

const seedUser = async ({
  email,
  name,
  role,
  center_id = null,
  is_active = true,
} = {}) => {
  const result = await pool.query(
    `INSERT INTO users (email, name, role, center_id, is_active, drive_folder_id)
     VALUES ($1, $2, $3, $4, $5, 'dummy_drive_folder')
     RETURNING *`,
    [email, name, role, center_id, is_active],
  );

  const user = result.rows[0];

  // Auto-seed teacher_centers jika user adalah teacher dan memiliki center_id
  if (role === "teacher" && center_id) {
    await pool.query(
      `INSERT INTO teacher_centers (teacher_id, center_id, is_primary)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (teacher_id, center_id) DO NOTHING`,
      [user.id, center_id],
    );
  }

  return user;
};

const seedStudent = async ({ name, center_id }) => {
  const result = await pool.query(
    `INSERT INTO students (name, center_id) VALUES ($1, $2) RETURNING *`,
    [name, center_id],
  );
  return result.rows[0];
};

const seedModule = async ({
  name = "Module Test",
  code = null,
  description = null,
} = {}) => {
  // Generate unique code jika tidak disediakan
  const moduleCode =
    code || `MOD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const result = await pool.query(
    `INSERT INTO modules (name, code, description) VALUES ($1, $2, $3) RETURNING *`,
    [name, moduleCode, description],
  );
  return result.rows[0];
};

const seedEnrollment = async ({
  student_id,
  module_id,
  center_id,
  teacher_id,
}) => {
  const result = await pool.query(
    `INSERT INTO enrollments (student_id, module_id, center_id, teacher_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [student_id, module_id, center_id, teacher_id],
  );
  return result.rows[0];
};

/**
 * Setup stock untuk satu center.
 * - medal_stock: update quantity langsung
 * - certificate_stock_batches: upsert batch (sumber kebenaran cert qty sejak schema v4.0)
 *   range_start default 1, range_end = cert_qty, current_position = 1
 *
 * Jika cert_qty = 0, hapus batch yang ada (simulasi stock habis).
 */
const setStock = async ({
  center_id,
  cert_qty = 100,
  medal_qty = 100,
  cert_range_start = 1,
}) => {
  // Medal stock — tetap pakai tabel medal_stock
  await pool.query(
    `UPDATE medal_stock SET quantity = $1, updated_at = NOW() WHERE center_id = $2`,
    [medal_qty, center_id],
  );

  if (cert_qty <= 0) {
    // Hapus batch agar simulasi "no stock" / "no batch"
    await pool.query(
      `DELETE FROM certificate_stock_batches WHERE center_id = $1`,
      [center_id],
    );
    return;
  }

  const range_end = cert_range_start + cert_qty - 1;

  // Upsert certificate_stock_batches
  // Jika sudah ada: extend range_end dan reset current_position ke range_start
  // Jika belum ada: insert baru
  await pool.query(
    `INSERT INTO certificate_stock_batches
       (center_id, range_start, range_end, current_position)
     VALUES ($1, $2, $3, $2)
     ON CONFLICT (center_id) DO UPDATE
       SET range_start       = EXCLUDED.range_start,
           range_end         = EXCLUDED.range_end,
           current_position  = EXCLUDED.range_start,
           updated_at        = NOW()`,
    [center_id, cert_range_start, range_end],
  );
};

/**
 * Seed certificate_stock_batches secara eksplisit dengan range yang ditentukan.
 * Berguna ketika test butuh kontrol penuh atas range (misal test transfer batch).
 */
const seedCertBatch = async ({
  center_id,
  range_start,
  range_end,
  current_position = null,
}) => {
  const pos = current_position ?? range_start;

  const result = await pool.query(
    `INSERT INTO certificate_stock_batches
       (center_id, range_start, range_end, current_position)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (center_id) DO UPDATE
       SET range_start      = EXCLUDED.range_start,
           range_end        = EXCLUDED.range_end,
           current_position = EXCLUDED.current_position,
           updated_at       = NOW()
     RETURNING *`,
    [center_id, range_start, range_end, pos],
  );

  return result.rows[0];
};

// Helper untuk assign teacher ke center tambahan
const seedTeacherCenter = async ({
  teacher_id,
  center_id,
  is_primary = false,
}) => {
  const result = await pool.query(
    `INSERT INTO teacher_centers (teacher_id, center_id, is_primary)
     VALUES ($1, $2, $3)
     ON CONFLICT (teacher_id, center_id) DO UPDATE SET is_primary = EXCLUDED.is_primary
     RETURNING *`,
    [teacher_id, center_id, is_primary],
  );
  return result.rows[0];
};

const closeDb = async () => {
  await pool.end();
};

module.exports = {
  pool,
  truncateAll,
  seedCenter,
  seedUser,
  seedStudent,
  seedModule,
  seedEnrollment,
  seedTeacherCenter,
  seedCertBatch,
  setStock,
  closeDb,
};
