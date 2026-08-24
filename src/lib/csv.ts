import type { CsvCardDraft, CsvIssue, CsvValidationResult } from "../types";

interface ParsedRow {
  cells: string[];
  line: number;
}

interface ParsedRows {
  rows: ParsedRow[];
  unclosedQuoteLine?: number;
}

/**
 * Reads the small, intentionally strict CSV format used by Digest Me.
 * Quoted commas, escaped quotes, and quoted line breaks are supported without
 * sending the uploaded file anywhere outside the browser.
 */
function parseRows(source: string): ParsedRows {
  const rows: ParsedRow[] = [];
  const text = source.replace(/^\uFEFF/, "");
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const commitRow = () => {
    rows.push({ cells: [...cells, cell], line: rowLine });
    cells = [];
    cell = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (character === "\n") line += 1;
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.trim() === "") {
      inQuotes = true;
    } else if (character === ",") {
      cells.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      commitRow();
      line += 1;
      rowLine = line;
    } else {
      cell += character;
    }
  }

  if (inQuotes) {
    return { rows, unclosedQuoteLine: rowLine };
  }

  if (cell.length > 0 || cells.length > 0 || text.endsWith(",")) {
    commitRow();
  }

  return { rows };
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionHeader(value: string): boolean {
  return new Set(["question", "question front", "front", "prompt"]).has(value);
}

function isAnswerHeader(value: string): boolean {
  return new Set(["answer", "answer back", "back", "response"]).has(value);
}

/** Validate headers and rows, returning usable rows even when some rows need attention. */
export function validateCsv(source: string): CsvValidationResult {
  const { rows, unclosedQuoteLine } = parseRows(source);
  const issues: CsvIssue[] = [];
  const headerRow = rows[0];
  const headers = headerRow?.cells.map((header) => header.trim()) ?? [];

  if (unclosedQuoteLine) {
    issues.push({ line: unclosedQuoteLine, message: "Unclosed quote. Check this row's punctuation." });
  }

  if (!headerRow) {
    issues.push({ line: 1, message: "The file is empty. Add a Question and Answer header row." });
  }

  if (headers.length !== 2) {
    issues.push({ line: 1, message: `Expected exactly 2 columns, found ${headers.length}.` });
  }

  const normalizedHeaders = headers.map(normalizeHeader);
  const questionIndex = normalizedHeaders.findIndex(isQuestionHeader);
  const answerIndex = normalizedHeaders.findIndex(isAnswerHeader);
  const headerValid =
    headers.length === 2 &&
    questionIndex !== -1 &&
    answerIndex !== -1 &&
    questionIndex !== answerIndex;

  if (headers.length === 2 && questionIndex === -1) {
    issues.push({ line: 1, message: 'Missing a Question column. Use "Question" or "Question (Front)".' });
  }
  if (headers.length === 2 && answerIndex === -1) {
    issues.push({ line: 1, message: 'Missing an Answer column. Use "Answer" or "Answer (Back)".' });
  }

  const cards: CsvCardDraft[] = [];
  if (headerValid) {
    rows.slice(1).forEach((row) => {
      const isBlankRow = row.cells.every((value) => value.trim() === "");
      if (isBlankRow) return;

      if (row.cells.length !== 2) {
        issues.push({ line: row.line, message: `Expected 2 values, found ${row.cells.length}.` });
        return;
      }

      const question = row.cells[questionIndex].trim();
      const answer = row.cells[answerIndex].trim();
      if (!question || !answer) {
        issues.push({
          line: row.line,
          message: !question && !answer ? "Question and Answer are both empty." : !question ? "Question is empty." : "Answer is empty.",
        });
        return;
      }

      cards.push({ question, answer, line: row.line });
    });
  }

  if (headerValid && cards.length === 0 && !issues.some((issue) => issue.line > 1)) {
    issues.push({ line: 2, message: "No flashcards found below the header row." });
  }

  return {
    headers,
    cards,
    issues,
    headerValid,
    valid: headerValid && cards.length > 0 && issues.length === 0,
  };
}

export function deckNameFromFile(fileName: string): string {
  const withoutExtension = fileName.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim();
  return withoutExtension || "Untitled deck";
}
