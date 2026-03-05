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

const loginAs = async (user) => {
  const agent = request.agent(app);
  await agent.post("/__test/login").send({ userId: user.id });
  return agent;
};

describe("GET /auth/me", () => {
  let center, superAdmin, admin, teacher;

  beforeAll(async () => {
    center = await seedCenter({ name: "Center Auth Test" });

    superAdmin = await seedUser({
      email: "superadmin.authme@test.com",
      name: "Super Admin",
      role: "super_admin",
      is_active: true,
    });

    admin = await seedUser({
      email: "admin.authme@test.com",
      name: "Admin Test",
      role: "admin",
      center_id: center.id,
      is_active: true,
    });

    teacher = await seedUser({
      email: "teacher.authme@test.com",
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
    expect(res.body.data.email).toBe("superadmin.authme@test.com");
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
      email: "teacher.logout.auth@test.com",
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
  // Email unik agar tidak bentrok dengan test file lain saat Jest jalan paralel
  let center, activeUser;

  beforeAll(async () => {
    center = await seedCenter({ name: "Center Revalidation Test" });

    activeUser = await seedUser({
      email: "user.revalidate.unique@test.com",
      name: "User Revalidate",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });
  });

  afterEach(async () => {
    // Restore user ke kondisi aktif setelah setiap test
    await pool.query(
      `UPDATE users SET is_active = TRUE, name = 'User Revalidate', updated_at = NOW() WHERE id = $1`,
      [activeUser.id],
    );
  });

  test("user aktif bisa akses endpoint normal", async () => {
    const agent = await loginAs(activeUser);
    const res = await agent.get("/auth/me");
    expect(res.status).toBe(200);
  });

  test("401 setelah user di-deactivate — cache stale terdeteksi", async () => {
    const agent = await loginAs(activeUser);

    const before = await agent.get("/auth/me");
    expect(before.status).toBe(200);

    // Set updated_at lebih baru dari cached_at agar stale check trigger
    await pool.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW() + INTERVAL '1 second' WHERE id = $1`,
      [activeUser.id],
    );

    const after = await agent.get("/auth/me");
    expect(after.status).toBe(401);
  });

  test("user yang di-reactivate bisa akses kembali setelah login ulang", async () => {
    // afterEach sudah restore is_active = TRUE
    const agent = await loginAs(activeUser);
    const res = await agent.get("/auth/me");
    expect(res.status).toBe(200);
  });

  test("perubahan nama user terefleksi di session baru", async () => {
    await pool.query(
      `UPDATE users SET name = 'User Revalidate Updated', updated_at = NOW() WHERE id = $1`,
      [activeUser.id],
    );

    const freshAgent = await loginAs(activeUser);
    const after = await freshAgent.get("/auth/me");

    expect(after.status).toBe(200);
    expect(after.body.data.name).toBe("User Revalidate Updated");
  });

  test("teacher multi-center: akses center baru setelah di-assign", async () => {
    const mcCenter = await seedCenter({ name: "MC Session Test Center" });

    await pool.query(
      `INSERT INTO teacher_centers (teacher_id, center_id, is_primary)
       VALUES ($1, $2, FALSE)
       ON CONFLICT DO NOTHING`,
      [activeUser.id, mcCenter.id],
    );

    const freshAgent = await loginAs(activeUser);
    const res = await freshAgent.get("/auth/me");
    expect(res.status).toBe(200);

    const stockRes = await freshAgent.get("/api/teacher/stock");
    expect(stockRes.status).toBe(200);
  });
});
