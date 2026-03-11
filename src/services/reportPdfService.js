const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const logger = require("../config/logger");

const PAGE_HEIGHT = 842;
const TEMPLATE_PATH = path.join(__dirname, "../assets/template_report_ptc.pdf");
let _cachedTemplateBytes = null;

const getTemplateBytes = () => {
  if (_cachedTemplateBytes) return _cachedTemplateBytes;

  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`PDF template not found at: ${TEMPLATE_PATH}`);
  }

  _cachedTemplateBytes = fs.readFileSync(TEMPLATE_PATH);
  return _cachedTemplateBytes;
};

const FIELD_POSITIONS = {
  student_name: { x: 370, y: PAGE_HEIGHT - 85.0 },
  academic_year: { x: 370, y: PAGE_HEIGHT - 100.2 },
  period: { x: 370, y: PAGE_HEIGHT - 114.8 },
  teacher_name: { x: 370, y: PAGE_HEIGHT - 129.5 },
  score_creativity: { x: 495, y: PAGE_HEIGHT - 199.2 },
  score_critical_thinking: { x: 495, y: PAGE_HEIGHT - 251.3 },
  score_attention: { x: 495, y: PAGE_HEIGHT - 303.3 },
  score_responsibility: { x: 495, y: PAGE_HEIGHT - 355.3 },
  score_coding_skills: { x: 495, y: PAGE_HEIGHT - 407.3 },
  comment: { x: 74.7, y: PAGE_HEIGHT - 504.0, maxWidth: 450 },
};

// Score box dimensions — match template box size
// width: cover area, height: actual box height for vertical centering
const SCORE_BOX = { width: 34, height: 40 };

const FONT_SIZE_NORMAL = 9;
const FONT_SIZE_SCORE = 10;
const FONT_SIZE_COMMENT = 9;
const LINE_HEIGHT = 13;
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
// For the last line of a paragraph, draw normally (left-aligned).
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
    // Last line or single word: left-aligned
    page.drawText(line, { x, y, size: fontSize, font, color });
    return;
  }

  const totalTextWidth = words.reduce(
    (sum, w) => sum + font.widthOfTextAtSize(w, fontSize),
    0,
  );
  const totalSpaceWidth = maxWidth - totalTextWidth;
  const spaceWidth = totalSpaceWidth / (words.length - 1);

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

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.getPages()[0];
  const black = rgb(0, 0, 0);

  // ── Header fields ─────────────────────────────────────────
  const coverAndDraw = (text, posKey) => {
    if (!text) return;
    const pos = FIELD_POSITIONS[posKey];
    const width = COVER_WIDTHS[posKey] || 160;
    const safe = truncateText(String(text), font, FONT_SIZE_NORMAL, width - 4);

    page.drawRectangle({
      x: pos.x,
      y: pos.y - 2,
      width,
      height: 12,
      color: rgb(1, 1, 1),
    });
    page.drawText(safe, {
      x: pos.x,
      y: pos.y,
      size: FONT_SIZE_NORMAL,
      font,
      color: black,
    });
  };

  coverAndDraw(studentName, "student_name");
  coverAndDraw(academicYear ?? "-", "academic_year");
  coverAndDraw(period ?? "-", "period");
  coverAndDraw(teacherName, "teacher_name");

  // ── Scores — black, centered in box ───────────────────────
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
    // Center horizontally in box
    const centerX = pos.x + SCORE_BOX.width / 2 - textW / 2;
    // Center vertically in box: pos.y is top of box, shift down to middle
    const centerY = pos.y - SCORE_BOX.height / 2 + FONT_SIZE_SCORE / 2;

    // Cover placeholder only — keep rectangle small so it doesn't hide template borders
    page.drawRectangle({
      x: pos.x - 4,
      y: pos.y - 2,
      width: SCORE_BOX.width,
      height: 14,
      color: rgb(1, 1, 1),
    });

    page.drawText(label, {
      x: centerX,
      y: centerY,
      size: FONT_SIZE_SCORE,
      font: fontBold,
      color: black,
    });
  }

  // ── Comment — justified ───────────────────────────────────
  if (content) {
    const pos = FIELD_POSITIONS.comment;

    // Cover placeholder text
    page.drawRectangle({
      x: pos.x,
      y: pos.y - 2,
      width: 460,
      height: 12,
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
