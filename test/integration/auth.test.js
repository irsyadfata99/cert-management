require("dotenv").config({ path: ".env.test" });

const request = require("supertest");
const app = require("./setup/testApp");
const {
  truncateAll,
  seedCenter,
  seedUser,
  closeDb,
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
