require("dotenv").config({ path: ".env.test" });
const { validateWordCount } = require("../../../src/helpers/wordCount");

describe("validateWordCount", () => {
  test("valid jika >= 120 kata", () => {
    const text = Array(120).fill("kata").join(" ");
    const result = validateWordCount(text);
    expect(result.valid).toBe(true);
    expect(result.count).toBe(120);
  });

  test("invalid jika < 120 kata", () => {
    const text = Array(119).fill("kata").join(" ");
    const result = validateWordCount(text);
    expect(result.valid).toBe(false);
    expect(result.count).toBe(119);
  });

  test("kembalikan min value 120", () => {
    const result = validateWordCount("test");
    expect(result.min).toBe(120);
  });

  test("tepat 120 kata valid", () => {
    const text = Array(120).fill("kata").join(" ");
    const result = validateWordCount(text);
    expect(result.valid).toBe(true);
  });

  test("121 kata valid", () => {
    const text = Array(121).fill("kata").join(" ");
    const result = validateWordCount(text);
    expect(result.valid).toBe(true);
  });

  test("string kosong invalid", () => {
    const result = validateWordCount("");
    expect(result.valid).toBe(false);
    expect(result.count).toBe(0);
  });

  test("null/undefined tidak crash", () => {
    const result = validateWordCount(null);
    expect(result.valid).toBe(false);
    expect(result.count).toBe(0);
  });
});
