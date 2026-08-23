import {
  AlignmentType,
  Document,
  Footer,
  Header,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { IParagraphOptions, ParagraphChild } from "docx";

/** Facts are grouped to mirror the FACTS section in the case-digest template. */
export interface CaseDigestFacts {
  petition: string[];
  petitioner_version?: string[];
  respondent_version?: string[];
}

/** The complete issue form preserves the ISSUE/S, RULING, and RATIO blocks. */
export interface CaseDigestIssue {
  issue?: string;
  ruling: string;
  ratio: string;
}

/** The shorter [ruling, ratio] form is accepted for the supplied JSON shape. */
export type CaseDigestIssuePair = [ruling: string, ratio: string];
export type CaseDigestIssueInput = CaseDigestIssue | CaseDigestIssuePair;

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
  issues: CaseDigestIssueInput[];
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

interface TextStyle {
  bold?: boolean;
  italics?: boolean;
  color?: string;
}

const BODY_FONT = "Arial";
const BODY_SIZE = 20;
const BODY_SPACING = { after: 120, line: 240, lineRule: "auto" as const };
const SECTION_SPACING = { before: 240, after: 120, line: 240, lineRule: "auto" as const };
const SUBHEADING_SPACING = { before: 160, after: 80, line: 240, lineRule: "auto" as const };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, path = key): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${path} to be a string.`);
  }
  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string, path = key): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new TypeError(`Expected ${path} to be an array of strings.`);
  }
  return value;
}

function parseFacts(value: unknown): CaseDigestFacts {
  if (!isRecord(value)) {
    throw new TypeError("Expected facts to be an object.");
  }

  const facts: CaseDigestFacts = {
    petition: requiredStringArray(value, "petition", "facts.petition"),
  };

  if (value.petitioner_version !== undefined) {
    facts.petitioner_version = requiredStringArray(value, "petitioner_version", "facts.petitioner_version");
  }
  if (value.respondent_version !== undefined) {
    facts.respondent_version = requiredStringArray(value, "respondent_version", "facts.respondent_version");
  }

  return facts;
}

function parseIssue(value: unknown, index: number): CaseDigestIssueInput {
  const path = `issues[${index}]`;

  if (Array.isArray(value)) {
    if (value.length !== 2 || value.some((item) => typeof item !== "string")) {
      throw new TypeError(`Expected ${path} to be a [ruling, ratio] string pair.`);
    }
    return [value[0], value[1]];
  }

  if (!isRecord(value)) {
    throw new TypeError(`Expected ${path} to be an object or [ruling, ratio] pair.`);
  }

  const issue: CaseDigestIssue = {
    ruling: requiredString(value, "ruling", `${path}.ruling`),
    ratio: requiredString(value, "ratio", `${path}.ratio`),
  };
  if (value.issue !== undefined) {
    issue.issue = requiredString(value, "issue", `${path}.issue`);
  }
  return issue;
}

function parseIssues(value: unknown): CaseDigestIssueInput[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Expected issues to be an array.");
  }
  return value.map(parseIssue);
}

/** Validate and type a parsed object or a JSON string before rendering it. */
export function parseCaseDigestJson(input: unknown): CaseDigest {
  const value: unknown = typeof input === "string" ? JSON.parse(input) : input;
  if (!isRecord(value)) {
    throw new TypeError("Expected case-digest JSON to be an object.");
  }

  return {
    case_title: requiredString(value, "case_title"),
    petitioner: requiredString(value, "petitioner"),
    respondent: requiredString(value, "respondent"),
    topic_subtopic: requiredString(value, "topic_subtopic"),
    subject: requiredString(value, "subject"),
    ponente: requiredString(value, "ponente"),
    gr_no_date: requiredString(value, "gr_no_date"),
    full_text: requiredString(value, "full_text"),
    summary: requiredString(value, "summary"),
    doctrine: requiredString(value, "doctrine"),
    provisions: requiredString(value, "provisions"),
    facts: parseFacts(value.facts),
    petitioners_arguments: requiredStringArray(value, "petitioners_arguments"),
    respondents_arguments: requiredStringArray(value, "respondents_arguments"),
    procedural_posture: requiredStringArray(value, "procedural_posture"),
    issues: parseIssues(value.issues),
    supreme_court_ruling: requiredString(value, "supreme_court_ruling"),
    class_notes: requiredStringArray(value, "class_notes"),
  };
}

function textRun(text: string, style: TextStyle = {}): TextRun {
  return new TextRun({
    text,
    font: BODY_FONT,
    size: BODY_SIZE,
    ...style,
  });
}

function paragraph(children: readonly ParagraphChild[], options: IParagraphOptions = {}): Paragraph {
  return new Paragraph({
    spacing: BODY_SPACING,
    ...options,
    children,
  });
}

function textParagraph(text: string, style: TextStyle = {}, options: IParagraphOptions = {}): Paragraph {
  return paragraph([textRun(text, style)], options);
}

function sectionHeading(title: string, first = false): Paragraph {
  return textParagraph(title.toUpperCase(), { bold: true }, {
    spacing: first ? { ...SECTION_SPACING, before: 0 } : SECTION_SPACING,
    keepNext: true,
  });
}

function subheading(title: string, italics = false): Paragraph {
  return textParagraph(title, { bold: true, italics }, {
    spacing: SUBHEADING_SPACING,
    keepNext: true,
  });
}

function fieldLabel(label: string): Paragraph {
  return textParagraph(label, { bold: true }, {
    spacing: { after: 40, line: 240, lineRule: "auto" },
    keepNext: true,
  });
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripBullet(text: string): string {
  return text.replace(/^(?:[-*]|\u2022)\s+/, "");
}

function isBulletLine(text: string): boolean {
  return /^(?:[-*]|\u2022)\s+/.test(text);
}

function bulletParagraph(text: string, style: TextStyle = {}): Paragraph {
  return paragraph([textRun(stripBullet(text), style)], { bullet: { level: 0 } });
}

function contentParagraphs(text: string, style: TextStyle = {}): Paragraph[] {
  return nonEmptyLines(text).map((line) => (
    isBulletLine(line) ? bulletParagraph(line, style) : textParagraph(line, style)
  ));
}

function labelledBulletParagraph(text: string): Paragraph {
  const value = stripBullet(text);
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return bulletParagraph(value);
  }

  return paragraph([
    textRun(value.slice(0, separatorIndex + 1), { bold: true }),
    textRun(value.slice(separatorIndex + 1)),
  ], { bullet: { level: 0 } });
}

function listParagraphs(items: string[], labelled = false): Paragraph[] {
  return items.flatMap((item) => nonEmptyLines(item).map((line) => (
    labelled ? labelledBulletParagraph(line) : bulletParagraph(line)
  )));
}

function appendTextSection(children: Paragraph[], title: string, text: string): void {
  children.push(sectionHeading(title), ...contentParagraphs(text));
}

function appendListSection(children: Paragraph[], title: string, items: string[], labelled = false): void {
  children.push(sectionHeading(title), ...listParagraphs(items, labelled));
}

function normalizeIssue(issue: CaseDigestIssueInput): CaseDigestIssue {
  if (Array.isArray(issue)) {
    return { ruling: issue[0], ratio: issue[1] };
  }
  return issue;
}

function renderBody(caseDigest: CaseDigest): Paragraph[] {
  const children: Paragraph[] = [sectionHeading("Details", true)];
  const details: Array<[string, string]> = [
    ["Case Title", caseDigest.case_title],
    ["Subject", caseDigest.subject],
    ["Petitioner", caseDigest.petitioner],
    ["Ponente", caseDigest.ponente],
    ["Respondent", caseDigest.respondent],
    ["GR No. | Date", caseDigest.gr_no_date],
    ["Topic & Subtopic", caseDigest.topic_subtopic],
    ["Full Text", caseDigest.full_text],
  ];

  for (const [label, value] of details) {
    children.push(fieldLabel(label));
    const valueParagraphs = contentParagraphs(value);
    children.push(...(valueParagraphs.length > 0 ? valueParagraphs : [textParagraph("")]));
  }

  appendTextSection(children, "Summary", caseDigest.summary);
  appendTextSection(children, "Doctrine", caseDigest.doctrine);
  appendTextSection(children, "Provision/s", caseDigest.provisions);

  children.push(sectionHeading("Facts"), subheading("Petition"), subheading("Why does this case exist?", true));
  children.push(...listParagraphs(caseDigest.facts.petition));
  if (caseDigest.facts.respondent_version !== undefined) {
    children.push(subheading("Respondent's version", true), ...listParagraphs(caseDigest.facts.respondent_version));
  }
  if (caseDigest.facts.petitioner_version !== undefined) {
    children.push(subheading("Petitioners' version", true), ...listParagraphs(caseDigest.facts.petitioner_version));
  }

  appendListSection(children, "Petitioner's Arguments", caseDigest.petitioners_arguments);
  appendListSection(children, "Respondent's Arguments", caseDigest.respondents_arguments);
  appendListSection(children, "Procedural Posture", caseDigest.procedural_posture, true);

  children.push(sectionHeading("Issue/s"));
  for (const issueInput of caseDigest.issues) {
    const issue = normalizeIssue(issueInput);
    if (issue.issue) {
      children.push(...contentParagraphs(issue.issue));
    }
    children.push(subheading("RULING"), ...contentParagraphs(issue.ruling, { bold: true }));
    children.push(subheading("RATIO"), ...contentParagraphs(issue.ratio));
  }

  appendTextSection(children, "Supreme Court Ruling", caseDigest.supreme_court_ruling);
  appendListSection(children, "Class Notes", caseDigest.class_notes);
  return children;
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
  const section = {
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 360, right: 720, bottom: 360, left: 900, header: 360, footer: 360 },
      },
    },
    children: renderBody(caseDigest),
    ...(options.headerText
      ? { headers: { default: new Header({ children: [headerFooterParagraph(options.headerText)] }) } }
      : {}),
    ...(options.footerText
      ? { footers: { default: new Footer({ children: [headerFooterParagraph(options.footerText)] }) } }
      : {}),
  };

  return new Document({
    creator: options.creator ?? "Digest Me",
    title: caseDigest.case_title,
    subject: caseDigest.subject,
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
  input: unknown,
  options: CaseDigestDocxOptions = {},
): Promise<Blob> {
  return renderCaseDigestDocx(parseCaseDigestJson(input), options);
}

function defaultFileName(caseTitle: string): string {
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
  anchor.download = fileName ?? defaultFileName(caseDigest.case_title);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
