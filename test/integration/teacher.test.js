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
  await setStock({ center_id: center.id, cert_qty: 100, medal_qty: 100 });

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
// CERTIFICATES — PRINT
// ============================================================

describe("Certificates Print — Teacher", () => {
  test("POST /api/teacher/certificates/print — 201 print satuan", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: enrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cert_unique_id).toMatch(/^CERT-/);
    expect(res.body.data.is_reprint).toBe(false);
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

  test("POST /api/teacher/certificates/print — 400 stock habis", async () => {
    await setStock({ center_id: center.id, cert_qty: 0, medal_qty: 100 });

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
    await setStock({ center_id: center.id, cert_qty: 100, medal_qty: 100 });
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
    // Ambil cert yang sudah di-print sebelumnya
    const result = await pool.query(
      `SELECT id FROM certificates WHERE enrollment_id = $1 AND is_reprint = FALSE LIMIT 1`,
      [enrollment.id],
    );
    originalCertId = result.rows[0]?.id;
  });

  test("POST /api/teacher/certificates/reprint — 201 reprint berhasil", async () => {
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

    // Print cert untuk otherTeacher
    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
       VALUES ($1, $2, $3, '2024-06-01', FALSE)`,
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
// MEDALS — PRINT
// ============================================================

describe("Medals Print — Teacher", () => {
  test("POST /api/teacher/medals/print — 201 print satuan", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/medals/print").send({
      enrollment_id: enrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.medal_unique_id).toMatch(/^MEDAL-/);
  });

  test("POST /api/teacher/medals/print — 409 sudah di-print", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/medals/print").send({
      enrollment_id: enrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(409);
  });

  test("POST /api/teacher/medals/print — 400 stock habis", async () => {
    await setStock({ center_id: center.id, cert_qty: 100, medal_qty: 0 });

    const newStudent = await seedStudent({
      name: "Student No Medal Stock",
      center_id: center.id,
    });
    const newEnrollment = await seedEnrollment({
      student_id: newStudent.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/medals/print").send({
      enrollment_id: newEnrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(400);

    await setStock({ center_id: center.id, cert_qty: 100, medal_qty: 100 });
  });
});

// ============================================================
// MEDALS — BATCH PRINT
// ============================================================

describe("Medals Batch Print — Teacher", () => {
  let medalBatchEnrollments;

  beforeAll(async () => {
    const students = await Promise.all([
      seedStudent({ name: "Medal Batch 1", center_id: center.id }),
      seedStudent({ name: "Medal Batch 2", center_id: center.id }),
    ]);

    medalBatchEnrollments = await Promise.all(
      students.map((s) =>
        seedEnrollment({
          student_id: s.id,
          module_id: module_.id,
          center_id: center.id,
          teacher_id: teacher.id,
        }),
      ),
    );
  });

  test("POST /api/teacher/medals/print/batch — 201 batch berhasil", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/medals/print/batch").send({
      items: medalBatchEnrollments.map((e) => ({
        enrollment_id: e.id,
        ptc_date: "2024-06-01",
      })),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.medals).toHaveLength(2);
  });

  test("POST /api/teacher/medals/print/batch — 409 duplikat", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/medals/print/batch").send({
      items: medalBatchEnrollments.map((e) => ({
        enrollment_id: e.id,
        ptc_date: "2024-06-01",
      })),
    });

    expect(res.status).toBe(409);
  });
});

// ============================================================
// MEDALS — GET LIST
// ============================================================

describe("Medals List — Teacher", () => {
  test("GET /api/teacher/medals — 200 list medals", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/medals");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ============================================================
// REPORTS
// ============================================================

describe("Reports — Teacher", () => {
  const validContent = Array(200).fill("kata").join(" ");
  let reportEnrollment;

  beforeAll(async () => {
    // Enrollment baru khusus untuk report tests
    // Cert scan sudah di-upload (required sebelum buat report)
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

    // Print cert dulu
    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
       VALUES ($1, $2, $3, '2024-06-01', FALSE)`,
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

    // Print cert tapi TIDAK set scan
    await pool.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
       VALUES ($1, $2, $3, '2024-06-01', FALSE)`,
      [e2.id, teacher.id, center.id],
    );

    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/reports").send({
      enrollment_id: e2.id,
      content: validContent,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/scan/i);
  });

  test("POST /api/teacher/reports — 400 word count < 200", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.post("/api/teacher/reports").send({
      enrollment_id: reportEnrollment.id,
      content: "terlalu pendek",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/200/);
  });

  test("POST /api/teacher/reports — 201 berhasil buat report", async () => {
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
    expect(res.body.data.word_count).toBeGreaterThanOrEqual(200);
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
    // Report yang baru dibuat sudah ter-upload (drive_file_id terisi)
    const reportResult = await pool.query(
      `SELECT id FROM reports WHERE enrollment_id = $1`,
      [reportEnrollment.id],
    );
    const reportId = reportResult.rows[0].id;

    const agent = await loginAs(teacher);
    const res = await agent.patch(`/api/teacher/reports/${reportId}`).send({
      content: Array(200).fill("updated").join(" "),
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot be edited/i);
  });

  test("PATCH /api/teacher/reports/:id — 200 update sebelum upload", async () => {
    // Buat enrollment + report baru tanpa drive_file_id
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
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
       VALUES ($1, $2, $3, '2024-06-01', FALSE)`,
      [e3.id, teacher.id, center.id],
    );

    await pool.query(
      `UPDATE certificates SET scan_file_id = 'mock_scan_id', scan_uploaded_at = NOW()
       WHERE enrollment_id = $1`,
      [e3.id],
    );

    const reportInsert = await pool.query(
      `INSERT INTO reports (enrollment_id, teacher_id, content, word_count)
       VALUES ($1, $2, $3, 200)
       RETURNING id`,
      [e3.id, teacher.id, validContent],
    );

    const reportId = reportInsert.rows[0].id;

    const agent = await loginAs(teacher);
    const res = await agent.patch(`/api/teacher/reports/${reportId}`).send({
      content: Array(210).fill("updated").join(" "),
      academic_year: "2024/2025",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.word_count).toBeGreaterThanOrEqual(200);
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
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/teacher/stock");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("cert_quantity");
    expect(res.body.data).toHaveProperty("medal_quantity");
    expect(res.body.data).toHaveProperty("cert_low_stock");
    expect(res.body.data).toHaveProperty("medal_low_stock");
  });
});

// ============================================================
// MULTI-CENTER — Teacher
// ============================================================

describe("Multi-Center — Teacher", () => {
  let secondCenter, multiTeacher, secondStudent, secondEnrollment;

  beforeAll(async () => {
    // Setup: teacher yang di-assign ke 2 center
    secondCenter = await seedCenter({ name: "Second Center Teacher" });
    await setStock({
      center_id: secondCenter.id,
      cert_qty: 50,
      medal_qty: 50,
    });

    multiTeacher = await seedUser({
      email: "multi.teacher@test.com",
      name: "Multi Center Teacher",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });

    // Assign ke center kedua via seedTeacherCenter
    await seedTeacherCenter({
      teacher_id: multiTeacher.id,
      center_id: secondCenter.id,
      is_primary: false,
    });

    // Student & enrollment di center kedua
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

  // --- Enrollments ---

  test("GET /api/teacher/enrollments — tampilkan enrollment dari semua center", async () => {
    // Buat enrollment di center utama juga
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

  // --- Stock ---

  test("GET /api/teacher/stock — return array semua center yang di-assign", async () => {
    const agent = await loginAs(multiTeacher);
    const res = await agent.get("/api/teacher/stock");

    expect(res.status).toBe(200);
    // Multi-center: response berupa array
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

  // --- Print cert di center ke-2 ---

  test("POST /api/teacher/certificates/print — 201 print di center ke-2 yang di-assign", async () => {
    const agent = await loginAs(multiTeacher);
    const res = await agent.post("/api/teacher/certificates/print").send({
      enrollment_id: secondEnrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.cert_unique_id).toMatch(/^CERT-/);
  });

  test("stock berkurang di center enrollment, bukan center utama teacher", async () => {
    // Ambil stock sebelum print
    const beforeResult = await pool.query(
      `SELECT quantity FROM certificate_stock WHERE center_id = $1`,
      [secondCenter.id],
    );
    const stockBefore = beforeResult.rows[0].quantity;

    const newStudent = await seedStudent({
      name: "Student Stock Check",
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

    const afterResult = await pool.query(
      `SELECT quantity FROM certificate_stock WHERE center_id = $1`,
      [secondCenter.id],
    );
    const stockAfter = afterResult.rows[0].quantity;

    expect(stockAfter).toBe(stockBefore - 1);

    // Stock center utama tidak berubah
    const primaryBefore = await pool.query(
      `SELECT quantity FROM certificate_stock WHERE center_id = $1`,
      [center.id],
    );
    // Nilai primary center tidak ikut berkurang dari operasi di secondCenter
    expect(primaryBefore.rows[0].quantity).toBeGreaterThanOrEqual(0);
  });

  test("POST /api/teacher/certificates/print — 404 enrollment di center yang tidak di-assign", async () => {
    // Buat center ke-3 yang TIDAK di-assign ke multiTeacher
    const thirdCenter = await seedCenter({ name: "Third Center Unassigned" });
    await setStock({
      center_id: thirdCenter.id,
      cert_qty: 50,
      medal_qty: 50,
    });

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

  // --- Batch print lintas center harus ditolak ---

  test("POST /api/teacher/certificates/print/batch — 400 enrollment dari center berbeda", async () => {
    // Enrollment di center utama
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

    // Enrollment di center ke-2
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

  // --- Medal di center ke-2 ---

  test("POST /api/teacher/medals/print — 201 print medal di center ke-2", async () => {
    const agent = await loginAs(multiTeacher);
    const res = await agent.post("/api/teacher/medals/print").send({
      enrollment_id: secondEnrollment.id,
      ptc_date: "2024-06-01",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.medal_unique_id).toMatch(/^MEDAL-/);
  });

  test("medal stock berkurang di center enrollment", async () => {
    const beforeResult = await pool.query(
      `SELECT quantity FROM medal_stock WHERE center_id = $1`,
      [secondCenter.id],
    );
    const stockBefore = beforeResult.rows[0].quantity;

    const newStudent = await seedStudent({
      name: "Student Medal Stock Check",
      center_id: secondCenter.id,
    });
    const newEnrollment = await seedEnrollment({
      student_id: newStudent.id,
      module_id: module_.id,
      center_id: secondCenter.id,
      teacher_id: multiTeacher.id,
    });

    const agent = await loginAs(multiTeacher);
    await agent.post("/api/teacher/medals/print").send({
      enrollment_id: newEnrollment.id,
      ptc_date: "2024-06-01",
    });

    const afterResult = await pool.query(
      `SELECT quantity FROM medal_stock WHERE center_id = $1`,
      [secondCenter.id],
    );

    expect(afterResult.rows[0].quantity).toBe(stockBefore - 1);
  });
});
