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
      certificate_stock,
      medal_stock,
      students,
      modules,
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
  return result.rows[0];
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
  description = null,
} = {}) => {
  const result = await pool.query(
    `INSERT INTO modules (name, description) VALUES ($1, $2) RETURNING *`,
    [name, description],
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

const setStock = async ({ center_id, cert_qty = 100, medal_qty = 100 }) => {
  await pool.query(
    `UPDATE certificate_stock SET quantity = $1 WHERE center_id = $2`,
    [cert_qty, center_id],
  );
  await pool.query(
    `UPDATE medal_stock SET quantity = $1 WHERE center_id = $2`,
    [medal_qty, center_id],
  );
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
  setStock,
  closeDb,
};
