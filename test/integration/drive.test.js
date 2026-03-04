require("dotenv").config({ path: ".env.test" });

const request = require("supertest");
const path = require("path");
const app = require("./setup/testApp");
const {
  truncateAll,
  seedCenter,
  seedUser,
  seedStudent,
  seedModule,
  seedEnrollment,
  setStock,
  closeDb,
  pool,
} = require("./setup/testDb");

const loginAs = async (user) => {
  const agent = request.agent(app);
  await agent.post("/__test/login").send({ userId: user.id });
  return agent;
};

// Dummy file buffer untuk upload test
const dummyPdf = Buffer.from("%PDF-1.4 dummy pdf content");
const dummyImage = Buffer.from("dummy image content");

let center,
  otherCenter,
  superAdmin,
  admin,
  teacher,
  student,
  module_,
  enrollment,
  certId;

beforeAll(async () => {
  await truncateAll();

  center = await seedCenter({ name: "Center Drive Test" });
  otherCenter = await seedCenter({ name: "Other Center Drive" });

  await setStock({ center_id: center.id, cert_qty: 100, medal_qty: 100 });

  superAdmin = await seedUser({
    email: "superadmin.drive@test.com",
    name: "Super Admin Drive",
    role: "super_admin",
    is_active: true,
  });

  admin = await seedUser({
    email: "admin.drive@test.com",
    name: "Admin Drive",
    role: "admin",
    center_id: center.id,
    is_active: true,
  });

  teacher = await seedUser({
    email: "teacher.drive@test.com",
    name: "Teacher Drive",
    role: "teacher",
    center_id: center.id,
    is_active: true,
  });

  student = await seedStudent({
    name: "Student Drive Test",
    center_id: center.id,
  });
  module_ = await seedModule({ name: "Module Drive Test" });
  enrollment = await seedEnrollment({
    student_id: student.id,
    module_id: module_.id,
    center_id: center.id,
    teacher_id: teacher.id,
  });

  // Print cert untuk enrollment ini
  const certResult = await pool.query(
    `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
     VALUES ($1, $2, $3, '2024-06-01', FALSE)
     RETURNING id`,
    [enrollment.id, teacher.id, center.id],
  );

  certId = certResult.rows[0].id;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

// ============================================================
// STOCK — Admin & Super Admin
// ============================================================

describe("Stock — Admin", () => {
  test("GET /api/drive/stock — 200 admin lihat stock center sendiri", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/drive/stock");

    expect(res.status).toBe(200);
    expect(res.body.data.center_id).toBe(center.id);
    expect(res.body.data).toHaveProperty("cert_quantity");
    expect(res.body.data).toHaveProperty("medal_quantity");
  });

  test("GET /api/drive/stock — 200 super admin lihat semua stock", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/drive/stock");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("POST /api/drive/stock/add — 200 tambah certificate stock", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/add").send({
      type: "certificate",
      quantity: 50,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe("certificate");
    expect(res.body.data.quantity).toBeGreaterThan(0);
  });

  test("POST /api/drive/stock/add — 200 tambah medal stock", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/add").send({
      type: "medal",
      quantity: 30,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe("medal");
  });

  test("POST /api/drive/stock/add — 400 quantity 0", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/add").send({
      type: "certificate",
      quantity: 0,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/add — 400 type tidak valid", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/add").send({
      type: "invalid",
      quantity: 10,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/add — 403 teacher tidak bisa akses", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/drive/stock/add").send({
      type: "certificate",
      quantity: 10,
    });

    expect(res.status).toBe(403);
  });
});

describe("Stock Transfer — Super Admin", () => {
  test("POST /api/drive/stock/transfer — 200 berhasil transfer", async () => {
    // Pastikan otherCenter punya stock record
    await pool.query(
      `INSERT INTO certificate_stock (center_id, quantity) VALUES ($1, 0)
       ON CONFLICT (center_id) DO NOTHING`,
      [otherCenter.id],
    );

    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/transfer").send({
      type: "certificate",
      from_center_id: center.id,
      to_center_id: otherCenter.id,
      quantity: 10,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.quantity).toBe(10);
  });

  test("POST /api/drive/stock/transfer — 400 same center", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/transfer").send({
      type: "certificate",
      from_center_id: center.id,
      to_center_id: center.id,
      quantity: 10,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/transfer — 400 stock tidak cukup", async () => {
    await setStock({ center_id: center.id, cert_qty: 0, medal_qty: 100 });

    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/transfer").send({
      type: "certificate",
      from_center_id: center.id,
      to_center_id: otherCenter.id,
      quantity: 999,
    });

    expect(res.status).toBe(400);

    await setStock({ center_id: center.id, cert_qty: 100, medal_qty: 100 });
  });

  test("POST /api/drive/stock/transfer — 403 admin tidak bisa transfer", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/transfer").send({
      type: "certificate",
      from_center_id: center.id,
      to_center_id: otherCenter.id,
      quantity: 10,
    });

    expect(res.status).toBe(403);
  });
});

describe("Stock Threshold — Admin", () => {
  test("PATCH /api/drive/stock/threshold — 200 update threshold", async () => {
    const agent = await loginAs(admin);
    const res = await agent.patch("/api/drive/stock/threshold").send({
      type: "certificate",
      threshold: 20,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.low_stock_threshold).toBe(20);
  });

  test("PATCH /api/drive/stock/threshold — 400 threshold negatif", async () => {
    const agent = await loginAs(admin);
    const res = await agent.patch("/api/drive/stock/threshold").send({
      type: "certificate",
      threshold: -1,
    });

    expect(res.status).toBe(400);
  });

  test("PATCH /api/drive/stock/threshold — 200 threshold 0 valid", async () => {
    const agent = await loginAs(admin);
    const res = await agent.patch("/api/drive/stock/threshold").send({
      type: "medal",
      threshold: 0,
    });

    expect(res.status).toBe(200);
  });
});

// ============================================================
// SCAN UPLOAD — Teacher
// ============================================================

describe("Certificate Scan Upload — Teacher", () => {
  test("POST /api/drive/certificates/:certId/scan — 200 upload scan jpg", async () => {
    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/certificates/${certId}/scan`)
      .attach("file", dummyImage, {
        filename: "scan.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.scan_file_id).toBe("mock_file_id");
  });

  test("POST /api/drive/certificates/:certId/scan — 200 replace scan (upload ulang)", async () => {
    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/certificates/${certId}/scan`)
      .attach("file", dummyImage, {
        filename: "scan2.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(200);
  });

  test("POST /api/drive/certificates/:certId/scan — 400 tidak ada file", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post(`/api/drive/certificates/${certId}/scan`);

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/certificates/:certId/scan — 400 file type tidak valid", async () => {
    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/certificates/${certId}/scan`)
      .attach("file", Buffer.from("dummy"), {
        filename: "scan.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/certificates/:certId/scan — 404 cert tidak milik teacher", async () => {
    // Buat cert milik otherTeacher
    const otherTeacher = await seedUser({
      email: "other.teacher.scan@test.com",
      name: "Other Teacher Scan",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });

    const otherStudent = await seedStudent({
      name: "Student Scan Other",
      center_id: center.id,
    });
    const otherEnrollment = await seedEnrollment({
      student_id: otherStudent.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: otherTeacher.id,
    });

    const otherCert = await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
       VALUES ($1, $2, $3, '2024-06-01', FALSE) RETURNING id`,
      [otherEnrollment.id, otherTeacher.id, center.id],
    );

    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/certificates/${otherCert.rows[0].id}/scan`)
      .attach("file", dummyImage, {
        filename: "scan.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(404);
  });

  test("403 jika bukan teacher", async () => {
    const agent = await loginAs(admin);
    const res = await agent
      .post(`/api/drive/certificates/${certId}/scan`)
      .attach("file", dummyImage, {
        filename: "scan.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(403);
  });
});

// ============================================================
// REPORT MANUAL UPLOAD — Teacher
// ============================================================

describe("Report Manual Upload — Teacher", () => {
  let reportId;

  beforeAll(async () => {
    // Buat enrollment + cert + scan untuk report upload test
    const s = await seedStudent({
      name: "Student Report Upload",
      center_id: center.id,
    });
    const e = await seedEnrollment({
      student_id: s.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
       VALUES ($1, $2, $3, '2024-06-01', FALSE)`,
      [e.id, teacher.id, center.id],
    );

    await pool.query(
      `UPDATE certificates SET scan_file_id = 'mock_scan', scan_uploaded_at = NOW()
       WHERE enrollment_id = $1`,
      [e.id],
    );

    // Insert report tanpa drive_file_id (simulasi auto-upload gagal)
    const reportResult = await pool.query(
      `INSERT INTO reports (enrollment_id, teacher_id, content, word_count)
       VALUES ($1, $2, $3, 200) RETURNING id`,
      [e.id, teacher.id, Array(200).fill("kata").join(" ")],
    );

    reportId = reportResult.rows[0].id;
  });

  test("POST /api/drive/reports/:reportId/upload — 200 manual upload berhasil", async () => {
    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/reports/${reportId}/upload`)
      .attach("file", dummyPdf, {
        filename: "report.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(200);
    expect(res.body.data.drive_file_id).toBe("mock_file_id");
  });

  test("POST /api/drive/reports/:reportId/upload — 400 sudah ter-upload", async () => {
    // Report sudah ter-upload dari test sebelumnya
    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/reports/${reportId}/upload`)
      .attach("file", dummyPdf, {
        filename: "report.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already uploaded/i);
  });

  test("POST /api/drive/reports/:reportId/upload — 400 tidak ada file", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post(`/api/drive/reports/${reportId}/upload`);

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/reports/:reportId/upload — 400 file bukan PDF", async () => {
    // Buat report baru tanpa drive_file_id
    const s2 = await seedStudent({
      name: "Student Wrong File",
      center_id: center.id,
    });
    const e2 = await seedEnrollment({
      student_id: s2.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
       VALUES ($1, $2, $3, '2024-06-01', FALSE)`,
      [e2.id, teacher.id, center.id],
    );

    const r2 = await pool.query(
      `INSERT INTO reports (enrollment_id, teacher_id, content, word_count)
       VALUES ($1, $2, $3, 200) RETURNING id`,
      [e2.id, teacher.id, Array(200).fill("kata").join(" ")],
    );

    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/reports/${r2.rows[0].id}/upload`)
      .attach("file", dummyImage, {
        filename: "report.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/reports/:reportId/upload — 404 report tidak milik teacher", async () => {
    const otherTeacher2 = await seedUser({
      email: "other.teacher2.report@test.com",
      name: "Other Teacher2 Report",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });

    const s3 = await seedStudent({
      name: "Student Other Report",
      center_id: center.id,
    });
    const e3 = await seedEnrollment({
      student_id: s3.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: otherTeacher2.id,
    });

    const r3 = await pool.query(
      `INSERT INTO reports (enrollment_id, teacher_id, content, word_count)
       VALUES ($1, $2, $3, 200) RETURNING id`,
      [e3.id, otherTeacher2.id, Array(200).fill("kata").join(" ")],
    );

    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/reports/${r3.rows[0].id}/upload`)
      .attach("file", dummyPdf, {
        filename: "report.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(404);
  });
});
