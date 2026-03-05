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
  student_name: { x: 370, y: PAGE_HEIGHT - 87.2 },
  academic_year: { x: 370, y: PAGE_HEIGHT - 102.4 },
  period: { x: 370, y: PAGE_HEIGHT - 117.0 },
  teacher_name: { x: 370, y: PAGE_HEIGHT - 131.7 },
  score_creativity: { x: 495, y: PAGE_HEIGHT - 199.2 },
  score_critical_thinking: { x: 495, y: PAGE_HEIGHT - 251.3 },
  score_attention: { x: 495, y: PAGE_HEIGHT - 303.3 },
  score_responsibility: { x: 495, y: PAGE_HEIGHT - 355.3 },
  score_coding_skills: { x: 495, y: PAGE_HEIGHT - 407.3 },
  comment: { x: 74.7, y: PAGE_HEIGHT - 504.0, maxWidth: 450 },
};

const FONT_SIZE_NORMAL = 9;
const FONT_SIZE_SCORE = 9;
const FONT_SIZE_COMMENT = 9;
const LINE_HEIGHT = 13;
const COMMENT_BOTTOM_Y = PAGE_HEIGHT - 585;
const COVER_WIDTHS = {
  student_name: 230,
  academic_year: 110,
  period: 200,
  teacher_name: 230,
};

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
  const blue = rgb(0.18, 0.46, 0.71);

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

    page.drawRectangle({
      x: pos.x - 4,
      y: pos.y - 2,
      width: 34,
      height: 14,
      color: rgb(1, 1, 1),
    });
    page.drawText(String(val), {
      x: pos.x,
      y: pos.y,
      size: FONT_SIZE_SCORE,
      font: fontBold,
      color: blue,
    });
  }

  if (content) {
    const pos = FIELD_POSITIONS.comment;

    page.drawRectangle({
      x: pos.x,
      y: pos.y - 2,
      width: 200,
      height: 12,
      color: rgb(1, 1, 1),
    });

    const lines = wrapText(content, font, FONT_SIZE_COMMENT, pos.maxWidth);
    let currentY = pos.y;

    for (const line of lines) {
      if (currentY < COMMENT_BOTTOM_Y) break;

      page.drawText(line, {
        x: pos.x,
        y: currentY,
        size: FONT_SIZE_COMMENT,
        font,
        color: black,
      });
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
