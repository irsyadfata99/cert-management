const { z } = require("zod");

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

const scoreEnum = z
  .union([z.enum(["A+", "A", "B+", "B"]), z.null()])
  .optional();

const ptcDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

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

const createAdminBody = z.object({
  email: z.string().email("Invalid email format").max(255),
  name: z.string().min(1, "Name is required").max(255),
});

const updateAdminBody = z
  .object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email("Invalid email format").max(255).optional(),
  })
  .refine((d) => d.name !== undefined || d.email !== undefined, {
    message: "At least one field (name or email) must be provided",
  });

const listAdminsQuery = paginationQuery.extend({
  center_id: z.string().regex(/^\d+$/).optional(),
});

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

const monitoringReprintsQuery = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  center_id: z.string().regex(/^\d+$/).optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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

const createStudentBody = z.object({
  name: z.string().min(1, "Student name is required").max(255),
  center_id: z.number().int().positive().optional(),
});

const updateStudentBody = z
  .object({
    name: z.string().min(1, "Student name is required").max(255).optional(),
    center_id: z.number().int().positive().optional(),
  })
  .refine((d) => d.name !== undefined || d.center_id !== undefined, {
    message: "At least one field (name or center_id) must be provided",
  });

const listStudentsQuery = paginationQuery.extend({
  center_id: z.string().regex(/^\d+$/).optional(),
});

// ── Module Validators (Updated) ───────────────────────────────

const createModuleBody = z.object({
  code: z.string().min(1, "Module code is required").max(100),
  name: z.string().min(1, "Module name is required").max(255),
  description: z.string().max(1000).optional(),
});

const updateModuleBody = z
  .object({
    code: z.string().min(1).max(100).optional(),
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).nullable().optional(),
  })
  .refine(
    (d) =>
      d.code !== undefined ||
      d.name !== undefined ||
      d.description !== undefined,
    {
      message: "At least one field must be provided",
    },
  );

// ── Teacher Validators ────────────────────────────────────────

const createTeacherBody = z.object({
  email: z.string().email("Invalid email format").max(255),
  name: z.string().min(1, "Name is required").max(255),
  center_id: z.number().int().positive().optional(),
});

const updateTeacherBody = z
  .object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email("Invalid email format").max(255).optional(),
  })
  .refine((d) => d.name !== undefined || d.email !== undefined, {
    message: "At least one field (name or email) must be provided",
  });

const assignTeacherCenterBody = z.object({
  center_id: z
    .number({ required_error: "center_id is required" })
    .int()
    .positive(),
  is_primary: z.boolean().optional(),
});

const listTeachersQuery = paginationQuery.extend({
  center_id: z.string().regex(/^\d+$/).optional(),
});

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
  search: z.string().max(100).optional(),
  enrollment_status: z
    .enum([
      "pending",
      "cert_printed",
      "scan_uploaded",
      "report_uploaded",
      "complete",
    ])
    .optional(),
});

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
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

// ── Stock Validators ──────────────────────────────────────────

const addCertificateBatchBody = z
  .object({
    center_id: z.number().int().positive().optional(),
    range_start: z
      .number({ required_error: "range_start is required" })
      .int()
      .positive("range_start must be a positive integer"),
    range_end: z
      .number({ required_error: "range_end is required" })
      .int()
      .positive("range_end must be a positive integer"),
  })
  .refine((d) => d.range_start <= d.range_end, {
    message: "range_start must be <= range_end",
    path: ["range_start"],
  });

const transferCertificateBatchBody = z.object({
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
    .positive("quantity must be a positive integer"),
});

const addMedalStockBody = z.object({
  center_id: z.number().int().positive().optional(),
  quantity: z
    .number({ required_error: "quantity is required" })
    .int()
    .positive("Quantity must be positive"),
});

const transferMedalStockBody = z.object({
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

const addStockBody = z.object({
  center_id: z.number().int().positive().optional(),
  type: z.enum(["medal"], {
    required_error: "type is required",
  }),
  quantity: z
    .number({ required_error: "quantity is required" })
    .int()
    .positive("Quantity must be positive"),
});

const transferStockBody = z.object({
  type: z.enum(["medal"], {
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

// ── Validate Middleware ───────────────────────────────────────

const validate = (schema, target = "body") => {
  return (req, res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
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
  createCenterBody,
  updateCenterBody,
  createAdminBody,
  updateAdminBody,
  listAdminsQuery,
  monitoringUploadQuery,
  monitoringActivityQuery,
  monitoringReprintsQuery,
  downloadEnrollmentsQuery,
  createStudentBody,
  updateStudentBody,
  listStudentsQuery,
  createModuleBody,
  updateModuleBody,
  createTeacherBody,
  updateTeacherBody,
  assignTeacherCenterBody,
  listTeachersQuery,
  createEnrollmentBody,
  listEnrollmentsQuery,
  printCertBody,
  printCertBatchBody,
  reprintCertBody,
  listCertsQuery,
  createReportBody,
  updateReportBody,
  // Stock - Certificate Batch
  addCertificateBatchBody,
  transferCertificateBatchBody,
  // Stock - Medal
  addMedalStockBody,
  transferMedalStockBody,
  // Stock - General
  addStockBody,
  transferStockBody,
  updateThresholdBody,
  idParam,
  paginationQuery,
};
