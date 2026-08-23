import { describe, expect, it } from "vitest";
import { deckNameFromFile, validateCsv } from "./csv";

const VALID_CSV = ["Question,Answer", "What is X?,X is Y", "Q2,A2"].join("\n");

describe("validateCsv", () => {
  it("accepts a simple two-column file and returns its cards", () => {
    const result = validateCsv(VALID_CSV);

    expect(result).toMatchObject({
      headers: ["Question", "Answer"],
      headerValid: true,
      valid: true,
      issues: [],
    });
    expect(result.cards).toEqual([
      { question: "What is X?", answer: "X is Y", line: 2 },
      { question: "Q2", answer: "A2", line: 3 },
    ]);
  });

  it("accepts the Question (Front) and Answer (Back) header aliases", () => {
    const result = validateCsv("Question (Front),Answer (Back)\nQ,A");

    expect(result.headerValid).toBe(true);
    expect(result.cards).toEqual([{ question: "Q", answer: "A", line: 2 }]);
  });

  it("normalizes header casing", () => {
    const result = validateCsv("question,ANSWER\nQ,A");

    expect(result.headerValid).toBe(true);
    expect(result.cards).toHaveLength(1);
  });

  it("ignores a leading byte-order mark", () => {
    const result = validateCsv(`\uFEFF${VALID_CSV}`);

    expect(result.headers).toEqual(["Question", "Answer"]);
    expect(result.valid).toBe(true);
  });

  it("keeps commas inside quoted cells", () => {
    const result = validateCsv('Question,Answer\n"Q with, comma",A');

    expect(result.cards[0].question).toBe("Q with, comma");
    expect(result.valid).toBe(true);
  });

  it("unwraps escaped quotes inside quoted cells", () => {
    const result = validateCsv('Question,Answer\n"Say ""hi""",A');

    expect(result.cards[0].question).toBe('Say "hi"');
  });

  it("keeps newlines inside quoted cells and reports the right line", () => {
    const result = validateCsv('Question,Answer\n"Line one\nLine two",A');

    expect(result.cards[0].question).toBe("Line one\nLine two");
    expect(result.cards[0].line).toBe(2);
    expect(result.issues).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    const result = validateCsv("Question,Answer\r\nQ,A\r\n");

    expect(result.cards).toEqual([{ question: "Q", answer: "A", line: 2 }]);
    expect(result.valid).toBe(true);
  });

  it("flags an unclosed quote on the row it starts", () => {
    const result = validateCsv('Question,Answer\n"unclosed,A');

    expect(result.issues).toEqual([
      { line: 2, message: "Unclosed quote. Check this row's punctuation." },
    ]);
  });

  it("rejects an empty file", () => {
    const result = validateCsv("");

    expect(result.headerValid).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { line: 1, message: "The file is empty. Add a Question and Answer header row." },
      { line: 1, message: "Expected exactly 2 columns, found 0." },
    ]);
  });

  it("rejects the wrong number of header columns", () => {
    const result = validateCsv("Question,Answer,Extra\nQ,A,x");

    expect(result.issues).toContainEqual({
      line: 1,
      message: "Expected exactly 2 columns, found 3.",
    });
  });

  it("reports a missing Question column", () => {
    const result = validateCsv("Answer,Notes\nA,Q");

    expect(result.headerValid).toBe(false);
    expect(result.issues).toContainEqual({
      line: 1,
      message: 'Missing a Question column. Use "Question" or "Question (Front)".',
    });
  });

  it("reports a missing Answer column", () => {
    const result = validateCsv("Question,Prompt\nQ,A");

    expect(result.issues).toContainEqual({
      line: 1,
      message: 'Missing an Answer column. Use "Answer" or "Answer (Back)".',
    });
  });

  it("flags card rows with the wrong value count", () => {
    const result = validateCsv("Question,Answer\nQ,A\nQ,too,many");

    expect(result.issues).toContainEqual({ line: 3, message: "Expected 2 values, found 3." });
    expect(result.cards).toEqual([{ question: "Q", answer: "A", line: 2 }]);
  });

  it("skips blank rows without adding cards or issues", () => {
    const result = validateCsv("Question,Answer\n,\nQ,A");

    expect(result.cards).toEqual([{ question: "Q", answer: "A", line: 3 }]);
    expect(result.issues).toEqual([]);
  });

  it.each([
    ["Q,", "Answer is empty."],
    [",A", "Question is empty."],
  ])("flags an incomplete row: %s", (row, message) => {
    const result = validateCsv(`Question,Answer\n${row}`);

    expect(result.issues).toEqual([{ line: 2, message }]);
    expect(result.cards).toEqual([]);
  });

  it("flags a header-only file as having no cards", () => {
    const result = validateCsv("Question,Answer");

    expect(result.issues).toEqual([
      { line: 2, message: "No flashcards found below the header row." },
    ]);
    expect(result.valid).toBe(false);
  });

  it("produces no cards when the header is invalid", () => {
    const result = validateCsv("Notes,Details\nQ,A");

    expect(result.headerValid).toBe(false);
    expect(result.cards).toEqual([]);
  });
});

describe("deckNameFromFile", () => {
  it("derives a name from the file name", () => {
    expect(deckNameFromFile("My Deck.csv")).toBe("My Deck");
    expect(deckNameFromFile("my_deck-file.CSV")).toBe("my deck file");
  });

  it("falls back for a blank name", () => {
    expect(deckNameFromFile(".csv")).toBe("Untitled deck");
  });
});
