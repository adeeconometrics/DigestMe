import {
  AlignmentType,
  BorderStyle,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { IParagraphOptions, ParagraphChild, TableVerticalAlign } from "docx";

/**
 * Shared document styling for the digest DOCX renderers.
 *
 * Both the case-digest and commentary-digest renderers build their documents
 * from full-width bordered tables with dark heading cells and grey label
 * cells, so the typography, spacing, and cell construction live here instead
 * of being duplicated per schema.
 */

export interface TextStyle {
  bold?: boolean;
  italics?: boolean;
  color?: string;
}

export interface CellOptions {
  fill?: string;
  columnSpan?: number;
  width?: number;
  margins?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  verticalAlign?: TableVerticalAlign;
}

export const BODY_FONT = "Arial";
export const BODY_SIZE = 20;
export const DARK_FILL = "666666";
export const LABEL_FILL = "d9d9d9";
export const SUBHEADER_FILL = "cccccc";
export const WHITE_FILL = "ffffff";
export const TABLE_WIDTH = 10466;
export const BODY_SPACING = { after: 120, line: 240, lineRule: "auto" as const };
export const HEADING_SPACING = { after: 0, line: 192, lineRule: "auto" as const };
export const SUBHEADING_SPACING = { before: 120, after: 80, line: 240, lineRule: "auto" as const };
export const DETAILS_CELL_MARGINS = { top: 80, left: 80, bottom: 80, right: 80 };
export const CONTENT_CELL_MARGINS = { top: 100, left: 100, bottom: 100, right: 100 };
export const COMPACT_CELL_MARGINS = { top: 0, left: 108, bottom: 0, right: 108 };
export const TABLE_BORDER = { style: BorderStyle.SINGLE, color: "000000", size: 8, space: 0 };
export const TABLE_BORDERS = {
  top: TABLE_BORDER,
  left: TABLE_BORDER,
  bottom: TABLE_BORDER,
  right: TABLE_BORDER,
  insideHorizontal: TABLE_BORDER,
  insideVertical: TABLE_BORDER,
};
export const CELL_BORDERS = {
  top: TABLE_BORDER,
  left: TABLE_BORDER,
  bottom: TABLE_BORDER,
  right: TABLE_BORDER,
};
export const JUSTIFIED_CELL_TEXT: IParagraphOptions = {
  alignment: AlignmentType.JUSTIFIED,
  spacing: BODY_SPACING,
};

export function textRun(text: string, style: TextStyle = {}): TextRun {
  return new TextRun({
    text,
    font: BODY_FONT,
    size: BODY_SIZE,
    ...style,
  });
}

/** Word merges adjacent tables, so every section table needs a spacer paragraph. */
export function tableSpacer(): Paragraph {
  return new Paragraph({ children: [] });
}

export function paragraph(children: readonly ParagraphChild[], options: IParagraphOptions = {}): Paragraph {
  return new Paragraph({
    spacing: BODY_SPACING,
    ...options,
    children,
  });
}

export function textParagraph(text: string, style: TextStyle = {}, options: IParagraphOptions = {}): Paragraph {
  return paragraph([textRun(text, style)], options);
}

export function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function stripBullet(text: string): string {
  return text.replace(/^(?:[-*]|\u2022)\s+/, "");
}

export function isBulletLine(text: string): boolean {
  return /^(?:[-*]|\u2022)\s+/.test(text);
}

export function bulletParagraph(
  text: string,
  style: TextStyle = {},
  options: IParagraphOptions = {},
): Paragraph {
  return paragraph([textRun(stripBullet(text), style)], { ...options, bullet: { level: 0 } });
}

export function contentParagraphs(
  text: string | undefined,
  style: TextStyle = {},
  options: IParagraphOptions = {},
): Paragraph[] {
  return nonEmptyLines(text ?? "").map((line) => (
    isBulletLine(line) ? bulletParagraph(line, style, options) : textParagraph(line, style, options)
  ));
}

export function labelledBulletParagraph(text: string, options: IParagraphOptions = {}): Paragraph {
  const value = stripBullet(text);
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return bulletParagraph(value, {}, options);
  }

  return paragraph([
    textRun(value.slice(0, separatorIndex + 1), { bold: true }),
    textRun(value.slice(separatorIndex + 1), { bold: true }),
  ], { ...options, bullet: { level: 0 } });
}

export function listParagraphs(
  items: string[] | undefined,
  labelled = false,
  options: IParagraphOptions = {},
): Paragraph[] {
  return (items ?? []).flatMap((item) => nonEmptyLines(item).map((line) => (
    labelled ? labelledBulletParagraph(line, options) : bulletParagraph(line, {}, options)
  )));
}

export function subheading(title: string, italics = false): Paragraph {
  return textParagraph(title, { bold: true, italics }, {
    spacing: SUBHEADING_SPACING,
    keepNext: true,
  });
}

export function headingParagraph(title: string): Paragraph {
  return textParagraph(title.toUpperCase(), { bold: true, color: "ffffff" }, {
    spacing: HEADING_SPACING,
    keepNext: true,
  });
}

export function cell(children: readonly (Paragraph | Table)[], options: CellOptions = {}): TableCell {
  return new TableCell({
    children: children.length > 0 ? children : [textParagraph("")],
    borders: CELL_BORDERS,
    columnSpan: options.columnSpan,
    margins: options.margins ?? CONTENT_CELL_MARGINS,
    shading: options.fill ? { fill: options.fill, type: ShadingType.CLEAR } : undefined,
    verticalAlign: options.verticalAlign,
    width: options.width === undefined ? undefined : { size: options.width, type: WidthType.DXA },
  });
}

export function row(children: readonly TableCell[], height?: number): TableRow {
  return new TableRow(
    height === undefined
      ? { children }
      : { children, height: { value: height, rule: "atLeast" as const } },
  );
}

export function table(rows: readonly TableRow[], columnWidths: number[], width: number): Table {
  return new Table({
    rows,
    width: { size: width, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: TABLE_BORDERS,
    indent: { size: 3, type: WidthType.DXA },
  });
}

export function headingCell(title: string, columnSpan?: number, margins = CONTENT_CELL_MARGINS): TableCell {
  return cell([headingParagraph(title)], {
    fill: DARK_FILL,
    columnSpan,
    margins,
  });
}

export function labelledCell(label: string, fill = LABEL_FILL): TableCell {
  return cell([
    textParagraph(label, { bold: true }, { spacing: { after: 0, line: 227, lineRule: "auto" } }),
  ], { fill, margins: DETAILS_CELL_MARGINS });
}

export function detailsValueCell(value: string | undefined, style: TextStyle = {}): TableCell {
  const paragraphs = contentParagraphs(value, style);
  return cell(paragraphs, { margins: DETAILS_CELL_MARGINS });
}
