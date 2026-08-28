import type { WireValue } from "../types";
import { isWireString } from "../types";
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlignTable,
} from "docx";
import type { FileChild, ISectionOptions } from "docx";
import {
  BODY_FONT,
  BODY_SIZE,
  BODY_SPACING,
  COMPACT_CELL_MARGINS,
  CONTENT_CELL_MARGINS,
  DETAILS_CELL_MARGINS,
  JUSTIFIED_CELL_TEXT,
  SUBHEADER_FILL,
  TABLE_WIDTH,
  WHITE_FILL,
  bulletParagraph,
  cell,
  contentParagraphs,
  detailsValueCell,
  headingCell,
  labelledCell,
  listParagraphs,
  nonEmptyLines,
  paragraph,
  row,
  subheading,
  table,
  tableSpacer,
  textParagraph,
  isBulletLine,
} from "./docxTheme";

/**
 * Facts are grouped to mirror the FACTS section in the case-digest template.
 * Unsupported fact categories are represented by empty lists.
 */
export interface CaseDigestFacts {
  petition: string[];
  petitioner_version: string[];
  respondent_version: string[];
}

/** The complete issue form preserves the ISSUE/S, RULING, and RATIO blocks. */
export interface CaseDigestIssue {
  issue: string;
  ruling: string;
  ratio: string;
}

/** JSON contract consumed by the case-digest DOCX renderer. */
export interface CaseDigest {
  case_title: string;
  petitioner: string;
  respondent: string;
  topic_subtopic: string;
  subject: string;
  ponente: string;
  gr_no_date: string;
  full_text: string;
  summary: string;
  doctrine: string;
  provisions: string;
  facts: CaseDigestFacts;
  petitioners_arguments: string[];
  respondents_arguments: string[];
  procedural_posture: string[];
  issues: CaseDigestIssue[];
  supreme_court_ruling: string;
  class_notes: string[];
}

/** Presentation options for the generated document. */
export interface CaseDigestDocxOptions {
  creator?: string;
  headerText?: string;
  footerText?: string;
}

export interface CaseDigestDownloadOptions extends CaseDigestDocxOptions {
  fileName?: string;
}

const DETAILS_TABLE_WIDTH = 10455;
const FACTS_TABLE_WIDTH = 10455;
const ARGUMENTS_TABLE_WIDTH = 10440;
const ISSUE_TABLE_WIDTH = 10440;
const DETAILS_COLUMN_WIDTHS = [1845, 4590, 1695, 2325];
const FACTS_COLUMN_WIDTHS = [1365, 9090];
const ARGUMENTS_COLUMN_WIDTHS = [5235, 5205];
const ISSUE_COLUMN_WIDTHS = [1455, 8985];
const ISSUE_CELL_MARGINS = { top: 99, left: 99, bottom: 99, right: 99 };

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

function parseFacts(value: WireValue): CaseDigestFacts {
  if (value === undefined || value === null) {
    return { petition: [], petitioner_version: [], respondent_version: [] };
  }
  if (!isRecord(value)) throw new TypeError("Expected facts to be an object.");

  return {
    petition: normalizedStringArray(value, "petition", "facts.petition"),
    petitioner_version: normalizedStringArray(value, "petitioner_version", "facts.petitioner_version"),
    respondent_version: normalizedStringArray(value, "respondent_version", "facts.respondent_version"),
  };
}

function parseIssue(value: WireValue, index: number): CaseDigestIssue {
  const path = `issues[${index}]`;

  if (Array.isArray(value)) {
    const [ruling, ratio] = value;
    if (value.length !== 2 || !isWireString(ruling) || !isWireString(ratio)) {
      throw new TypeError(`Expected ${path} to be a [ruling, ratio] string pair.`);
    }
    return { issue: "", ruling, ratio };
  }

  if (!isRecord(value)) {
    throw new TypeError(`Expected ${path} to be an object.`);
  }

  return {
    issue: normalizedString(value, "issue", `${path}.issue`),
    ruling: normalizedString(value, "ruling", `${path}.ruling`),
    ratio: normalizedString(value, "ratio", `${path}.ratio`),
  };
}

function parseIssues(value: WireValue): CaseDigestIssue[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("Expected issues to be an array.");
  }
  return value.map(parseIssue);
}

/** Normalize and type a parsed object or JSON string before rendering it. */
export function parseCaseDigestJson(input: WireValue): CaseDigest {
  const value: WireValue = isWireString(input) ? JSON.parse(input) : input;
  if (!isRecord(value)) {
    throw new TypeError("Expected case-digest JSON to be an object.");
  }

  return {
    case_title: normalizedString(value, "case_title"),
    petitioner: normalizedString(value, "petitioner"),
    respondent: normalizedString(value, "respondent"),
    topic_subtopic: normalizedString(value, "topic_subtopic"),
    subject: normalizedString(value, "subject"),
    ponente: normalizedString(value, "ponente"),
    gr_no_date: normalizedString(value, "gr_no_date"),
    full_text: normalizedString(value, "full_text"),
    summary: normalizedString(value, "summary"),
    doctrine: normalizedString(value, "doctrine"),
    provisions: normalizedString(value, "provisions"),
    facts: parseFacts(value.facts),
    petitioners_arguments: normalizedStringArray(value, "petitioners_arguments"),
    respondents_arguments: normalizedStringArray(value, "respondents_arguments"),
    procedural_posture: normalizedStringArray(value, "procedural_posture"),
    issues: parseIssues(value.issues),
    supreme_court_ruling: normalizedString(value, "supreme_court_ruling"),
    class_notes: normalizedStringArray(value, "class_notes"),
  };
}

function isUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

/** Full-text entries render as live links when the JSON carries a URL. */
function fullTextCell(value: string | undefined): TableCell {
  const trimmed = (value ?? "").trim();
  const paragraphs = isUrl(trimmed)
    ? [paragraph([new ExternalHyperlink({
        link: trimmed,
        children: [new TextRun({
          text: trimmed,
          font: BODY_FONT,
          size: BODY_SIZE,
          color: "1155cc",
          underline: {},
        })],
      })])]
    : contentParagraphs(value);
  return cell(paragraphs, { margins: DETAILS_CELL_MARGINS });
}

function detailsTable(caseDigest: CaseDigest): Table {
  return table([
    row([headingCell("Details", 4, DETAILS_CELL_MARGINS)]),
    row([
      labelledCell("Case Title"),
      detailsValueCell(caseDigest.case_title),
      labelledCell("Subject"),
      detailsValueCell(caseDigest.subject),
    ], 420),
    row([
      labelledCell("Petitioner"),
      detailsValueCell(caseDigest.petitioner),
      labelledCell("Ponente"),
      detailsValueCell(caseDigest.ponente, { italics: true }),
    ], 345),
    row([
      labelledCell("Respondent"),
      detailsValueCell(caseDigest.respondent),
      labelledCell("GR No. | Date"),
      detailsValueCell(caseDigest.gr_no_date),
    ], 360),
    row([
      labelledCell("Topic & Subtopic"),
      detailsValueCell(caseDigest.topic_subtopic),
      labelledCell("Full Text"),
      fullTextCell(caseDigest.full_text),
    ], 315),
  ], DETAILS_COLUMN_WIDTHS, DETAILS_TABLE_WIDTH);
}

function summaryDoctrineTable(caseDigest: CaseDigest): Table {
  return table([
    row([headingCell("Summary")]),
    row([cell(contentParagraphs(caseDigest.summary, {}, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })]),
    row([headingCell("Doctrine")]),
    row([cell(contentParagraphs(caseDigest.doctrine, { bold: true }, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })]),
  ], [TABLE_WIDTH], TABLE_WIDTH);
}

function provisionParagraphs(provisions: string | undefined): Paragraph[] {
  const lines = nonEmptyLines(provisions ?? "");
  if (lines.length === 0) {
    return [];
  }

  return [
    isBulletLine(lines[0])
      ? bulletParagraph(lines[0], { bold: true }, JUSTIFIED_CELL_TEXT)
      : textParagraph(lines[0], { bold: true }, JUSTIFIED_CELL_TEXT),
    ...contentParagraphs(lines.slice(1).join("\n"), {}, JUSTIFIED_CELL_TEXT),
  ];
}

function provisionsTable(caseDigest: CaseDigest): Table {
  return table([
    row([headingCell("Provision/s")]),
    row([cell(provisionParagraphs(caseDigest.provisions), { margins: COMPACT_CELL_MARGINS })]),
  ], [TABLE_WIDTH], TABLE_WIDTH);
}

function factsTable(caseDigest: CaseDigest): Table {
  const factsNode = caseDigest.facts;
  const facts = listParagraphs(factsNode.petition, false, JUSTIFIED_CELL_TEXT);
  if (factsNode.respondent_version.length > 0) {
    facts.push(subheading("Respondent\u2019s version", true));
    facts.push(...listParagraphs(factsNode.respondent_version, false, JUSTIFIED_CELL_TEXT));
  }
  if (factsNode.petitioner_version.length > 0) {
    facts.push(subheading("Petitioners\u2019 version", true));
    facts.push(...listParagraphs(factsNode.petitioner_version, false, JUSTIFIED_CELL_TEXT));
  }

  return table([
    row([headingCell("Facts", 2, CONTENT_CELL_MARGINS)]),
    row([
      labelledCell("Petition", SUBHEADER_FILL),
      cell([textParagraph("Why does this case exist?", {}, JUSTIFIED_CELL_TEXT)], { margins: CONTENT_CELL_MARGINS }),
    ], 334),
    row([cell(facts, { columnSpan: 2, margins: CONTENT_CELL_MARGINS })], 384),
  ], FACTS_COLUMN_WIDTHS, FACTS_TABLE_WIDTH);
}

function argumentsTable(caseDigest: CaseDigest): Table {
  return table([
    row([
      headingCell("Petitioner\u2019s Arguments", undefined, CONTENT_CELL_MARGINS),
      headingCell("Respondent\u2019s Arguments", undefined, CONTENT_CELL_MARGINS),
    ], 349),
    row([
      cell(listParagraphs(caseDigest.petitioners_arguments, false, JUSTIFIED_CELL_TEXT), { margins: CONTENT_CELL_MARGINS }),
      cell(listParagraphs(caseDigest.respondents_arguments, false, JUSTIFIED_CELL_TEXT), { margins: CONTENT_CELL_MARGINS }),
    ], 870),
  ], ARGUMENTS_COLUMN_WIDTHS, ARGUMENTS_TABLE_WIDTH);
}

function proceduralPostureTable(caseDigest: CaseDigest): Table {
  return table([
    row([headingCell("Procedural Posture")]),
    row([cell(listParagraphs(caseDigest.procedural_posture, true, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })], 1869),
  ], [TABLE_WIDTH], TABLE_WIDTH);
}

function issueTable(caseDigest: CaseDigest): Table {
  const rows: TableRow[] = [row([headingCell("Issue/s", 2, ISSUE_CELL_MARGINS)], 400)];

  for (const issue of caseDigest.issues) {
    if (issue.issue) {
      rows.push(row([
        cell(contentParagraphs(issue.issue, { bold: true }, JUSTIFIED_CELL_TEXT), {
          fill: SUBHEADER_FILL,
          columnSpan: 2,
          margins: ISSUE_CELL_MARGINS,
        }),
      ], 366));
    }
    rows.push(row([
      headingCell("Ruling", undefined, ISSUE_CELL_MARGINS),
      headingCell("Ratio", undefined, ISSUE_CELL_MARGINS),
    ], 300));
    rows.push(row([
      cell(contentParagraphs(issue.ruling, { bold: true }, { alignment: AlignmentType.CENTER, spacing: BODY_SPACING }), {
        fill: WHITE_FILL,
        margins: ISSUE_CELL_MARGINS,
        verticalAlign: VerticalAlignTable.CENTER,
      }),
      cell(contentParagraphs(issue.ratio, {}, JUSTIFIED_CELL_TEXT), {
        fill: WHITE_FILL,
        margins: ISSUE_CELL_MARGINS,
      }),
    ], 525));
  }

  return table(rows, ISSUE_COLUMN_WIDTHS, ISSUE_TABLE_WIDTH);
}

function supremeCourtRulingTable(caseDigest: CaseDigest): Table {
  return table([
    row([headingCell("Supreme Court Ruling")]),
    row([cell(contentParagraphs(caseDigest.supreme_court_ruling, { bold: true }, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })]),
  ], [TABLE_WIDTH], TABLE_WIDTH);
}

function classNotesTable(caseDigest: CaseDigest): Table {
  return table([
    row([headingCell("Class Notes")]),
    row([cell(listParagraphs(caseDigest.class_notes, false, JUSTIFIED_CELL_TEXT), { margins: COMPACT_CELL_MARGINS })]),
  ], [TABLE_WIDTH], TABLE_WIDTH);
}

function renderBody(caseDigest: CaseDigest): FileChild[] {
  const sections: Table[] = [
    detailsTable(caseDigest),
    summaryDoctrineTable(caseDigest),
    provisionsTable(caseDigest),
    factsTable(caseDigest),
    argumentsTable(caseDigest),
    proceduralPostureTable(caseDigest),
    issueTable(caseDigest),
    supremeCourtRulingTable(caseDigest),
    classNotesTable(caseDigest),
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

/** Build a docx-js document without packing it, allowing callers to customize it further. */
export function createCaseDigestDocument(
  caseDigest: CaseDigest,
  options: CaseDigestDocxOptions = {},
): Document {
  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 360, right: 720, bottom: 360, left: 900, header: 360, footer: 360 },
      },
    },
    children: renderBody(caseDigest),
    ...(options.headerText
      ? { headers: { default: new Header({ children: [headerFooterParagraph(options.headerText)] }) } }
      : null),
    ...(options.footerText
      ? { footers: { default: new Footer({ children: [headerFooterParagraph(options.footerText)] }) } }
      : null),
  };

  return new Document({
    creator: options.creator ?? "Digest Me",
    title: caseDigest.case_title ?? "Case Digest",
    subject: caseDigest.subject ?? "",
    keywords: "case digest",
    sections: [section],
  });
}

/** Pack a typed case digest into a browser Blob. */
export function renderCaseDigestDocx(
  caseDigest: CaseDigest,
  options: CaseDigestDocxOptions = {},
): Promise<Blob> {
  return Packer.toBlob(createCaseDigestDocument(caseDigest, options));
}

/** Parse raw JSON and pack it into a browser Blob in one step. */
export function caseDigestJsonToDocx(
  input: WireValue,
  options: CaseDigestDocxOptions = {},
): Promise<Blob> {
  return renderCaseDigestDocx(parseCaseDigestJson(input), options);
}

/** Return the stable download name used for a generated case-digest document. */
export function caseDigestFileName(caseTitle = ""): string {
  const slug = caseTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "case-digest"}.docx`;
}

/** Generate and download a case digest from the browser without a server round trip. */
export async function downloadCaseDigestDocx(
  caseDigest: CaseDigest,
  options: CaseDigestDownloadOptions = {},
): Promise<void> {
  const { fileName, ...documentOptions } = options;
  const blob = await renderCaseDigestDocx(caseDigest, documentOptions);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName ?? caseDigestFileName(caseDigest.case_title);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
