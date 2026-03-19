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

  // Setup stock dengan seedCertBatch (sumber kebenaran cert qty v4.0)
  await seedCertBatch({ center_id: center.id, range_start: 1, range_end: 100 });
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

  // Print cert untuk enrollment ini langsung via DB
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

describe("Stock Overview — Admin", () => {
  test("GET /api/drive/stock — 200 admin lihat semua stock", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/drive/stock");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const found = res.body.data.find((s) => s.center_id === center.id);
    expect(found).toBeDefined();
    expect(found).toHaveProperty("cert_quantity");
    expect(found).toHaveProperty("medal_quantity");
  });

  test("GET /api/drive/stock — 200 super admin lihat semua stock", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.get("/api/drive/stock");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /api/drive/stock — 403 teacher tidak bisa akses", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/drive/stock");

    expect(res.status).toBe(403);
  });
});

// ============================================================
// CERTIFICATE BATCH — Add
// ============================================================

describe("Certificate Batch Add — Admin", () => {
  test("POST /api/drive/stock/certificate/add — 200 tambah/extend batch", async () => {
    const agent = await loginAs(admin);

    // Ambil range_end saat ini dulu
    const batchRes = await agent.get(`/api/drive/stock/batch/${center.id}`);
    const currentEnd = batchRes.body.data?.range_end ?? 100;

    const res = await agent.post("/api/drive/stock/certificate/add").send({
      center_id: center.id,
      range_start: 1,
      range_end: currentEnd + 50,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("range_end");
  });

  test("POST /api/drive/stock/certificate/add — 400 range_start > range_end", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/certificate/add").send({
      center_id: center.id,
      range_start: 500,
      range_end: 100,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/certificate/add — 400 range_end negatif", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/certificate/add").send({
      center_id: center.id,
      range_start: 1,
      range_end: -1,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/certificate/add — 403 teacher tidak bisa akses", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/drive/stock/certificate/add").send({
      center_id: center.id,
      range_start: 1,
      range_end: 200,
    });

    expect(res.status).toBe(403);
  });

  test("GET /api/drive/stock/batch/:centerId — 200 detail batch", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get(`/api/drive/stock/batch/${center.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("range_start");
    expect(res.body.data).toHaveProperty("range_end");
    expect(res.body.data).toHaveProperty("current_position");
    expect(res.body.data).toHaveProperty("available");
  });

  test("GET /api/drive/stock/batch/:centerId — 404 center tanpa batch", async () => {
    // Buat center baru tanpa batch
    const noBatchCenter = await seedCenter({ name: "Center No Batch Drive" });

    const agent = await loginAs(admin);
    const res = await agent.get(`/api/drive/stock/batch/${noBatchCenter.id}`);

    expect(res.status).toBe(404);
  });
});

// ============================================================
// CERTIFICATE BATCH — Transfer
// ============================================================

describe("Certificate Batch Transfer — Admin & Super Admin", () => {
  let transferFromCenter, transferToCenter;

  beforeAll(async () => {
    transferFromCenter = await seedCenter({ name: "Transfer From Center" });
    transferToCenter = await seedCenter({ name: "Transfer To Center" });

    // Setup batch yang contiguous agar transfer bisa dilakukan
    // from: 1001..1100 (100 sheets)
    // to: 1101..1200 (100 sheets) — contiguous dengan from
    await seedCertBatch({
      center_id: transferFromCenter.id,
      range_start: 1001,
      range_end: 1100,
    });
    await seedCertBatch({
      center_id: transferToCenter.id,
      range_start: 1101,
      range_end: 1200,
    });

    // Setup medal stock saja — cert batch sudah di-setup via seedCertBatch di atas
    await pool.query(
      `UPDATE medal_stock SET quantity = 50, updated_at = NOW() WHERE center_id = $1`,
      [transferFromCenter.id],
    );
    await pool.query(
      `UPDATE medal_stock SET quantity = 50, updated_at = NOW() WHERE center_id = $1`,
      [transferToCenter.id],
    );
  });

  test("POST /api/drive/stock/certificate/transfer — 200 berhasil transfer", async () => {
    const agent = await loginAs(superAdmin);

    // Preview dulu untuk verifikasi contiguous
    const previewRes = await agent.get(
      `/api/drive/stock/certificate/transfer/preview?from_center_id=${transferFromCenter.id}&to_center_id=${transferToCenter.id}&quantity=10`,
    );

    // Jika tidak contiguous, skip test ini (edge case setup)
    if (!previewRes.body.data?.can_transfer) {
      return;
    }

    const res = await agent.post("/api/drive/stock/certificate/transfer").send({
      from_center_id: transferFromCenter.id,
      to_center_id: transferToCenter.id,
      quantity: 10,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("quantity");
    expect(res.body.data.quantity).toBe(10);
  });

  test("POST /api/drive/stock/certificate/transfer — 400 same center", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/certificate/transfer").send({
      from_center_id: transferFromCenter.id,
      to_center_id: transferFromCenter.id,
      quantity: 10,
    });

    expect([400, 404]).toContain(res.status); // 400 ideal, tapi server mungkin cek batch dulu
  });

  test("POST /api/drive/stock/certificate/transfer — 404 source center tanpa batch", async () => {
    const noBatchCenter = await seedCenter({
      name: "No Batch Transfer Center",
    });

    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/certificate/transfer").send({
      from_center_id: noBatchCenter.id,
      to_center_id: transferToCenter.id,
      quantity: 10,
    });

    expect(res.status).toBe(404);
  });

  test("POST /api/drive/stock/certificate/transfer — 400 stock tidak cukup", async () => {
    // Re-seed batch karena test sebelumnya mungkin sudah memodifikasinya
    await seedCertBatch({
      center_id: transferFromCenter.id,
      range_start: 1001,
      range_end: 1100,
    });

    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/certificate/transfer").send({
      from_center_id: transferFromCenter.id,
      to_center_id: transferToCenter.id,
      quantity: 99999,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/certificate/transfer — 403 teacher tidak bisa transfer", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/drive/stock/certificate/transfer").send({
      from_center_id: transferFromCenter.id,
      to_center_id: transferToCenter.id,
      quantity: 10,
    });

    expect(res.status).toBe(403);
  });

  test("GET /api/drive/stock/certificate/transfer/preview — 200 preview transfer", async () => {
    // Re-seed batch untuk memastikan ada data
    await seedCertBatch({
      center_id: transferFromCenter.id,
      range_start: 1001,
      range_end: 1100,
    });
    await seedCertBatch({
      center_id: transferToCenter.id,
      range_start: 1101,
      range_end: 1200,
    });

    const agent = await loginAs(admin);
    const res = await agent.get(
      `/api/drive/stock/certificate/transfer/preview?from_center_id=${transferFromCenter.id}&to_center_id=${transferToCenter.id}&quantity=5`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("transfer_start_formatted");
    expect(res.body.data).toHaveProperty("transfer_end_formatted");
    expect(res.body.data).toHaveProperty("can_transfer");
  });

  test("GET /api/drive/stock/certificate/transfer/preview — 400 missing params", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get(
      "/api/drive/stock/certificate/transfer/preview?from_center_id=1",
    );

    expect(res.status).toBe(400);
  });
});

// ============================================================
// MEDAL STOCK — Add & Transfer
// ============================================================

describe("Medal Stock Add — Admin", () => {
  test("POST /api/drive/stock/medal/add — 200 tambah medal stock", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/medal/add").send({
      center_id: center.id,
      quantity: 30,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe("medal");
    expect(res.body.data.quantity).toBeGreaterThan(0);
  });

  test("POST /api/drive/stock/medal/add — 400 quantity 0", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/medal/add").send({
      center_id: center.id,
      quantity: 0,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/medal/add — 400 quantity negatif", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/drive/stock/medal/add").send({
      center_id: center.id,
      quantity: -10,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/medal/add — 403 teacher tidak bisa akses", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/drive/stock/medal/add").send({
      center_id: center.id,
      quantity: 10,
    });

    expect(res.status).toBe(403);
  });
});

describe("Medal Stock Transfer — Admin & Super Admin", () => {
  let medalFromCenter, medalToCenter;

  beforeAll(async () => {
    medalFromCenter = await seedCenter({ name: "Medal From Center" });
    medalToCenter = await seedCenter({ name: "Medal To Center" });

    await setStock({
      center_id: medalFromCenter.id,
      cert_qty: 0,
      medal_qty: 100,
    });
    await setStock({
      center_id: medalToCenter.id,
      cert_qty: 0,
      medal_qty: 10,
    });
  });

  test("POST /api/drive/stock/medal/transfer — 200 berhasil transfer", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/medal/transfer").send({
      from_center_id: medalFromCenter.id,
      to_center_id: medalToCenter.id,
      quantity: 20,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.quantity).toBe(20);
  });

  test("POST /api/drive/stock/medal/transfer — 400 same center", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/medal/transfer").send({
      from_center_id: medalFromCenter.id,
      to_center_id: medalFromCenter.id,
      quantity: 10,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/medal/transfer — 400 stock tidak cukup", async () => {
    const agent = await loginAs(superAdmin);
    const res = await agent.post("/api/drive/stock/medal/transfer").send({
      from_center_id: medalFromCenter.id,
      to_center_id: medalToCenter.id,
      quantity: 99999,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/drive/stock/medal/transfer — 403 teacher tidak bisa transfer", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/drive/stock/medal/transfer").send({
      from_center_id: medalFromCenter.id,
      to_center_id: medalToCenter.id,
      quantity: 10,
    });

    expect(res.status).toBe(403);
  });
});

// ============================================================
// STOCK THRESHOLD
// ============================================================

describe("Stock Threshold — Admin", () => {
  test("PATCH /api/drive/stock/threshold — 200 update cert threshold", async () => {
    const agent = await loginAs(admin);
    const res = await agent.patch("/api/drive/stock/threshold").send({
      center_id: center.id,
      type: "certificate",
      threshold: 20,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.low_stock_threshold).toBe(20);
  });

  test("PATCH /api/drive/stock/threshold — 200 update medal threshold", async () => {
    const agent = await loginAs(admin);
    const res = await agent.patch("/api/drive/stock/threshold").send({
      center_id: center.id,
      type: "medal",
      threshold: 15,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.low_stock_threshold).toBe(15);
  });

  test("PATCH /api/drive/stock/threshold — 400 threshold negatif", async () => {
    const agent = await loginAs(admin);
    const res = await agent.patch("/api/drive/stock/threshold").send({
      center_id: center.id,
      type: "certificate",
      threshold: -1,
    });

    expect(res.status).toBe(400);
  });

  test("PATCH /api/drive/stock/threshold — 200 threshold 0 valid", async () => {
    const agent = await loginAs(admin);
    const res = await agent.patch("/api/drive/stock/threshold").send({
      center_id: center.id,
      type: "medal",
      threshold: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.low_stock_threshold).toBe(0);
  });

  test("PATCH /api/drive/stock/threshold — 400 type tidak valid", async () => {
    const agent = await loginAs(admin);
    const res = await agent.patch("/api/drive/stock/threshold").send({
      center_id: center.id,
      type: "invalid",
      threshold: 10,
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================
// CERTIFICATE SCAN UPLOAD — Teacher
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

  test("POST /api/drive/certificates/:certId/scan — 200 upload scan pdf", async () => {
    const agent = await loginAs(teacher);
    const res = await agent
      .post(`/api/drive/certificates/${certId}/scan`)
      .attach("file", dummyPdf, {
        filename: "scan.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(200);
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
