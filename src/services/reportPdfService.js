const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const fs = require("fs");
const path = require("path");
const logger = require("../config/logger");

const PAGE_HEIGHT = 842;
const TEMPLATE_PATH = path.join(__dirname, "../assets/template_report_ptc.pdf");
const FONT_REGULAR_PATH = path.join(
  __dirname,
  "../assets/fonts/calibri-regular.ttf",
);
const FONT_BOLD_PATH = path.join(__dirname, "../assets/fonts/calibri-bold.ttf");

// Validate required assets exist at module load time so the error is
// caught early (during startup) rather than silently at report generation.
const REQUIRED_ASSETS = [
  { path: TEMPLATE_PATH, label: "PDF template" },
  { path: FONT_REGULAR_PATH, label: "Calibri Regular font" },
  { path: FONT_BOLD_PATH, label: "Calibri Bold font" },
];

for (const asset of REQUIRED_ASSETS) {
  if (!fs.existsSync(asset.path)) {
    // Log as error and throw so the process fails fast with a clear message.
    const msg = `Required asset not found: ${asset.label} at ${asset.path}`;
    logger.error(msg);
    throw new Error(msg);
  }
}

// Template bytes are cached after first load. Restart the server to pick
// up a new template file (intentional — templates should not change at runtime).
let _cachedTemplateBytes = null;

const getTemplateBytes = () => {
  if (_cachedTemplateBytes) return _cachedTemplateBytes;
  _cachedTemplateBytes = fs.readFileSync(TEMPLATE_PATH);
  return _cachedTemplateBytes;
};

const FIELD_POSITIONS = {
  student_name: { x: 370, y: PAGE_HEIGHT - 85.0 },
  academic_year: { x: 370, y: PAGE_HEIGHT - 100.2 },
  period: { x: 370, y: PAGE_HEIGHT - 114.8 },
  teacher_name: { x: 370, y: PAGE_HEIGHT - 129.5 },
  score_creativity: { centerY: 636.5 },
  score_critical_thinking: { centerY: 584.5 },
  score_attention: { centerY: 532.5 },
  score_responsibility: { centerY: 480.5 },
  score_coding_skills: { centerY: 428.5 },
  comment: { x: 74.7, y: PAGE_HEIGHT - 504.0, maxWidth: 450 },
};

// Score box from template: x=484.5 to x=535.5, width=51
const SCORE_BOX = { x: 484.5, width: 51 };

const FONT_SIZE_HEADER = 12;
const FONT_SIZE_SCORE = 12;
const FONT_SIZE_COMMENT = 12;
const LINE_HEIGHT = 16;
// Comment stops here — leaves room for legend at bottom
const COMMENT_BOTTOM_Y = PAGE_HEIGHT - 700;

const COVER_WIDTHS = {
  student_name: 230,
  academic_year: 110,
  period: 200,
  teacher_name: 230,
};

// ── Helpers ───────────────────────────────────────────────────

const normalizeText = (text) =>
  text
    .replace(/\r\n/g, " ")
    .replace(/[\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const wrapText = (text, font, fontSize, maxWidth) => {
  const normalized = normalizeText(text);
  const words = normalized.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
};

const truncateText = (text, font, fontSize, maxWidth) => {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;

  let truncated = text;
  while (
    truncated.length > 0 &&
    font.widthOfTextAtSize(truncated + "…", fontSize) > maxWidth
  ) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "…";
};

// ── Draw justified text line ──────────────────────────────────
const drawJustifiedLine = (
  page,
  line,
  x,
  y,
  font,
  fontSize,
  maxWidth,
  isLast,
  color,
) => {
  const words = line.split(" ");

  if (isLast || words.length === 1) {
    page.drawText(line, { x, y, size: fontSize, font, color });
    return;
  }

  const totalTextWidth = words.reduce(
    (sum, w) => sum + font.widthOfTextAtSize(w, fontSize),
    0,
  );
  const spaceWidth = (maxWidth - totalTextWidth) / (words.length - 1);

  let currentX = x;
  for (const word of words) {
    page.drawText(word, { x: currentX, y, size: fontSize, font, color });
    currentX += font.widthOfTextAtSize(word, fontSize) + spaceWidth;
  }
};

// ── Main generator ────────────────────────────────────────────

const generateReportPdf = async (data) => {
  const {
    studentName,
    teacherName,
    academicYear,
    period,
    scoreCreativity,
    scoreCriticalThinking,
    scoreAttention,
    scoreResponsibility,
    scoreCodingSkills,
    content,
  } = data;

  const templateBytes = getTemplateBytes();
  const pdfDoc = await PDFDocument.load(templateBytes);

  // Register fontkit for custom font embedding
  pdfDoc.registerFontkit(fontkit);

  // Embed Calibri fonts
  const fontRegularBytes = fs.readFileSync(FONT_REGULAR_PATH);
  const fontBoldBytes = fs.readFileSync(FONT_BOLD_PATH);
  const font = await pdfDoc.embedFont(fontRegularBytes);
  const fontBold = await pdfDoc.embedFont(fontBoldBytes);

  const page = pdfDoc.getPages()[0];
  const black = rgb(0, 0, 0);

  // ── Header fields — no background (transparent) ───────────
  const drawHeader = (text, posKey) => {
    if (!text) return;
    const pos = FIELD_POSITIONS[posKey];
    const width = COVER_WIDTHS[posKey] || 160;
    const safe = truncateText(String(text), font, FONT_SIZE_HEADER, width - 4);

    page.drawText(safe, {
      x: pos.x,
      y: pos.y,
      size: FONT_SIZE_HEADER,
      font,
      color: black,
    });
  };

  drawHeader(studentName, "student_name");
  drawHeader(academicYear ?? "-", "academic_year");
  drawHeader(period ?? "-", "period");
  drawHeader(teacherName, "teacher_name");

  // ── Scores — black, centered horizontally & vertically ────
  const scores = [
    { key: "score_creativity", val: scoreCreativity },
    { key: "score_critical_thinking", val: scoreCriticalThinking },
    { key: "score_attention", val: scoreAttention },
    { key: "score_responsibility", val: scoreResponsibility },
    { key: "score_coding_skills", val: scoreCodingSkills },
  ];

  for (const { key, val } of scores) {
    if (!val) continue;
    const pos = FIELD_POSITIONS[key];
    const label = String(val);
    const textW = fontBold.widthOfTextAtSize(label, FONT_SIZE_SCORE);
    const textH = FONT_SIZE_SCORE;

    // Exact center from template coordinates
    const drawX = SCORE_BOX.x + SCORE_BOX.width / 2 - textW / 2;
    const drawY = pos.centerY - textH / 2;

    page.drawText(label, {
      x: drawX,
      y: drawY,
      size: FONT_SIZE_SCORE,
      font: fontBold,
      color: black,
    });
  }

  // ── Comment — Calibri Regular, justified ──────────────────
  if (content) {
    const pos = FIELD_POSITIONS.comment;

    // Cover placeholder text only
    page.drawRectangle({
      x: pos.x,
      y: pos.y - 2,
      width: 460,
      height: 14,
      color: rgb(1, 1, 1),
    });

    const lines = wrapText(content, font, FONT_SIZE_COMMENT, pos.maxWidth);
    let currentY = pos.y;

    for (let i = 0; i < lines.length; i++) {
      if (currentY < COMMENT_BOTTOM_Y) break;

      const isLast = i === lines.length - 1;
      drawJustifiedLine(
        page,
        lines[i],
        pos.x,
        currentY,
        font,
        FONT_SIZE_COMMENT,
        pos.maxWidth,
        isLast,
        black,
      );
      currentY -= LINE_HEIGHT;
    }
  }

  const pdfBytes = await pdfDoc.save();
  const buffer = Buffer.from(pdfBytes);

  logger.info("Report PDF generated", {
    studentName,
    teacherName,
    bufferSize: buffer.length,
  });

  return buffer;
};

module.exports = { generateReportPdf };
