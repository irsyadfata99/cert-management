const { validateWordCount } = require("../../../src/helpers/wordCount");

// wordCount.js sekarang hanya export validateWordCount (setelah refactor constants).
// countWords adalah internal function, tidak di-export.
// MIN_WORD_COUNT di-expose via result.min dari validateWordCount.

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

  test("kembalikan min value 200", () => {
    const result = validateWordCount("test");
    expect(result.min).toBe(200);
  });

  test("tepat 200 kata valid", () => {
    const text = Array(200).fill("kata").join(" ");
    expect(validateWordCount(text).valid).toBe(true);
  });

  test("201 kata valid", () => {
    const text = Array(201).fill("kata").join(" ");
    const result = validateWordCount(text);
    expect(result.valid).toBe(true);
    expect(result.count).toBe(201);
  });

  test("string kosong invalid — count 0", () => {
    const result = validateWordCount("");
    expect(result.valid).toBe(false);
    expect(result.count).toBe(0);
  });

  test("null invalid — count 0", () => {
    const result = validateWordCount(null);
    expect(result.valid).toBe(false);
    expect(result.count).toBe(0);
  });

  test("bukan string invalid — count 0", () => {
    const result = validateWordCount(123);
    expect(result.valid).toBe(false);
    expect(result.count).toBe(0);
  });

  test("hitung kata normal", () => {
    const result = validateWordCount(Array(4).fill("kata").join(" "));
    expect(result.count).toBe(4);
  });

  test("normalize whitespace ganda", () => {
    const result = validateWordCount(Array(200).fill("kata").join("   "));
    expect(result.count).toBe(200);
  });
});
