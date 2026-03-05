require("dotenv").config({ path: ".env.test" });

const request = require("supertest");
const app = require("./setup/testApp");
const {
  truncateAll,
  seedCenter,
  seedUser,
  closeDb,
  pool,
} = require("./setup/testDb");

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

// ============================================================
// HELPER: simulasi login dengan inject session manual
// ============================================================

const loginAs = async (user) => {
  const agent = request.agent(app);

  // Inject user ke session via endpoint khusus test
  await agent.post("/__test/login").send({ userId: user.id });

  return agent;
};

describe("GET /auth/me", () => {
  let center, superAdmin, admin, teacher;

  beforeAll(async () => {
    center = await seedCenter({ name: "Center Auth Test" });

    superAdmin = await seedUser({
      email: "superadmin@test.com",
      name: "Super Admin",
      role: "super_admin",
      is_active: true,
    });

    admin = await seedUser({
      email: "admin@test.com",
      name: "Admin Test",
      role: "admin",
      center_id: center.id,
      is_active: true,
    });

    teacher = await seedUser({
      email: "teacher@test.com",
      name: "Teacher Test",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });
  });

  test("401 jika tidak login", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("super_admin berhasil get /me", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe("super_admin");
    expect(res.body.data.email).toBe("superadmin@test.com");
  });

  test("admin berhasil get /me", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("admin");
    expect(res.body.data.center_id).toBe(center.id);
  });

  test("teacher berhasil get /me", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/auth/me");

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("teacher");
  });

  test("response tidak mengandung field sensitif", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/auth/me");

    expect(res.body.data).not.toHaveProperty("google_id");
    expect(res.body.data).not.toHaveProperty("is_active");
    expect(res.body.data).not.toHaveProperty("created_at");
  });
});

describe("POST /auth/logout", () => {
  let teacher;

  beforeAll(async () => {
    const center = await seedCenter({ name: "Center Logout Test" });
    teacher = await seedUser({
      email: "teacher.logout@test.com",
      name: "Teacher Logout",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });
  });

  test("401 jika tidak login", async () => {
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(401);
  });

  test("berhasil logout", async () => {
    const agent = await loginAs(teacher);

    const res = await agent.post("/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("session dihapus setelah logout", async () => {
    const agent = await loginAs(teacher);

    await agent.post("/auth/logout");

    const res = await agent.get("/auth/me");
    expect(res.status).toBe(401);
  });
});

// ============================================================
// SESSION REVALIDATION
// ============================================================

describe("Session Revalidation — Cache Staleness", () => {
  let center, activeUser;

  beforeAll(async () => {
    center = await seedCenter({ name: "Center Revalidation Test" });

    activeUser = await seedUser({
      email: "user.revalidate@test.com",
      name: "User Revalidate",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });
  });

  test("user aktif bisa akses endpoint normal", async () => {
    const agent = await loginAs(activeUser);
    const res = await agent.get("/auth/me");

    expect(res.status).toBe(200);
  });

  test("401 setelah user di-deactivate — cache stale terdeteksi", async () => {
    const agent = await loginAs(activeUser);

    // Pastikan dulu bisa akses
    const before = await agent.get("/auth/me");
    expect(before.status).toBe(200);

    // Deactivate langsung di DB (simulasi admin deactivate dari luar session ini)
    await pool.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [activeUser.id],
    );

    // Request berikutnya harus ditolak karena cache stale → refresh → is_active false
    const after = await agent.get("/auth/me");
    expect(after.status).toBe(401);

    // Restore untuk test lain
    await pool.query(
      `UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE id = $1`,
      [activeUser.id],
    );
  });

  test("user yang di-reactivate bisa akses kembali setelah login ulang", async () => {
    // User dimatikan lalu dihidupkan lagi
    await pool.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [activeUser.id],
    );
    await pool.query(
      `UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE id = $1`,
      [activeUser.id],
    );

    // Login ulang (session baru)
    const agent = await loginAs(activeUser);
    const res = await agent.get("/auth/me");

    expect(res.status).toBe(200);
  });

  test("perubahan nama user terefleksi setelah cache stale", async () => {
    const agent = await loginAs(activeUser);

    // Pastikan nama awal
    const before = await agent.get("/auth/me");
    expect(before.status).toBe(200);
    expect(before.body.data.name).toBe("User Revalidate");

    // Update nama langsung di DB
    await pool.query(
      `UPDATE users SET name = 'User Revalidate Updated', updated_at = NOW() WHERE id = $1`,
      [activeUser.id],
    );

    // Cache masih valid di request langsung berikutnya (dalam 30 detik)
    // Tapi jika stale check interval sudah lewat, nama baru harus muncul
    // Untuk test ini: paksa cache expire dengan manipulasi waktu tidak praktis,
    // jadi kita verifikasi lewat login ulang
    const freshAgent = await loginAs(activeUser);
    const after = await freshAgent.get("/auth/me");

    expect(after.status).toBe(200);
    expect(after.body.data.name).toBe("User Revalidate Updated");

    // Restore
    await pool.query(
      `UPDATE users SET name = 'User Revalidate', updated_at = NOW() WHERE id = $1`,
      [activeUser.id],
    );
  });

  test("teacher multi-center: center_ids terupdate setelah center baru di-assign", async () => {
    // Verifikasi bahwa session fresh mencerminkan center assignment terbaru
    const mcCenter = await seedCenter({ name: "MC Session Test Center" });

    // Assign center baru langsung di DB
    await pool.query(
      `INSERT INTO teacher_centers (teacher_id, center_id, is_primary)
       VALUES ($1, $2, FALSE)
       ON CONFLICT DO NOTHING`,
      [activeUser.id, mcCenter.id],
    );

    // Login ulang → session baru harus punya center_ids yang updated
    const freshAgent = await loginAs(activeUser);
    const res = await freshAgent.get("/auth/me");

    expect(res.status).toBe(200);
    // center_ids tidak wajib di-expose di /me, tapi request ke endpoint teacher harus berhasil
    // Verifikasi: teacher bisa lihat stock center baru
    const stockRes = await freshAgent.get("/api/teacher/stock");
    expect(stockRes.status).toBe(200);
  });
});
