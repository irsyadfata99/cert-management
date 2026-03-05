const { z } = require("zod");

// ============================================================
// SHARED
// ============================================================

const idParam = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a number"),
});

const paginationQuery = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  sort_by: z.string().optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
  search: z.string().max(100).optional(),
  is_active: z.enum(["true", "false"]).optional(),
});

// FIX: Zod v4 — gunakan z.union agar null dan undefined keduanya valid
// z.enum().nullable().optional() bisa berperilaku tidak konsisten di v4
const scoreEnum = z
  .union([z.enum(["A+", "A", "B+", "B"]), z.null()])
  .optional();

const ptcDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

// ============================================================
// SUPER ADMIN — Centers
// ============================================================

const createCenterBody = z.object({
  name: z.string().min(1, "Center name is required").max(255),
  address: z.string().max(500).optional(),
});

const updateCenterBody = z
  .object({
    name: z.string().min(1).max(255).optional(),
    address: z.string().max(500).nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.address !== undefined, {
    message: "At least one field (name or address) must be provided",
  });

// SUPER ADMIN — Admins
const createAdminBody = z.object({
  email: z.string().email("Invalid email format").max(255),
  name: z.string().min(1, "Name is required").max(255),
  center_id: z
    .number({ required_error: "center_id is required" })
    .int()
    .positive(),
});

// SUPER ADMIN — Monitoring
const monitoringUploadQuery = paginationQuery.extend({
  center_id: z.string().regex(/^\d+$/).optional(),
  status: z
    .enum([
      "not_started",
      "printed",
      "scan_uploaded",
      "report_drafted",
      "complete",
    ])
    .optional(),
});

const monitoringActivityQuery = z.object({
  center_id: z.string().regex(/^\d+$/).optional(),
});

const downloadEnrollmentsQuery = z.object({
  center_id: z.string().regex(/^\d+$/).optional(),
  module_id: z.string().regex(/^\d+$/).optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

// ============================================================
// ADMIN — Students
// ============================================================

const createStudentBody = z.object({
  name: z.string().min(1, "Student name is required").max(255),
  center_id: z.number().int().positive().optional(),
});

const updateStudentBody = z.object({
  name: z.string().min(1, "Student name is required").max(255),
});

const listStudentsQuery = paginationQuery.extend({
  center_id: z.string().regex(/^\d+$/).optional(),
});

// ADMIN — Modules
const createModuleBody = z.object({
  name: z.string().min(1, "Module name is required").max(255),
  description: z.string().max(1000).optional(),
});

const updateModuleBody = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).nullable().optional(),
  })
  .refine((d) => d.name !== undefined || d.description !== undefined, {
    message: "At least one field must be provided",
  });

// ADMIN — Teachers
const createTeacherBody = z.object({
  email: z.string().email("Invalid email format").max(255),
  name: z.string().min(1, "Name is required").max(255),
  center_id: z.number().int().positive().optional(),
});

const listTeachersQuery = paginationQuery.extend({
  center_id: z.string().regex(/^\d+$/).optional(),
});

// ADMIN — Enrollments
const createEnrollmentBody = z.object({
  student_id: z
    .number({ required_error: "student_id is required" })
    .int()
    .positive(),
  module_id: z
    .number({ required_error: "module_id is required" })
    .int()
    .positive(),
  teacher_id: z
    .number({ required_error: "teacher_id is required" })
    .int()
    .positive(),
});

const listEnrollmentsQuery = paginationQuery.extend({
  center_id: z.string().regex(/^\d+$/).optional(),
  teacher_id: z.string().regex(/^\d+$/).optional(),
  module_id: z.string().regex(/^\d+$/).optional(),
});

// ADMIN — Migrate
// [FIX] Dipindah dari bagian SUPER ADMIN karena migrate sekarang ada di admin route.
// Super admin juga bisa akses endpoint ini karena authorize("admin", "super_admin").
const migrateBody = z.object({
  enrollment_id: z
    .number({ required_error: "enrollment_id is required" })
    .int()
    .positive(),
  to_center_id: z
    .number({ required_error: "to_center_id is required" })
    .int()
    .positive(),
});

// ============================================================
// TEACHER — Certificates
// ============================================================

const printCertBody = z.object({
  enrollment_id: z
    .number({ required_error: "enrollment_id is required" })
    .int()
    .positive(),
  ptc_date: ptcDateSchema,
});

const printCertBatchBody = z.object({
  items: z
    .array(
      z.object({
        enrollment_id: z.number().int().positive(),
        ptc_date: ptcDateSchema,
      }),
      { required_error: "items array is required" },
    )
    .min(1, "At least one item is required")
    .max(100, "Batch size cannot exceed 100"),
});

const reprintCertBody = z.object({
  original_cert_id: z
    .number({ required_error: "original_cert_id is required" })
    .int()
    .positive(),
  ptc_date: ptcDateSchema,
});

const listCertsQuery = paginationQuery.extend({
  is_reprint: z.enum(["true", "false"]).optional(),
});

// TEACHER — Medals
const printMedalBody = z.object({
  enrollment_id: z
    .number({ required_error: "enrollment_id is required" })
    .int()
    .positive(),
  ptc_date: ptcDateSchema,
});

const printMedalBatchBody = z.object({
  items: z
    .array(
      z.object({
        enrollment_id: z.number().int().positive(),
        ptc_date: ptcDateSchema,
      }),
      { required_error: "items array is required" },
    )
    .min(1, "At least one item is required")
    .max(100, "Batch size cannot exceed 100"),
});

// TEACHER — Reports
const createReportBody = z.object({
  enrollment_id: z
    .number({ required_error: "enrollment_id is required" })
    .int()
    .positive(),
  content: z.string().min(1, "Content is required"),
  academic_year: z.string().max(20).optional(),
  period: z.string().max(100).optional(),
  score_creativity: scoreEnum,
  score_critical_thinking: scoreEnum,
  score_attention: scoreEnum,
  score_responsibility: scoreEnum,
  score_coding_skills: scoreEnum,
});

const updateReportBody = z
  .object({
    content: z.string().min(1).optional(),
    academic_year: z.string().max(20).optional(),
    period: z.string().max(100).optional(),
    score_creativity: scoreEnum,
    score_critical_thinking: scoreEnum,
    score_attention: scoreEnum,
    score_responsibility: scoreEnum,
    score_coding_skills: scoreEnum,
  })
  .refine(
    // null dianggap sebagai field yang di-provide (user sengaja clear score)
    // undefined berarti field tidak disertakan sama sekali
    (d) => Object.values(d).some((v) => v !== undefined),
    { message: "At least one field must be provided" },
  );

// ============================================================
// DRIVE — Stock
// ============================================================

const addStockBody = z.object({
  center_id: z.number().int().positive().optional(),
  type: z.enum(["certificate", "medal"], {
    required_error: "type is required",
  }),
  quantity: z
    .number({ required_error: "quantity is required" })
    .int()
    .positive("Quantity must be positive"),
});

const transferStockBody = z.object({
  type: z.enum(["certificate", "medal"], {
    required_error: "type is required",
  }),
  from_center_id: z
    .number({ required_error: "from_center_id is required" })
    .int()
    .positive(),
  to_center_id: z
    .number({ required_error: "to_center_id is required" })
    .int()
    .positive(),
  quantity: z
    .number({ required_error: "quantity is required" })
    .int()
    .positive(),
});

const updateThresholdBody = z.object({
  center_id: z.number().int().positive().optional(),
  type: z.enum(["certificate", "medal"], {
    required_error: "type is required",
  }),
  threshold: z
    .number({ required_error: "threshold is required" })
    .int()
    .min(0, "Threshold must be >= 0"),
});

// ============================================================
// MIDDLEWARE FACTORY
// ============================================================

/**
 * Buat Express middleware dari Zod schema.
 * @param {import("zod").ZodSchema} schema
 * @param {"body"|"query"|"params"} target
 */
const validate = (schema, target = "body") => {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      // SESUDAH
      const errors = (result.error.issues ?? result.error.errors ?? []).map(
        (e) => ({
          field: e.path.join("."),
          message: e.message,
        }),
      );

      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    req[target] = result.data;
    next();
  };
};

module.exports = {
  validate,
  // Super Admin
  createCenterBody,
  updateCenterBody,
  createAdminBody,
  monitoringUploadQuery,
  monitoringActivityQuery,
  downloadEnrollmentsQuery,
  // Admin
  createStudentBody,
  updateStudentBody,
  listStudentsQuery,
  createModuleBody,
  updateModuleBody,
  createTeacherBody,
  listTeachersQuery,
  createEnrollmentBody,
  listEnrollmentsQuery,
  migrateBody,
  // Teacher
  printCertBody,
  printCertBatchBody,
  reprintCertBody,
  listCertsQuery,
  printMedalBody,
  printMedalBatchBody,
  createReportBody,
  updateReportBody,
  // Drive / Stock
  addStockBody,
  transferStockBody,
  updateThresholdBody,
  // Shared
  idParam,
  paginationQuery,
};
