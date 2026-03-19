require("dotenv").config({ path: ".env.test" });

const request = require("supertest");
const app = require("./setup/testApp");
const {
  truncateAll,
  seedCenter,
  seedUser,
  seedStudent,
  seedModule,
  seedEnrollment,
  seedCertBatch,
  setStock,
  closeDb,
  pool,
} = require("./setup/testDb");

const loginAs = async (user) => {
  const agent = request.agent(app);
  await agent.post("/__test/login").send({ userId: user.id });
  return agent;
};

let superAdmin, admin, teacher, center, otherCenter;

beforeAll(async () => {
  await truncateAll();

  superAdmin = await seedUser({
    email: "superadmin@test.com",
    name: "Super Admin",
    role: "super_admin",
    is_active: true,
  });

  center = await seedCenter({ name: "Center SuperAdmin Test" });
  otherCenter = await seedCenter({ name: "Other Center SuperAdmin" });

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

  // Setup stock dengan seedCertBatch (sumber kebenaran cert qty v4.0)
  await seedCertBatch({
    center_id: center.id,
    range_start: 1,
    range_end: 50,
  });
  await setStock({ center_id: center.id, cert_qty: 50, medal_qty: 30 });

  await seedCertBatch({
    center_id: otherCenter.id,
    range_start: 1001,
    range_end: 1010,
  });
  await setStock({ center_id: otherCenter.id, cert_qty: 10, medal_qty: 5 });
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

// ============================================================
// CENTERS
// ============================================================

describe("Centers — Super Admin", () => {
  test("GET /api/super-admin/centers — 200 list centers", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/centers");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /api/super-admin/centers — filter search", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/centers?search=SuperAdmin");

    expect(res.status).toBe(200);
    expect(res.body.data.every((c) => c.name.includes("SuperAdmin"))).toBe(
      true,
    );
  });

  test("GET /api/super-admin/centers — filter is_active=true", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/centers?is_active=true");

    expect(res.status).toBe(200);
    expect(res.body.data.every((c) => c.is_active === true)).toBe(true);
  });

  test("POST /api/super-admin/centers — 201 buat center", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/super-admin/centers").send({
      name: "Center Baru",
      address: "Jl. Baru No. 1",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Center Baru");
    // drive_folder_id dari mock
    expect(res.body.data.drive_folder_id).toBe("mock_center_folder_id");
  });

  test("POST /api/super-admin/centers — 400 nama kosong", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/super-admin/centers").send({});

    expect(res.status).toBe(400);
  });

  test("PATCH /api/super-admin/centers/:id — 200 update center", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent
      .patch(`/api/super-admin/centers/${center.id}`)
      .send({ name: "Center Updated" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Center Updated");
  });

  test("PATCH /api/super-admin/centers/:id — 400 tidak ada field", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent
      .patch(`/api/super-admin/centers/${center.id}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test("PATCH /api/super-admin/centers/:id — 404 center tidak ada", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent
      .patch("/api/super-admin/centers/999999")
      .send({ name: "Tidak Ada" });

    expect(res.status).toBe(404);
  });

  test("PATCH /api/super-admin/centers/:id/deactivate — 200", async () => {
    const tempCenter = await seedCenter({ name: "Center Deactivate" });

    const agent = await loginAs(superAdmin);
    const res = await agent.patch(
      `/api/super-admin/centers/${tempCenter.id}/deactivate`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("PATCH /api/super-admin/centers/:id/deactivate — 404 sudah nonaktif", async () => {
    const tempCenter = await seedCenter({ name: "Center Already Inactive" });
    const agent = await loginAs(superAdmin);

    await agent.patch(`/api/super-admin/centers/${tempCenter.id}/deactivate`);
    const res = await agent.patch(
      `/api/super-admin/centers/${tempCenter.id}/deactivate`,
    );

    expect(res.status).toBe(404);
  });

  test("401 jika tidak login", async () => {
    const res = await request(app).get("/api/super-admin/centers");
    expect(res.status).toBe(401);
  });

  test("403 jika role admin", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/super-admin/centers");
    expect(res.status).toBe(403);
  });

  test("403 jika role teacher", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/super-admin/centers");
    expect(res.status).toBe(403);
  });
});

// ============================================================
// ADMINS
// ============================================================

describe("Admins — Super Admin", () => {
  test("GET /api/super-admin/admins — 200 list admins", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/admins");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /api/super-admin/admins — tidak return teacher", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/admins");

    expect(res.status).toBe(200);
    const emails = res.body.data.map((u) => u.email);
    expect(emails).not.toContain("teacher@test.com");
  });

  test("GET /api/super-admin/admins — filter by center_id", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      `/api/super-admin/admins?center_id=${center.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.every((u) => u.center_id === center.id)).toBe(true);
  });

  // [FIX] create admin tidak menerima center_id — field ini tidak ada di schema
  test("POST /api/super-admin/admins — 201 pre-register admin", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/super-admin/admins").send({
      email: "newadmin@test.com",
      name: "New Admin",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe("admin");
    expect(res.body.data.is_active).toBe(false);
  });

  test("POST /api/super-admin/admins — 409 email sudah ada", async () => {
    const agent = await loginAs(superAdmin);

    await agent.post("/api/super-admin/admins").send({
      email: "dup.admin@test.com",
      name: "Dup Admin",
    });

    const res = await agent.post("/api/super-admin/admins").send({
      email: "dup.admin@test.com",
      name: "Dup Admin 2",
    });

    expect(res.status).toBe(409);
  });

  test("POST /api/super-admin/admins — 400 email tidak valid", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/super-admin/admins").send({
      email: "bukan-email",
      name: "Admin Invalid",
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/super-admin/admins — 400 nama kosong", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/super-admin/admins").send({
      email: "admin.noname@test.com",
      name: "",
    });

    expect(res.status).toBe(400);
  });

  test("PATCH /api/super-admin/admins/:id — 200 update nama admin", async () => {
    const tempAdmin = await seedUser({
      email: "admin.patch.name@test.com",
      name: "Admin Patch Name",
      role: "admin",
      center_id: center.id,
      is_active: true,
    });

    const agent = await loginAs(superAdmin);
    const res = await agent
      .patch(`/api/super-admin/admins/${tempAdmin.id}`)
      .send({ name: "Admin Name Updated" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Admin Name Updated");
  });

  test("PATCH /api/super-admin/admins/:id — 200 update email — reset is_active", async () => {
    const tempAdmin = await seedUser({
      email: "admin.patch.email@test.com",
      name: "Admin Patch Email",
      role: "admin",
      center_id: center.id,
      is_active: true,
    });

    const agent = await loginAs(superAdmin);
    const res = await agent
      .patch(`/api/super-admin/admins/${tempAdmin.id}`)
      .send({ email: "admin.email.updated@test.com" });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("admin.email.updated@test.com");
    // Email change harus reset is_active ke false
    expect(res.body.data.is_active).toBe(false);
  });

  test("PATCH /api/super-admin/admins/:id — 400 tidak ada field", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent
      .patch(`/api/super-admin/admins/${admin.id}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test("PATCH /api/super-admin/admins/:id — 409 email sudah dipakai user lain", async () => {
    const tempAdmin2 = await seedUser({
      email: "admin.conflict2@test.com",
      name: "Admin Conflict2",
      role: "admin",
      center_id: center.id,
      is_active: true,
    });

    const agent = await loginAs(superAdmin);
    const res = await agent
      .patch(`/api/super-admin/admins/${tempAdmin2.id}`)
      .send({ email: "admin@test.com" });

    expect(res.status).toBe(409);
  });

  test("PATCH /api/super-admin/admins/:id — 404 update teacher via admin endpoint", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent
      .patch(`/api/super-admin/admins/${teacher.id}`)
      .send({ name: "Hacked Teacher Name" });

    expect(res.status).toBe(404);
  });

  test("PATCH /api/super-admin/admins/:id/deactivate — 200", async () => {
    const tempAdmin = await seedUser({
      email: "admin.deact@test.com",
      name: "Admin Deact",
      role: "admin",
      center_id: center.id,
      is_active: true,
    });

    const agent = await loginAs(superAdmin);
    const res = await agent.patch(
      `/api/super-admin/admins/${tempAdmin.id}/deactivate`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("PATCH /api/super-admin/admins/:id/deactivate — 404 sudah nonaktif", async () => {
    const tempAdmin = await seedUser({
      email: "admin.already.deact@test.com",
      name: "Admin Already Deact",
      role: "admin",
      center_id: center.id,
      is_active: true,
    });

    const agent = await loginAs(superAdmin);
    await agent.patch(`/api/super-admin/admins/${tempAdmin.id}/deactivate`);

    const res = await agent.patch(
      `/api/super-admin/admins/${tempAdmin.id}/deactivate`,
    );

    expect(res.status).toBe(404);
  });

  test("PATCH /api/super-admin/admins/:id/deactivate — 404 deactivate teacher via admin endpoint", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.patch(
      `/api/super-admin/admins/${teacher.id}/deactivate`,
    );

    expect(res.status).toBe(404);
  });
});

// ============================================================
// MONITORING — Centers Overview
// ============================================================

describe("Monitoring Centers — Super Admin", () => {
  test("GET /api/super-admin/monitoring/centers — 200 return semua center", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/centers");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // [FIX] field names sesuai response aktual dari query monitoring/centers
  // Query pakai certificate_stock_batches → cert_quantity, bukan cert_stock
  test("GET /api/super-admin/monitoring/centers — response mengandung field yang benar", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/centers");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    const firstCenter = res.body.data[0];
    expect(firstCenter).toHaveProperty("center_id");
    expect(firstCenter).toHaveProperty("center_name");
    // [FIX] cert_quantity bukan cert_stock (schema v4.0 pakai certificate_stock_batches)
    expect(firstCenter).toHaveProperty("cert_quantity");
    expect(firstCenter).toHaveProperty("medal_quantity");
    expect(firstCenter).toHaveProperty("teacher_count");
    expect(firstCenter).toHaveProperty("student_count");
  });

  // [FIX] cert_quantity dan medal_quantity sesuai seed
  test("GET /api/super-admin/monitoring/centers — stock sesuai seed", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/centers");

    expect(res.status).toBe(200);
    const found = res.body.data.find((c) => c.center_id === center.id);
    expect(found).toBeDefined();
    // cert_quantity dihitung dari batch: range_end - current_position + 1
    // range_start=1, range_end=50, current_position=1 → available=50
    expect(found.cert_quantity).toBe(50);
    expect(found.medal_quantity).toBe(30);
  });
});

// ============================================================
// MONITORING — Upload Status
// ============================================================

describe("Monitoring Upload Status — Super Admin", () => {
  let student, module_, enrollment;

  beforeAll(async () => {
    student = await seedStudent({
      name: "Student Monitor",
      center_id: center.id,
    });
    module_ = await seedModule({ name: "Module Monitor" });
    enrollment = await seedEnrollment({
      student_id: student.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    // Print cert untuk enrollment ini
    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, cert_unique_id)
       VALUES ($1, $2, $3, '2024-06-01', FALSE, 'CERT-MON-' || $1::TEXT || '-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT)`,
      [enrollment.id, teacher.id, center.id],
    );
  });

  test("GET /api/super-admin/monitoring/upload-status — 200", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/upload-status");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /api/super-admin/monitoring/upload-status — filter by center_id", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      `/api/super-admin/monitoring/upload-status?center_id=${center.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.center_id === center.id)).toBe(true);
  });

  // [FIX] status valid sekarang adalah "cert_printed" bukan "printed"
  test("GET /api/super-admin/monitoring/upload-status — filter by status cert_printed", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      "/api/super-admin/monitoring/upload-status?status=cert_printed",
    );

    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.upload_status === "cert_printed")).toBe(
      true,
    );
  });

  // [FIX] "printed" sudah tidak valid — harus 400
  test("GET /api/super-admin/monitoring/upload-status — 400 status tidak valid", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      "/api/super-admin/monitoring/upload-status?status=invalid_status",
    );

    expect(res.status).toBe(400);
  });

  test("GET /api/super-admin/monitoring/upload-status — filter status not_started", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      "/api/super-admin/monitoring/upload-status?status=not_started",
    );

    expect(res.status).toBe(200);
  });

  test("GET /api/super-admin/monitoring/upload-status — filter status complete", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      "/api/super-admin/monitoring/upload-status?status=complete",
    );

    expect(res.status).toBe(200);
  });
});

// ============================================================
// MONITORING — Stock Alerts
// ============================================================

describe("Monitoring Stock Alerts — Super Admin", () => {
  test("GET /api/super-admin/monitoring/stock-alerts — 200", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/stock-alerts");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /api/super-admin/monitoring/stock-alerts — hanya return center dengan alert", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/stock-alerts");

    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.has_alert === true)).toBe(true);
  });

  // [FIX] field adalah cert_quantity dan medal_quantity bukan cert_stock/medal_stock
  test("GET /api/super-admin/monitoring/stock-alerts — response mengandung field yang benar", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/stock-alerts");

    expect(res.status).toBe(200);
    if (res.body.data.length > 0) {
      const item = res.body.data[0];
      expect(item).toHaveProperty("center_id");
      expect(item).toHaveProperty("center_name");
      expect(item).toHaveProperty("cert_quantity");
      expect(item).toHaveProperty("medal_quantity");
      expect(item).toHaveProperty("has_alert");
    }
  });

  test("GET /api/super-admin/monitoring/stock-alerts — center dengan stock rendah muncul", async () => {
    // otherCenter: cert batch range 1001..1010 (10 sheets), medal_qty=5
    // default threshold=10 → medal (5<=10) → has_alert=true
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/stock-alerts");

    expect(res.status).toBe(200);
    const found = res.body.data.find((r) => r.center_id === otherCenter.id);
    expect(found).toBeDefined();
    expect(found.has_alert).toBe(true);
  });
});

// ============================================================
// MONITORING — Activity
// ============================================================

describe("Monitoring Activity — Super Admin", () => {
  test("GET /api/super-admin/monitoring/activity — 200", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/activity");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /api/super-admin/monitoring/activity — filter by center_id", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      `/api/super-admin/monitoring/activity?center_id=${center.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.center_id === center.id)).toBe(true);
  });
});

// ============================================================
// MONITORING — Reprints
// ============================================================

describe("Monitoring Reprints — Super Admin", () => {
  test("GET /api/super-admin/monitoring/reprints — 200", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/monitoring/reprints");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  test("GET /api/super-admin/monitoring/reprints — filter by center_id", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      `/api/super-admin/monitoring/reprints?center_id=${center.id}`,
    );

    expect(res.status).toBe(200);
  });

  test("GET /api/super-admin/monitoring/reprints — filter date range valid", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      "/api/super-admin/monitoring/reprints?date_from=2024-01-01&date_to=2024-12-31",
    );

    expect(res.status).toBe(200);
  });

  test("GET /api/super-admin/monitoring/reprints — 400 format tanggal salah", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      "/api/super-admin/monitoring/reprints?date_from=01-01-2024",
    );

    expect(res.status).toBe(400);
  });
});

// ============================================================
// DOWNLOAD
// ============================================================

describe("Download Enrollments — Super Admin", () => {
  test("GET /api/super-admin/download/enrollments — 200", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/download/enrollments");

    expect(res.status).toBe(200);
  });

  test("GET /api/super-admin/download/enrollments — Content-Type text/csv", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/download/enrollments");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
  });

  test("GET /api/super-admin/download/enrollments — Content-Disposition ada filename", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/download/enrollments");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBeDefined();
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/enrollments_/);
    expect(res.headers["content-disposition"]).toMatch(/\.csv/);
  });

  test("GET /api/super-admin/download/enrollments — response body adalah CSV valid", async () => {
    // Seed enrollment untuk verifikasi CSV
    const csvStudent = await seedStudent({
      name: "Student CSV Test",
      center_id: center.id,
    });
    const csvModule = await seedModule({ name: "Module CSV Test" });
    await seedEnrollment({
      student_id: csvStudent.id,
      module_id: csvModule.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/download/enrollments");

    expect(res.status).toBe(200);
    const lines = res.text.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const header = lines[0];
    expect(header).toContain("ID");
    expect(header).toContain("Student Name");
    expect(header).toContain("Teacher");
    expect(header).toContain("Center");
    expect(header).toContain("status");
  });

  test("GET /api/super-admin/download/enrollments — data baris sesuai enrollment", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/super-admin/download/enrollments");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Student CSV Test");
  });

  test("GET /api/super-admin/download/enrollments — filter by center_id", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      `/api/super-admin/download/enrollments?center_id=${center.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
  });

  test("GET /api/super-admin/download/enrollments — filter by date range", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      "/api/super-admin/download/enrollments?date_from=2024-01-01&date_to=2024-12-31",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
  });

  test("GET /api/super-admin/download/enrollments — 400 format tanggal salah", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get(
      "/api/super-admin/download/enrollments?date_from=01-01-2024",
    );

    expect(res.status).toBe(400);
  });

  test("403 jika role admin", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/super-admin/download/enrollments");
    expect(res.status).toBe(403);
  });
});
