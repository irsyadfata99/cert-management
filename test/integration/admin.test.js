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
  setStock,
  closeDb,
} = require("./setup/testDb");

const loginAs = async (user) => {
  const agent = request.agent(app);
  await agent.post("/__test/login").send({ userId: user.id });
  return agent;
};

let center, otherCenter, admin, otherAdmin, teacher;

beforeAll(async () => {
  await truncateAll();

  center = await seedCenter({ name: "Center Admin Test" });
  otherCenter = await seedCenter({ name: "Other Center" });

  admin = await seedUser({
    email: "admin@test.com",
    name: "Admin Test",
    role: "admin",
    center_id: center.id,
    is_active: true,
  });

  otherAdmin = await seedUser({
    email: "other.admin@test.com",
    name: "Other Admin",
    role: "admin",
    center_id: otherCenter.id,
    is_active: true,
  });

  teacher = await seedUser({
    email: "teacher@test.com",
    name: "Teacher Test",
    role: "teacher",
    center_id: center.id,
    is_active: true,
  });

  await setStock({ center_id: center.id, cert_qty: 100, medal_qty: 100 });
  await setStock({ center_id: otherCenter.id, cert_qty: 100, medal_qty: 100 });
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

// ============================================================
// STUDENTS
// ============================================================

describe("Students — Admin", () => {
  test("POST /api/admin/students — 201 buat student", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/students").send({
      name: "Student Baru",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Student Baru");
    expect(res.body.data.center_id).toBe(center.id);
  });

  test("POST /api/admin/students — 400 nama kosong", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/students").send({ name: "" });

    expect(res.status).toBe(400);
  });

  test("GET /api/admin/students — 200 list students", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/admin/students");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });

  test("GET /api/admin/students — hanya return student center sendiri", async () => {
    await seedStudent({
      name: "Student Other Center",
      center_id: otherCenter.id,
    });

    const agent = await loginAs(admin);
    const res = await agent.get("/api/admin/students");

    expect(res.status).toBe(200);
    expect(res.body.data.every((s) => s.center_id === center.id)).toBe(true);
  });

  test("GET /api/admin/students — filter search", async () => {
    await seedStudent({ name: "Unique Student ZZZ", center_id: center.id });

    const agent = await loginAs(admin);
    const res = await agent.get("/api/admin/students?search=Unique");

    expect(res.status).toBe(200);
    expect(res.body.data.every((s) => s.name.includes("Unique"))).toBe(true);
  });

  test("GET /api/admin/students/:id — 200 detail student", async () => {
    const student = await seedStudent({
      name: "Student Detail",
      center_id: center.id,
    });

    const agent = await loginAs(admin);
    const res = await agent.get(`/api/admin/students/${student.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(student.id);
  });

  test("GET /api/admin/students/:id — 404 student center lain", async () => {
    const otherStudent = await seedStudent({
      name: "Student Other",
      center_id: otherCenter.id,
    });

    const agent = await loginAs(admin);
    const res = await agent.get(`/api/admin/students/${otherStudent.id}`);

    expect(res.status).toBe(404);
  });

  test("PATCH /api/admin/students/:id — 200 update nama", async () => {
    const student = await seedStudent({
      name: "Student Update",
      center_id: center.id,
    });

    const agent = await loginAs(admin);
    const res = await agent
      .patch(`/api/admin/students/${student.id}`)
      .send({ name: "Student Updated" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Student Updated");
  });

  test("PATCH /api/admin/students/:id/deactivate — 200", async () => {
    const student = await seedStudent({
      name: "Student Deactivate",
      center_id: center.id,
    });

    const agent = await loginAs(admin);
    const res = await agent.patch(
      `/api/admin/students/${student.id}/deactivate`,
    );

    expect(res.status).toBe(200);
  });

  test("PATCH /api/admin/students/:id/deactivate — 404 sudah nonaktif", async () => {
    const student = await seedStudent({
      name: "Student Already Inactive",
      center_id: center.id,
    });
    const agent = await loginAs(admin);

    await agent.patch(`/api/admin/students/${student.id}/deactivate`);
    const res = await agent.patch(
      `/api/admin/students/${student.id}/deactivate`,
    );

    expect(res.status).toBe(404);
  });

  test("401 jika tidak login", async () => {
    const res = await request(app).get("/api/admin/students");
    expect(res.status).toBe(401);
  });

  test("403 jika role teacher", async () => {
    const agent = await loginAs(teacher);
    const res = await agent.get("/api/admin/students");
    expect(res.status).toBe(403);
  });
});

// ============================================================
// MODULES
// ============================================================

describe("Modules — Admin", () => {
  test("POST /api/admin/modules — 201 buat module", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/modules").send({
      name: "Module Baru",
      description: "Deskripsi module",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Module Baru");
  });

  test("POST /api/admin/modules — 400 nama kosong", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/modules").send({});

    expect(res.status).toBe(400);
  });

  test("GET /api/admin/modules — 200 list modules", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/admin/modules");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("PATCH /api/admin/modules/:id — 200 update module", async () => {
    const module_ = await seedModule({ name: "Module Update Test" });

    const agent = await loginAs(admin);
    const res = await agent
      .patch(`/api/admin/modules/${module_.id}`)
      .send({ name: "Module Updated" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Module Updated");
  });

  test("PATCH /api/admin/modules/:id — 400 tidak ada field", async () => {
    const module_ = await seedModule({ name: "Module No Field" });

    const agent = await loginAs(admin);
    const res = await agent.patch(`/api/admin/modules/${module_.id}`).send({});

    expect(res.status).toBe(400);
  });

  test("PATCH /api/admin/modules/:id/deactivate — 200", async () => {
    const module_ = await seedModule({ name: "Module Deactivate" });

    const agent = await loginAs(admin);
    const res = await agent.patch(
      `/api/admin/modules/${module_.id}/deactivate`,
    );

    expect(res.status).toBe(200);
  });
});

// ============================================================
// TEACHERS
// ============================================================

describe("Teachers — Admin", () => {
  test("POST /api/admin/teachers — 201 pre-register teacher", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/teachers").send({
      email: "newteacher@test.com",
      name: "New Teacher",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe("teacher");
    expect(res.body.data.is_active).toBe(false);
    expect(res.body.data.center_id).toBe(center.id);
  });

  test("POST /api/admin/teachers — 409 email sudah ada", async () => {
    const agent = await loginAs(admin);

    await agent.post("/api/admin/teachers").send({
      email: "dup.teacher@test.com",
      name: "Dup Teacher",
    });

    const res = await agent.post("/api/admin/teachers").send({
      email: "dup.teacher@test.com",
      name: "Dup Teacher 2",
    });

    expect(res.status).toBe(409);
  });

  test("GET /api/admin/teachers — 200 list teachers center sendiri", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/admin/teachers");

    expect(res.status).toBe(200);
    expect(res.body.data.every((t) => t.center_id === center.id)).toBe(true);
  });

  test("PATCH /api/admin/teachers/:id/deactivate — 200", async () => {
    const t = await seedUser({
      email: "teacher.deact@test.com",
      name: "Teacher Deact",
      role: "teacher",
      center_id: center.id,
      is_active: true,
    });

    const agent = await loginAs(admin);
    const res = await agent.patch(`/api/admin/teachers/${t.id}/deactivate`);

    expect(res.status).toBe(200);
  });

  test("PATCH /api/admin/teachers/:id/deactivate — 404 teacher center lain", async () => {
    const t = await seedUser({
      email: "teacher.other.deact@test.com",
      name: "Teacher Other Deact",
      role: "teacher",
      center_id: otherCenter.id,
      is_active: true,
    });

    const agent = await loginAs(admin);
    const res = await agent.patch(`/api/admin/teachers/${t.id}/deactivate`);

    expect(res.status).toBe(404);
  });
});

// ============================================================
// ENROLLMENTS
// ============================================================

describe("Enrollments — Admin", () => {
  let student, module_, enrollment;

  beforeAll(async () => {
    student = await seedStudent({
      name: "Student Enrollment",
      center_id: center.id,
    });
    module_ = await seedModule({ name: "Module Enrollment" });
  });

  test("POST /api/admin/enrollments — 201 buat enrollment", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/enrollments").send({
      student_id: student.id,
      module_id: module_.id,
      teacher_id: teacher.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.student_id).toBe(student.id);
    expect(res.body.data.center_id).toBe(center.id);

    enrollment = res.body.data;
  });

  test("POST /api/admin/enrollments — 409 student sudah punya enrollment aktif", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/enrollments").send({
      student_id: student.id,
      module_id: module_.id,
      teacher_id: teacher.id,
    });

    expect(res.status).toBe(409);
  });

  test("POST /api/admin/enrollments — 404 student tidak ada", async () => {
    const newStudent = await seedStudent({
      name: "Student New Module",
      center_id: center.id,
    });
    const module2 = await seedModule({ name: "Module 2" });

    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/enrollments").send({
      student_id: 999999,
      module_id: module2.id,
      teacher_id: teacher.id,
    });

    expect(res.status).toBe(404);
  });

  test("POST /api/admin/enrollments — 404 teacher center lain", async () => {
    const newStudent = await seedStudent({
      name: "Student For Other Teacher",
      center_id: center.id,
    });
    const module2 = await seedModule({ name: "Module For Other Teacher" });
    const otherTeacher = await seedUser({
      email: "other.teacher.enroll@test.com",
      name: "Other Teacher Enroll",
      role: "teacher",
      center_id: otherCenter.id,
      is_active: true,
    });

    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/enrollments").send({
      student_id: newStudent.id,
      module_id: module2.id,
      teacher_id: otherTeacher.id,
    });

    expect(res.status).toBe(404);
  });

  test("GET /api/admin/enrollments — 200 list enrollments", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/admin/enrollments");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /api/admin/enrollments — hanya center sendiri", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/admin/enrollments");

    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => e.center_name !== undefined)).toBe(true);
  });

  test("GET /api/admin/enrollments/:id/pair-status — 200", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get(
      `/api/admin/enrollments/${enrollment.id}/pair-status`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.enrollment_id).toBe(enrollment.id);
    expect(res.body.data.pair_complete).toBe(false);
    expect(res.body.data.missing_items).toContain("certificate scan");
    expect(res.body.data.missing_items).toContain("final report on Drive");
  });

  test("GET /api/admin/enrollments/:id/pair-status — 404 tidak ada", async () => {
    const agent = await loginAs(admin);
    const res = await agent.get("/api/admin/enrollments/999999/pair-status");

    expect(res.status).toBe(404);
  });

  test("PATCH /api/admin/enrollments/:id/deactivate — 200", async () => {
    const s2 = await seedStudent({
      name: "Student Deact Enroll",
      center_id: center.id,
    });
    const m2 = await seedModule({ name: "Module Deact Enroll" });
    const e2 = await seedEnrollment({
      student_id: s2.id,
      module_id: m2.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    const agent = await loginAs(admin);
    const res = await agent.patch(`/api/admin/enrollments/${e2.id}/deactivate`);

    expect(res.status).toBe(200);
  });
});

// ============================================================
// MIGRATE
// ============================================================

describe("Migrate — Admin", () => {
  let student, module_, enrollment;

  beforeAll(async () => {
    student = await seedStudent({
      name: "Student Migrate",
      center_id: center.id,
    });
    module_ = await seedModule({ name: "Module Migrate" });
    enrollment = await seedEnrollment({
      student_id: student.id,
      module_id: module_.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });
  });

  test("POST /api/admin/migrate — 200 berhasil migrate", async () => {
    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/migrate").send({
      enrollment_id: enrollment.id,
      to_center_id: otherCenter.id,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.from_center_id).toBe(center.id);
    expect(res.body.data.to_center_id).toBe(otherCenter.id);
  });

  test("POST /api/admin/migrate — 400 same center", async () => {
    const s2 = await seedStudent({
      name: "Student Same Center",
      center_id: center.id,
    });
    const m2 = await seedModule({ name: "Module Same Center" });
    const e2 = await seedEnrollment({
      student_id: s2.id,
      module_id: m2.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/migrate").send({
      enrollment_id: e2.id,
      to_center_id: center.id,
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/admin/migrate — 404 enrollment center lain", async () => {
    const s3 = await seedStudent({
      name: "Student Other Center Migrate",
      center_id: otherCenter.id,
    });
    const m3 = await seedModule({ name: "Module Other Center Migrate" });
    const otherTeacher = await seedUser({
      email: "teacher.other.migrate@test.com",
      name: "Teacher Other Migrate",
      role: "teacher",
      center_id: otherCenter.id,
      is_active: true,
    });
    const e3 = await seedEnrollment({
      student_id: s3.id,
      module_id: m3.id,
      center_id: otherCenter.id,
      teacher_id: otherTeacher.id,
    });

    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/migrate").send({
      enrollment_id: e3.id,
      to_center_id: center.id,
    });

    expect(res.status).toBe(404);
  });

  test("POST /api/admin/migrate — 404 target center tidak ada", async () => {
    const s4 = await seedStudent({
      name: "Student No Target",
      center_id: center.id,
    });
    const m4 = await seedModule({ name: "Module No Target" });
    const e4 = await seedEnrollment({
      student_id: s4.id,
      module_id: m4.id,
      center_id: center.id,
      teacher_id: teacher.id,
    });

    const agent = await loginAs(admin);
    const res = await agent.post("/api/admin/migrate").send({
      enrollment_id: e4.id,
      to_center_id: 999999,
    });

    expect(res.status).toBe(404);
  });
});
