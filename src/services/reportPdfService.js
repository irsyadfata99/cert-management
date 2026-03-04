const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const logger = require("../config/logger");

// ============================================================
// CONSTANTS
// ============================================================

// Koordinat diukur dari pojok kiri BAWAH halaman (pdf-lib convention).
// Page height = 842pt. Konversi dari pdfplumber (top-origin):
//   pdf_lib_y = pageHeight - pdfplumber_top - fontSize
//
// Score boxes berada di kolom kanan (x ≈ 491) sejajar tiap kategori.
// Kita tulis score di tengah box tersebut.

const PAGE_HEIGHT = 842;
const TEMPLATE_PATH = path.join(__dirname, "../assets/template_report_ptc.pdf");

// Posisi field data (x, y dalam pdf-lib coords)
const FIELD_POSITIONS = {
  student_name: { x: 370, y: PAGE_HEIGHT - 87.2 },
  academic_year: { x: 370, y: PAGE_HEIGHT - 102.4 },
  period: { x: 370, y: PAGE_HEIGHT - 117.0 },
  teacher_name: { x: 370, y: PAGE_HEIGHT - 131.7 },

  // Score boxes — di tengah box kanan (x≈491–530, tengah ≈505)
  score_creativity: { x: 503, y: PAGE_HEIGHT - 199.2 },
  score_critical_thinking: { x: 503, y: PAGE_HEIGHT - 251.3 },
  score_attention: { x: 503, y: PAGE_HEIGHT - 303.3 },
  score_responsibility: { x: 503, y: PAGE_HEIGHT - 355.3 },
  score_coding_skills: { x: 503, y: PAGE_HEIGHT - 407.3 },

  // Comment — mulai dari bawah judul COMMENT
  comment: { x: 74.7, y: PAGE_HEIGHT - 504.0, maxWidth: 450 },
};

const FONT_SIZE_NORMAL = 9;
const FONT_SIZE_SCORE = 9;
const FONT_SIZE_COMMENT = 9;
const LINE_HEIGHT = 13; // pt per baris untuk word-wrap comment

// ============================================================
// HELPER: word-wrap teks menjadi array baris
// ============================================================

const wrapText = (text, font, fontSize, maxWidth) => {
  const words = text.split(" ");
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

// ============================================================
// MAIN: generateReportPdf
// ============================================================

/**
 * Isi template PDF dengan data report dan kembalikan Buffer.
 *
 * @param {object} data
 * @param {string} data.studentName
 * @param {string} data.teacherName
 * @param {string|null} data.academicYear
 * @param {string|null} data.period
 * @param {string|null} data.scoreCreativity
 * @param {string|null} data.scoreCriticalThinking
 * @param {string|null} data.scoreAttention
 * @param {string|null} data.scoreResponsibility
 * @param {string|null} data.scoreCodingSkills
 * @param {string} data.content  - teks komentar (min 200 kata)
 * @returns {Promise<Buffer>}
 */
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

  // Load template dari disk
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`PDF template not found at: ${TEMPLATE_PATH}`);
  }

  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const pdfDoc = await PDFDocument.load(templateBytes);

  // Embed font
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.getPages()[0];
  const black = rgb(0, 0, 0);
  const blue = rgb(0.18, 0.46, 0.71); // warna score agar menonjol

  // ============================================================
  // Helper draw teks — hapus placeholder lama lalu tulis baru
  // ============================================================
  const drawField = (text, pos, options = {}) => {
    if (!text) return;
    page.drawText(String(text), {
      x: pos.x,
      y: pos.y,
      size: options.size ?? FONT_SIZE_NORMAL,
      font: options.font ?? font,
      color: options.color ?? black,
    });
  };

  // ============================================================
  // ISI FIELD HEADER
  // Tulis di atas posisi placeholder yang sudah ada di template.
  // pdf-lib overlay — teks baru ditulis di atas layer template.
  // ============================================================

  // Cover placeholder dengan kotak putih, lalu tulis nilai baru
  const coverAndDraw = (text, pos, width = 150, height = 12) => {
    if (!text) return;
    // Kotak putih untuk menutupi placeholder template
    page.drawRectangle({
      x: pos.x,
      y: pos.y - 2,
      width,
      height,
      color: rgb(1, 1, 1),
    });
    drawField(text, pos);
  };

  coverAndDraw(studentName, FIELD_POSITIONS.student_name, 160);
  coverAndDraw(academicYear ?? "-", FIELD_POSITIONS.academic_year, 100);
  coverAndDraw(period ?? "-", FIELD_POSITIONS.period, 160);
  coverAndDraw(teacherName, FIELD_POSITIONS.teacher_name, 160);

  // ============================================================
  // ISI SCORE BOXES
  // ============================================================

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

    // Kotak putih kecil untuk cover area box
    page.drawRectangle({
      x: pos.x - 4,
      y: pos.y - 2,
      width: 34,
      height: 14,
      color: rgb(1, 1, 1),
    });

    drawField(val, pos, {
      size: FONT_SIZE_SCORE,
      font: fontBold,
      color: blue,
    });
  }

  // ============================================================
  // ISI COMMENT (word-wrap)
  // ============================================================

  if (content) {
    const pos = FIELD_POSITIONS.comment;

    // Cover placeholder "report_min_200_char"
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
      // Batas bawah area comment (di atas footer A+ = Outstanding)
      if (currentY < PAGE_HEIGHT - 585) break;

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

  // Serialize ke Buffer
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
