const {
  countWords,
  validateWordCount,
  MIN_WORD_COUNT,
} = require("../../../src/helpers/wordCount");

describe("countWords", () => {
  test("hitung kata normal", () => {
    expect(countWords("halo dunia ini test")).toBe(4);
  });

  test("strip HTML tags sebelum hitung", () => {
    expect(countWords("<p>halo dunia</p>")).toBe(2);
  });

  test("normalize whitespace ganda", () => {
    expect(countWords("halo   dunia")).toBe(2);
  });

  test("string kosong return 0", () => {
    expect(countWords("")).toBe(0);
  });

  test("null return 0", () => {
    expect(countWords(null)).toBe(0);
  });

  test("bukan string return 0", () => {
    expect(countWords(123)).toBe(0);
  });

  test("hanya spasi return 0", () => {
    expect(countWords("   ")).toBe(0);
  });

  test("HTML kompleks di-strip dengan benar", () => {
    expect(countWords("<div><p>satu dua</p><span>tiga</span></div>")).toBe(3);
  });
});

describe("validateWordCount", () => {
  test("valid jika >= 200 kata", () => {
    const text = Array(200).fill("kata").join(" ");
    const result = validateWordCount(text);
    expect(result.valid).toBe(true);
    expect(result.count).toBe(200);
  });

  test("invalid jika < 200 kata", () => {
    const text = Array(199).fill("kata").join(" ");
    const result = validateWordCount(text);
    expect(result.valid).toBe(false);
    expect(result.count).toBe(199);
  });

  test("kembalikan min value", () => {
    const result = validateWordCount("test");
    expect(result.min).toBe(MIN_WORD_COUNT);
    expect(result.min).toBe(200);
  });

  test("tepat 200 kata valid", () => {
    const text = Array(200).fill("kata").join(" ");
    expect(validateWordCount(text).valid).toBe(true);
  });
});
