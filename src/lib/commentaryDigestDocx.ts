import type { WireValue } from "../types";
import { isWireString } from "../types";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TextRun,
} from "docx";
import type { FileChild, ISectionOptions } from "docx";
import {
  BODY_FONT,
  COMPACT_CELL_MARGINS,
  CONTENT_CELL_MARGINS,
  DETAILS_CELL_MARGINS,
  JUSTIFIED_CELL_TEXT,
  TABLE_WIDTH,
  cell,
  contentParagraphs,
  detailsValueCell,
  headingCell,
  labelledCell,
  listParagraphs,
  row,
  table,
  tableSpacer,
} from "./docxTheme";

/**
 * One case cited by the commentary, with the proposition attributed to it.
 * Unsupported case details are represented by empty strings.
 */
export interface CommentaryCase {
  case_name: string;
  citation: string;
  doctrine: string;
}

/** JSON contract consumed by the commentary-digest DOCX renderer. */
export interface CommentaryDigest {
  source_title: string;
  chapter_title: string;
  sections_covered: string;
  subject: string;
  summary: string;
  rule: string;
  elements: string[];
  exceptions: string[];
  definitions: string[];
  cases: CommentaryCase[];
  implementing_rules: string[];
  related_provisions: string[];
  legislative_history: string;
  debates: string[];
  practice_pointers: string[];
  illustrations: string[];
  study_notes: string[];
}

/** Presentation options for the generated document. */
export interface CommentaryDigestDocxOptions {
  creator?: string;
  headerText?: string;
  footerText?: string;
}

export interface CommentaryDigestDownloadOptions extends CommentaryDigestDocxOptions {
  fileName?: string;
}

const DETAILS_TABLE_WIDTH = 10455;
const JURISPRUDENCE_TABLE_WIDTH = 10440;
const DETAILS_COLUMN_WIDTHS = [1845, 4590, 1695, 2325];
const JURISPRUDENCE_COLUMN_WIDTHS = [2200, 2500, 5740];

function isRecord(value: WireValue): value is Record<string, WireValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, WireValue>, key: string, path = key): string {
  const value = record[key];
  if (!isWireString(value)) {
    throw new TypeError(`Expected ${path} to be a string.`);
  }
  return value;
}

function requiredStringArray(record: Record<string, WireValue>, key: string, path = key): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new TypeError(`Expected ${path} to be an array of strings.`);
  }
  return value;
}

/** Normalize an unsupported scalar while preserving strict validation for present values. */
function normalizedString(record: Record<string, WireValue>, key: string, path = key): string {
  const value = record[key];
  if (value === undefined || value === null) return "";
  return requiredString(record, key, path);
}

/** Normalize an unsupported list while preserving strict validation for present values. */
function normalizedStringArray(record: Record<string, WireValue>, key: string, path = key): string[] {
  const value = record[key];
  if (value === undefined || value === null) return [];
  return requiredStringArray(record, key, path);
}

function parseCase(value: WireValue, index: number): CommentaryCase {
  const path = `cases[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`Expected ${path} to be an object.`);
  }
  return {
    case_name: normalizedString(value, "case_name", `${path}.case_name`),
    citation: normalizedString(value, "citation", `${path}.citation`),
    doctrine: normalizedString(value, "doctrine", `${path}.doctrine`),
  };
}

function parseCases(value: WireValue): CommentaryCase[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("Expected cases to be an array.");
  }
  return value.map(parseCase);
}

/** Normalize and type a parsed object or JSON string before rendering it. */
export function parseCommentaryDigestJson(input: WireValue): CommentaryDigest {
  const value: WireValue = isWireString(input) ? JSON.parse(input) : input;
  if (!isRecord(value)) {
    throw new TypeError("Expected commentary-digest JSON to be an object.");
  }

  return {
    source_title: normalizedString(value, "source_title"),
    chapter_title: normalizedString(value, "chapter_title"),
    sections_covered: normalizedString(value, "sections_covered"),
    subject: normalizedString(value, "subject"),
    summary: normalizedString(value, "summary"),
    rule: normalizedString(value, "rule"),
    elements: normalizedStringArray(value, "elements"),
    exceptions: normalizedStringArray(value, "exceptions"),
    definitions: normalizedStringArray(value, "definitions"),
    cases: parseCases(value.cases),
    implementing_rules: normalizedStringArray(value, "implementing_rules"),
    related_provisions: normalizedStringArray(value, "related_provisions"),
    legislative_history: normalizedString(value, "legislative_history"),
    debates: normalizedStringArray(value, "debates"),
    practice_pointers: normalizedStringArray(value, "practice_pointers"),
    illustrations: normalizedStringArray(value, "illustrations"),
    study_notes: normalizedStringArray(value, "study_notes"),
  };
}

function detailsTable(digest: CommentaryDigest): Table {
  return table([
    row([headingCell("Details", 4, DETAILS_CELL_MARGINS)]),
    row([
      labelledCell("Source Title"),
      detailsValueCell(digest.source_title),
      labelledCell("Subject"),
      detailsValueCell(digest.subject),
    ], 420),
    row([
      labelledCell("Chapter"),
      detailsValueCell(digest.chapter_title),
      labelledCell("Sections Covered"),
      detailsValueCell(digest.sections_covered),
    ], 420),
  ], DETAILS_COLUMN_WIDTHS, DETAILS_TABLE_WIDTH);
}

function summaryRuleTable(digest: CommentaryDigest): Table {
  return table([
    row([headingCell("Summary")]),
    row([cell(contentParagraphs(digest.summary, {}, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })]),
    row([headingCell("Rule")]),
    row([cell(contentParagraphs(digest.rule, { bold: true }, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })]),
  ], [TABLE_WIDTH], TABLE_WIDTH);
}

function elementsExceptionsTable(digest: CommentaryDigest): Table {
  return table([
    row([
      headingCell("Elements", undefined, CONTENT_CELL_MARGINS),
      headingCell("Exceptions", undefined, CONTENT_CELL_MARGINS),
    ], 349),
    row([
      cell(listParagraphs(digest.elements, false, JUSTIFIED_CELL_TEXT), { margins: CONTENT_CELL_MARGINS }),
      cell(listParagraphs(digest.exceptions, false, JUSTIFIED_CELL_TEXT), { margins: CONTENT_CELL_MARGINS }),
    ], 870),
  ], [TABLE_WIDTH / 2, TABLE_WIDTH / 2], TABLE_WIDTH);
}

function fullWidthListTable(heading: string, items: string[]): Table {
  return table([
    row([headingCell(heading)]),
    row([cell(listParagraphs(items, false, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })]),
  ], [TABLE_WIDTH], TABLE_WIDTH);
}

/** Jurisprudence renders one row per cited case across three labelled columns. */
function jurisprudenceTable(digest: CommentaryDigest): Table {
  const rows: TableRow[] = [
    row([
      headingCell("Case", undefined, CONTENT_CELL_MARGINS),
      headingCell("Citation", undefined, CONTENT_CELL_MARGINS),
      headingCell("Doctrine", undefined, CONTENT_CELL_MARGINS),
    ], 349),
  ];

  for (const caseEntry of digest.cases) {
    rows.push(row([
      cell(contentParagraphs(caseEntry.case_name, { bold: true }, JUSTIFIED_CELL_TEXT), { margins: CONTENT_CELL_MARGINS }),
      cell(contentParagraphs(caseEntry.citation, {}, JUSTIFIED_CELL_TEXT), { margins: CONTENT_CELL_MARGINS }),
      cell(contentParagraphs(caseEntry.doctrine, {}, JUSTIFIED_CELL_TEXT), { margins: CONTENT_CELL_MARGINS }),
    ], 870));
  }

  if (digest.cases.length === 0) {
    rows.push(row([
      cell([], { columnSpan: 3, margins: CONTENT_CELL_MARGINS }),
    ], 870));
  }

  return table(rows, JURISPRUDENCE_COLUMN_WIDTHS, JURISPRUDENCE_TABLE_WIDTH);
}

function legislativeHistoryTable(digest: CommentaryDigest): Table {
  return table([
    row([headingCell("Legislative History")]),
    row([cell(contentParagraphs(digest.legislative_history, {}, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })]),
  ], [TABLE_WIDTH], TABLE_WIDTH);
}

function renderBody(digest: CommentaryDigest): FileChild[] {
  const sections: Table[] = [
    detailsTable(digest),
    summaryRuleTable(digest),
    elementsExceptionsTable(digest),
    fullWidthListTable("Definitions", digest.definitions),
    jurisprudenceTable(digest),
    fullWidthListTable("Implementing Rules", digest.implementing_rules),
    fullWidthListTable("Related Provisions", digest.related_provisions),
    legislativeHistoryTable(digest),
    fullWidthListTable("Debates", digest.debates),
    fullWidthListTable("Practice Pointers", digest.practice_pointers),
    fullWidthListTable("Illustrations", digest.illustrations),
    fullWidthListTable("Study Notes", digest.study_notes),
  ];

  return sections.flatMap((section, index) => (
    index === 0 ? [section] : [tableSpacer(), section]
  ));
}

function headerFooterParagraph(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, font: BODY_FONT, size: 16 })],
  });
}

function documentTitle(digest: CommentaryDigest): string {
  return digest.chapter_title || digest.source_title || "Commentary Digest";
}

/** Build a docx-js document without packing it, allowing callers to customize it further. */
export function createCommentaryDigestDocument(
  digest: CommentaryDigest,
  options: CommentaryDigestDocxOptions = {},
): Document {
  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 360, right: 720, bottom: 360, left: 900, header: 360, footer: 360 },
      },
    },
    children: renderBody(digest),
    ...(options.headerText
      ? { headers: { default: new Header({ children: [headerFooterParagraph(options.headerText)] }) } }
      : null),
    ...(options.footerText
      ? { footers: { default: new Footer({ children: [headerFooterParagraph(options.footerText)] }) } }
      : null),
  };

  return new Document({
    creator: options.creator ?? "Digest Me",
    title: documentTitle(digest),
    subject: digest.subject ?? "",
    keywords: "commentary digest",
    sections: [section],
  });
}

/** Pack a typed commentary digest into a browser Blob. */
export function renderCommentaryDigestDocx(
  digest: CommentaryDigest,
  options: CommentaryDigestDocxOptions = {},
): Promise<Blob> {
  return Packer.toBlob(createCommentaryDigestDocument(digest, options));
}

/** Parse raw JSON and pack it into a browser Blob in one step. */
export function commentaryDigestJsonToDocx(
  input: WireValue,
  options: CommentaryDigestDocxOptions = {},
): Promise<Blob> {
  return renderCommentaryDigestDocx(parseCommentaryDigestJson(input), options);
}

/** Return the stable download name used for a generated commentary-digest document. */
export function commentaryDigestFileName(chapterTitle = ""): string {
  const slug = chapterTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "commentary-digest"}.docx`;
}

/** Generate and download a commentary digest from the browser without a server round trip. */
export async function downloadCommentaryDigestDocx(
  digest: CommentaryDigest,
  options: CommentaryDigestDownloadOptions = {},
): Promise<void> {
  const { fileName, ...documentOptions } = options;
  const blob = await renderCommentaryDigestDocx(digest, documentOptions);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName ?? commentaryDigestFileName(digest.chapter_title);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
