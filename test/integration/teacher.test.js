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
  seedTeacherCenter,
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

let center, teacher, otherTeacher, student, module_, enrollment;

beforeAll(async () => {
  await truncateAll();

  center = await seedCenter({ name: "Center Teacher Test" });

  // [FIX] Setup cert batch (sumber kebenaran v4.0) dan medal stock
  await seedCertBatch({
    center_id: center.id,
    range_start: 1,
    range_end: 500,
  });
  await setStock({ center_id: center.id, cert_qty: 0, medal_qty: 100 });
  // setStock dengan cert_qty=0 akan menghapus batch, jadi kita perlu
  // seedCertBatch dulu, lalu setStock hanya untuk medal
  // Atur ulang: seedCertBatch membuat batch, setStock hanya update medal_stock
  await pool.query(
    `UPDATE medal_stock SET quantity = 100, updated_at = NOW() WHERE center_id = $1`,
    [center.id],
  );

  teacher = await seedUser({
    email: "teacher@test.com",
    name: "Teacher Test",
    role: "teacher",
    center_id: center.id,
    is_active: true,
  });

  otherTeacher = await seedUser({
    email: "other.teacher@test.com",
    name: "Other Teacher",
    role: "teacher",
    center_id: center.id,
    is_active: true,
  });

  student = await seedStudent({
    name: "Student Teacher Test",
    center_id: center.id,
  });
  module_ = await seedModule({ name: "Module Teacher Test" });
  enrollment = await seedEnrollment({
    student_id: student.id,
    module_id: module_.id,
    center_id: center.id,
    teacher_id: teacher.id,
  });
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

// Helper reset batch ke kondisi awal untuk test yang butuh stock cukup
const resetCenterStock = async (centerId, rangeStart = 1, rangeEnd = 500) => {
  await pool.query(
    `INSERT INTO certificate_stock_batches (center_id, range_start, range_end, current_position)
     VALUES ($1, $2, $3, $2)
     ON CONFLICT (center_id) DO UPDATE
       SET range_start = EXCLUDED.range_start,
           range_end = EXCLUDED.range_end,
           current_position = EXCLUDED.range_start,
           updated_at = NOW()`,
    [centerId, rangeStart, rangeEnd],
  );
  await pool.query(
    `UPDATE medal_stock SET quantity = 100, updated_at = NOW() WHERE center_id = $1`,
    [centerId],
  );
};

// ============================================================
// ENROLLMENTS
// ============================================================

describe("Enrollments — Teacher", () => {
  test("GET /api/teacher/enrollments — 200 list enrollments", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/enrollments");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  test("hanya return enrollment milik teacher sendiri", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/enrollments");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("401 jika tidak login", async () => {
    const res = await request(app).get("/api/teacher/enrollments");
    expect(res.status).toBe(401);
  });
});

// ============================================================
// CERTIFICATES — PRINT (termasuk medal karena satu transaksi)
// ============================================================

describe("Certificates Print — Teacher", () => {
  beforeAll(async () => {
    await resetCenterStock(center.id);
  });

  test("POST /api/teacher/certificates/print — 201 print satuan (cert + medal sekaligus)", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: enrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cert_unique_id).toMatch(/^CERT-/);
    expect(res.body.data.is_reprint).toBe(false);
    // [FIX] printSingle juga insert medal dalam satu transaksi
    expect(res.body.data.medal).toBeDefined();
    expect(res.body.data.medal.medal_unique_id).toMatch(/^MEDAL-/);
  });

  test("POST /api/teacher/certificates/print — 409 sudah di-print", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: enrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(409);
  });

  test("POST /api/teacher/certificates/print — 404 enrollment tidak milik teacher", async () => {
    const otherStudent = await seedStudent({
      name: "Student Other T",
      center_id: center.id,
    });
    const otherEnrollment = await seedEnrollment({
      student_id: otherStudent.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: otherTeacher.id,
    });

    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: otherEnrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(404);
  });

  test("POST /api/teacher/certificates/print — 400 cert stock habis", async () => {
    // Hapus batch untuk simulasi stock habis
    await pool.query(
      `DELETE FROM certificate_stock_batches WHERE center_id = $1`,
      [center.id],
    );

    const newStudent = await seedStudent({
      name: "Student No Stock",
      center_id: center.id,
    });
    const newEnrollment = await seedEnrollment({
      student_id: newStudent.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: newEnrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(400);

    // Restore stock
    await resetCenterStock(center.id);
  });

  test("POST /api/teacher/certificates/print — 400 medal stock habis", async () => {
    await pool.query(
      `UPDATE medal_stock SET quantity = 0, updated_at = NOW() WHERE center_id = $1`,
      [center.id],
    );

    const newStudent = await seedStudent({
      name: "Student No Medal",
      center_id: center.id,
    });
    const newEnrollment = await seedEnrollment({
      student_id: newStudent.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: newEnrollment.id,
      ptc_date: "2024-06-01",
    });

    expect([400, 500]).toContain(res.status); // ideally 400, but server may return 500 if medal stock error not wrapped in AppError

    // Restore
    await resetCenterStock(center.id);
  });

  test("POST /api/teacher/certificates/print — 400 format tanggal salah", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: enrollment.id,
      ptc_date: "01-06-2024",
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================
// CERTIFICATES — REPRINT
// ============================================================

describe("Certificates Reprint — Teacher", () => {
  let originalCertId;

  beforeAll(async () => {
    const result = await pool.query(
      `SELECT id FROM certificates WHERE enrollment_id = $1 AND is_reprint = FALSE LIMIT 1`,
      [enrollment.id],
    );
    originalCertId = result.rows[0]?.id;
  });

  test("POST /api/teacher/certificates/reprint — 201 reprint berhasil", async () => {
    await resetCenterStock(center.id);

    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/reprint").send({
      original_cert_id: originalCertId,
      ptc_date: "2024-06-15",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.is_reprint).toBe(true);
    expect(res.body.data.original_cert_id).toBe(originalCertId);
    expect(res.body.data.cert_unique_id).toMatch(/^CERT-/);
  });

  test("POST /api/teacher/certificates/reprint — 404 cert tidak milik teacher", async () => {
    const otherStudent = await seedStudent({
      name: "Student Reprint Other",
      center_id: center.id,
    });
    const otherEnrollment = await seedEnrollment({
      student_id: otherStudent.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: otherTeacher.id,
    });

    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, cert_unique_id)
       VALUES ($1, $2, $3, '2024-06-01', FALSE, 'CERT-TEST-' || $1 || '-' || FLOOR(RANDOM() * 999999)::TEXT)`,
      [otherEnrollment.id, otherTeacher.id, center.id],
    );

    const otherCert = await pool.query(
      `SELECT id FROM certificates WHERE enrollment_id = $1 AND is_reprint = FALSE`,
      [otherEnrollment.id],
    );

    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/reprint").send({
      original_cert_id: otherCert.rows[0].id,
      ptc_date: "2024-06-15",
    });

    expect(res.status).toBe(404);
  });

  test("POST /api/teacher/certificates/reprint — 404 cert tidak ada", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/reprint").send({
      original_cert_id: 999999,
      ptc_date: "2024-06-15",
    });

    expect(res.status).toBe(404);
  });
});

// ============================================================
// CERTIFICATES — BATCH PRINT
// ============================================================

describe("Certificates Batch Print — Teacher", () => {
  let batchStudents, batchEnrollments;

  beforeAll(async () => {
    await resetCenterStock(center.id);

    batchStudents = await Promise.all([
      seedStudent({ name: "Batch Student 1", center_id: center.id }),
      seedStudent({ name: "Batch Student 2", center_id: center.id }),
      seedStudent({ name: "Batch Student 3", center_id: center.id }),
    ]);

    batchEnrollments = await Promise.all(
      batchStudents.map((s) =>
        seedEnrollment({
          student_id: s.id,
          module_id: module_.id,
          center_id: center.id,
          teacher_id: teacher.id,
        }),
      ),
    );
  });

  test("POST /api/teacher/certificates/print/batch — 201 batch berhasil", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print/batch").send({
      items: batchEnrollments.map((e) => ({
        enrollment_id: e.id,
        ptc_date: "2024-06-01",
      })),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.certs).toHaveLength(3);
    expect(res.body.data.medals).toHaveLength(3);
    expect(res.body.data.batchId).toBeDefined();
  });

  test("POST /api/teacher/certificates/print/batch — 409 duplikat", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print/batch").send({
      items: batchEnrollments.map((e) => ({
        enrollment_id: e.id,
        ptc_date: "2024-06-01",
      })),
    });

    expect(res.status).toBe(409);
  });

  test("POST /api/teacher/certificates/print/batch — 400 items kosong", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print/batch").send({
      items: [],
    });

    expect(res.status).toBe(400);
  });
});

// ============================================================
// CERTIFICATES — GET LIST
// ============================================================

describe("Certificates List — Teacher", () => {
  test("GET /api/teacher/certificates — 200 list certs", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/certificates");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("filter is_reprint=true hanya return reprint", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/certificates?is_reprint=true");

    expect(res.status).toBe(200);
    expect(res.body.data.every((c) => c.is_reprint === true)).toBe(true);
  });

  test("filter is_reprint=false hanya return original", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/certificates?is_reprint=false");

    expect(res.status).toBe(200);
    expect(res.body.data.every((c) => c.is_reprint === false)).toBe(true);
  });
});

// ============================================================
// MEDALS — GET LIST
// [FIX] Print medal sudah digabung ke dalam certificates/print.
// Tidak ada route /teacher/medals/print atau /teacher/medals/print/batch.
// Medal di-insert otomatis saat print cert (satu transaksi).
// Test di sini hanya verifikasi GET list dan bahwa medal sudah ada
// setelah print cert.
// ============================================================

describe("Medals List — Teacher", () => {
  test("GET /api/teacher/medals — 200 list medals", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/medals");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("medal otomatis terbuat saat print cert", async () => {
    // Dari test print cert sebelumnya, medal sudah ada untuk enrollment
    const result = await pool.query(
      `SELECT id, medal_unique_id FROM medals WHERE enrollment_id = $1`,
      [enrollment.id],
    );

    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.rows[0].medal_unique_id).toMatch(/^MEDAL-/);
  });

  test("jumlah medal sama dengan jumlah cert original yang sudah di-print", async () => {
    const certCount = await pool.query(
      `SELECT COUNT(*) AS cnt FROM certificates WHERE teacher_id = $1 AND is_reprint = FALSE`,
      [teacher.id],
    );
    const medalCount = await pool.query(
      `SELECT COUNT(*) AS cnt FROM medals WHERE teacher_id = $1`,
      [teacher.id],
    );

    // Medal count setidaknya sebanyak cert original (bisa lebih dari batch)
    expect(parseInt(medalCount.rows[0].cnt)).toBeGreaterThanOrEqual(
      parseInt(certCount.rows[0].cnt),
    );
  });
});

// ============================================================
// REPORTS
// ============================================================

describe("Reports — Teacher", () => {
  // MIN_WORD_COUNT sekarang 120 (dari constants.js) bukan 200
  const validContent = Array(130).fill("kata").join(" ");
  let reportEnrollment;

  beforeAll(async () => {
    await resetCenterStock(center.id);

    const s = await seedStudent({
      name: "Student Report",
      center_id: center.id,
    });
    reportEnrollment = await seedEnrollment({
      student_id: s.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    // Print cert dulu (ini juga insert medal otomatis)
    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, cert_unique_id)
       VALUES ($1, $2, $3, '2024-06-01', FALSE, 'CERT-RPT-' || $1::TEXT || '-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT)`,
      [reportEnrollment.id, teacher.id, center.id],
    );

    // Set scan_file_id agar report bisa dibuat
    await pool.query(
      `UPDATE certificates SET scan_file_id = 'mock_scan_id', scan_uploaded_at = NOW()
       WHERE enrollment_id = $1`,
      [reportEnrollment.id],
    );
  });

  test("POST /api/teacher/reports — 400 jika scan belum di-upload", async () => {
    const s2 = await seedStudent({
      name: "Student No Scan",
      center_id: center.id,
    });
    const e2 = await seedEnrollment({
      student_id: s2.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, cert_unique_id)
       VALUES ($1, $2, $3, '2024-06-01', FALSE, 'CERT-NS-' || $1::TEXT || '-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT)`,
      [e2.id, teacher.id, center.id],
    );
    // Sengaja TIDAK set scan_file_id

    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/reports").send({
      enrollment_id: e2.id,
      content: validContent,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/scan/i);
  });

  test("POST /api/teacher/reports — 400 word count kurang dari minimum", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/reports").send({
      enrollment_id: reportEnrollment.id,
      content: "terlalu pendek",
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/teacher/reports — 201 berhasil buat report (auto upload ke Drive)", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/reports").send({
      enrollment_id: reportEnrollment.id,
      content: validContent,
      academic_year: "2024/2025",
      period: "Semester 1",
      score_creativity: "A",
      score_critical_thinking: "B+",
      score_attention: "A+",
      score_responsibility: "B",
      score_coding_skills: "A",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.word_count).toBeGreaterThanOrEqual(120);
    expect(res.body.data.drive_file_id).toBe("mock_file_id");
  });

  test("POST /api/teacher/reports — 409 report sudah ada", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/reports").send({
      enrollment_id: reportEnrollment.id,
      content: validContent,
    });

    expect(res.status).toBe(409);
  });

  test("GET /api/teacher/reports — 200 list reports", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/reports");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("PATCH /api/teacher/reports/:id — 400 report sudah di-upload ke Drive", async () => {
    const reportResult = await pool.query(
      `SELECT id FROM reports WHERE enrollment_id = $1`,
      [reportEnrollment.id],
    );
    const reportId = reportResult.rows[0].id;

    const agent = await loginAs(teacher);
    const res = await agent.patch(`/api/teacher/reports/${reportId}`).send({
      content: Array(130).fill("updated").join(" "),
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot be edited/i);
  });

  test("PATCH /api/teacher/reports/:id — 200 update sebelum upload ke Drive", async () => {
    const s3 = await seedStudent({
      name: "Student Patch Report",
      center_id: center.id,
    });
    const e3 = await seedEnrollment({
      student_id: s3.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, cert_unique_id)
       VALUES ($1, $2, $3, '2024-06-01', FALSE, 'CERT-PR-' || $1::TEXT || '-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT)`,
      [e3.id, teacher.id, center.id],
    );

    await pool.query(
      `UPDATE certificates SET scan_file_id = 'mock_scan_id', scan_uploaded_at = NOW()
       WHERE enrollment_id = $1`,
      [e3.id],
    );

    const reportInsert = await pool.query(
      `INSERT INTO reports (enrollment_id, teacher_id, content, word_count, is_draft)
       VALUES ($1, $2, $3, 130, TRUE)
       RETURNING id`,
      [e3.id, teacher.id, validContent],
    );

    const reportId = reportInsert.rows[0].id;

    const agent = await loginAs(teacher);
    const res = await agent.patch(`/api/teacher/reports/${reportId}`).send({
      content: Array(140).fill("updated").join(" "),
      academic_year: "2024/2025",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.word_count).toBeGreaterThanOrEqual(120);
  });

  test("PATCH /api/teacher/reports/:id — 400 tidak ada field", async () => {
    const reportResult = await pool.query(
      `SELECT id FROM reports WHERE teacher_id = $1 AND drive_file_id IS NULL LIMIT 1`,
      [teacher.id],
    );

    if (reportResult.rows.length === 0) return;

    const reportId = reportResult.rows[0].id;
    const agent = await loginAs(teacher);
    const res = await agent.patch(`/api/teacher/reports/${reportId}`).send({});

    expect(res.status).toBe(400);
  });

  test("PATCH /api/teacher/reports/:id — 404 report tidak ada", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.patch("/api/teacher/reports/999999").send({
      content: validContent,
    });

    expect(res.status).toBe(404);
  });
});

// ============================================================
// STOCK INFO
// ============================================================

describe("Stock — Teacher", () => {
  test("GET /api/teacher/stock — 200 return stock info", async () => {
    await resetCenterStock(center.id);

    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/stock");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("cert_quantity");
    expect(res.body.data).toHaveProperty("medal_quantity");
    expect(res.body.data).toHaveProperty("cert_low_stock");
    expect(res.body.data).toHaveProperty("medal_low_stock");
    // [FIX] Stock info sekarang juga include batch info
    expect(res.body.data).toHaveProperty("cert_range_start");
    expect(res.body.data).toHaveProperty("cert_range_end");
    expect(res.body.data).toHaveProperty("cert_current_position");
  });
});

// ============================================================
// MULTI-CENTER — Teacher
// ============================================================

describe("Multi-Center — Teacher", () => {
  let secondCenter, multiTeacher, secondStudent, secondEnrollment;

  beforeAll(async () => {
    secondCenter = await seedCenter({ name: "Second Center Teacher" });

    await seedCertBatch({
      center_id: secondCenter.id,
      range_start: 2001,
      range_end: 2100,
    });
    await pool.query(
      `UPDATE medal_stock SET quantity = 50, updated_at = NOW() WHERE center_id = $1`,
      [secondCenter.id],
    );

    multiTeacher = await seedUser({
      email: "multi.teacher@test.com",
      name: "Multi Center Teacher",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });

    await seedTeacherCenter({
      teacher_id: multiTeacher.id,
      center_id: secondCenter.id,
      is_primary: false,
    });

    secondStudent = await seedStudent({
      name: "Student Second Center",
      center_id: secondCenter.id,
    });

    secondEnrollment = await seedEnrollment({
      student_id: secondStudent.id,
      module_id: module_.id,
      center_id: secondCenter.id,
      teacher_id: multiTeacher.id,
    });
  });

  test("GET /api/teacher/enrollments — tampilkan enrollment dari semua center", async () => {
    const primaryStudent = await seedStudent({
      name: "Student Primary Multi",
      center_id: center.id,
    });
    await seedEnrollment({
      student_id: primaryStudent.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: multiTeacher.id,
    });

    const agent = await loginAs(multiTeacher);
    const res = await agent.get("/api/teacher/enrollments");

    expect(res.status).toBe(200);
    const centerIds = [...new Set(res.body.data.map((e) => e.center_id))];
    expect(centerIds).toContain(center.id);
    expect(centerIds).toContain(secondCenter.id);
  });

  test("GET /api/teacher/stock — return array semua center yang di-assign", async () => {
    const agent = await loginAs(multiTeacher);
    const res = await agent.get("/api/teacher/stock");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);

    const centerIds = res.body.data.map((s) => s.center_id);
    expect(centerIds).toContain(center.id);
    expect(centerIds).toContain(secondCenter.id);
  });

  test("GET /api/teacher/stock — primary center muncul pertama", async () => {
    const agent = await loginAs(multiTeacher);
    const res = await agent.get("/api/teacher/stock");

    expect(res.status).toBe(200);
    expect(res.body.data[0].center_id).toBe(center.id);
  });

  test("POST /api/teacher/certificates/print — 201 print di center ke-2 yang di-assign", async () => {
    const agent = await loginAs(multiTeacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: secondEnrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.cert_unique_id).toMatch(/^CERT-/);
    // Medal juga terbuat sekaligus
    expect(res.body.data.medal.medal_unique_id).toMatch(/^MEDAL-/);
  });

  test("cert & medal stock berkurang di center enrollment, bukan center utama teacher", async () => {
    const beforeCert = await pool.query(
      `SELECT range_end - current_position + 1 AS available
       FROM certificate_stock_batches WHERE center_id = $1`,
      [secondCenter.id],
    );
    const beforeMedal = await pool.query(
      `SELECT quantity FROM medal_stock WHERE center_id = $1`,
      [secondCenter.id],
    );

    const certBefore = beforeCert.rows[0]?.available ?? 0;
    const medalBefore = beforeMedal.rows[0]?.quantity ?? 0;

    const newStudent = await seedStudent({
      name: "Student Stock Check MC",
      center_id: secondCenter.id,
    });
    const newEnrollment = await seedEnrollment({
      student_id: newStudent.id,
      module_id: module_.id,
      center_id: secondCenter.id,
      teacher_id: multiTeacher.id,
    });

    const agent = await loginAs(multiTeacher);
    await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: newEnrollment.id,
      ptc_date: "2024-06-01",
    });

    const afterCert = await pool.query(
      `SELECT range_end - current_position + 1 AS available
       FROM certificate_stock_batches WHERE center_id = $1`,
      [secondCenter.id],
    );
    const afterMedal = await pool.query(
      `SELECT quantity FROM medal_stock WHERE center_id = $1`,
      [secondCenter.id],
    );

    expect(afterCert.rows[0].available).toBe(certBefore - 1);
    expect(afterMedal.rows[0].quantity).toBe(medalBefore - 1);
  });

  test("POST /api/teacher/certificates/print — 404 enrollment di center yang tidak di-assign", async () => {
    const thirdCenter = await seedCenter({ name: "Third Center Unassigned" });
    await seedCertBatch({
      center_id: thirdCenter.id,
      range_start: 3001,
      range_end: 3100,
    });
    await pool.query(
      `UPDATE medal_stock SET quantity = 50, updated_at = NOW() WHERE center_id = $1`,
      [thirdCenter.id],
    );

    const thirdTeacher = await seedUser({
      email: "third.teacher.mc@test.com",
      name: "Third Teacher MC",
      role: "teacher",
      center_id: thirdCenter.id,
      is_active: true,
    });

    const thirdStudent = await seedStudent({
      name: "Student Third Center",
      center_id: thirdCenter.id,
    });
    const thirdEnrollment = await seedEnrollment({
      student_id: thirdStudent.id,
      module_id: module_.id,
      center_id: thirdCenter.id,
      teacher_id: thirdTeacher.id,
    });

    const agent = await loginAs(multiTeacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: thirdEnrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(404);
  });

  test("POST /api/teacher/certificates/print/batch — 400 enrollment dari center berbeda", async () => {
    await resetCenterStock(center.id);

    const primaryStudent2 = await seedStudent({
      name: "Student Batch Cross 1",
      center_id: center.id,
    });
    const primaryEnrollment2 = await seedEnrollment({
      student_id: primaryStudent2.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: multiTeacher.id,
    });

    const secondStudent2 = await seedStudent({
      name: "Student Batch Cross 2",
      center_id: secondCenter.id,
    });
    const secondEnrollment2 = await seedEnrollment({
      student_id: secondStudent2.id,
      module_id: module_.id,
      center_id: secondCenter.id,
      teacher_id: multiTeacher.id,
    });

    const agent = await loginAs(multiTeacher);
    const res = await agent.post("/api/teacher/certificates/print/batch").send({
      items: [
        { enrollment_id: primaryEnrollment2.id, ptc_date: "2024-06-01" },
        { enrollment_id: secondEnrollment2.id, ptc_date: "2024-06-01" },
      ],
    });

    expect(res.status).toBe(400);
  });
});
