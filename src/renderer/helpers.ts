import ExcelJS from "exceljs";
import type { Row } from "../shared/contracts";
import { escapeCsvText } from "../shared/csv";

export type CollectionItem = { name: string; type: string };

export function collectionSort<T extends CollectionItem>(items: T[]): T[] {
  return items
    .slice()
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

export function shellSessionId(tab: {
  id: string;
  kind: "collection" | "shell" | "aggregation";
}): string {
  return tab.kind === "shell" ? tab.id : `${tab.id}-free`;
}

type ExportRow = Pick<Row, "ejson">;

type CsvExportCell = { value: string; escapeFormula: boolean };

function canonicalExtendedNumber(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  if (Object.keys(value).length !== 1 || typeof value[key] !== "string")
    return undefined;
  const text = value[key] as string;
  if (key === "$numberInt" || key === "$numberLong") {
    if (!/^-?(?:0|[1-9]\d*)$/.test(text)) return undefined;
    const number = BigInt(text);
    const min = key === "$numberInt" ? -2147483648n : -9223372036854775808n;
    const max = key === "$numberInt" ? 2147483647n : 9223372036854775807n;
    return number >= min && number <= max ? text : undefined;
  }
  if (key === "$numberDouble" || key === "$numberDecimal") {
    const special = ["NaN", "Infinity", "-Infinity"];
    const decimal = /^-?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)$/;
    return special.includes(text) || decimal.test(text) ? text : undefined;
  }
  return undefined;
}

function exportValue(value: unknown): CsvExportCell {
  if (value === undefined) return { value: "", escapeFormula: false };
  if (value === null) return { value: "null", escapeFormula: false };
  if (typeof value === "string") return { value, escapeFormula: true };
  if (typeof value !== "object")
    return { value: String(value), escapeFormula: false };
  const bson = value as Record<string, unknown>;
  if (typeof bson.$oid === "string")
    return { value: `ObjectId("${bson.$oid}")`, escapeFormula: false };
  for (const key of [
    "$numberInt",
    "$numberLong",
    "$numberDouble",
    "$numberDecimal",
  ]) {
    const number = canonicalExtendedNumber(bson, key);
    if (number !== undefined) return { value: number, escapeFormula: false };
  }
  if (bson.$date !== undefined) {
    const dateValue = bson.$date as Record<string, unknown> | number | string;
    const millis =
      typeof dateValue === "object"
        ? Number(dateValue.$numberLong)
        : Number(dateValue);
    const date = new Date(millis);
    return {
      value: Number.isNaN(date.valueOf())
        ? JSON.stringify(value)
        : date.toISOString(),
      escapeFormula: false,
    };
  }
  return { value: JSON.stringify(value), escapeFormula: false };
}

export function resultTable(rows: ExportRow[]): {
  columns: string[];
  values: CsvExportCell[][];
} {
  const documents = rows.map((row) => {
    const value = JSON.parse(row.ejson) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  });
  const columns = [
    ...new Set(documents.flatMap((document) => Object.keys(document))),
  ];
  const values = documents.map((document) =>
    columns.map((column) => exportValue(document[column])),
  );
  return { columns, values };
}

function csvCell(value: string, escapeFormula = false): string {
  if (escapeFormula) value = escapeCsvText(value);
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function csvContent(rows: ExportRow[]): string {
  const table = resultTable(rows);
  return `\uFEFF${[table.columns, ...table.values]
    .map((row) =>
      row
        .map((cell) =>
          typeof cell === "string"
            ? csvCell(cell, true)
            : csvCell(cell.value, cell.escapeFormula),
        )
        .join(","),
    )
    .join("\r\n")}\r\n`;
}

type ExcelCell = string | number | boolean | null;

function excelValue(value: unknown): ExcelCell {
  if (value === undefined) return "";
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  const bson = value as Record<string, unknown>;
  if (typeof bson.$oid === "string") return 'ObjectId("' + bson.$oid + '")';
  if (bson.$numberInt !== undefined) return Number(bson.$numberInt);
  if (bson.$numberDouble !== undefined) return Number(bson.$numberDouble);
  if (bson.$numberLong !== undefined) {
    const number = Number(bson.$numberLong);
    return Number.isSafeInteger(number) ? number : String(bson.$numberLong);
  }
  if (bson.$numberDecimal !== undefined) return String(bson.$numberDecimal);
  if (bson.$date !== undefined) {
    const dateValue = bson.$date as Record<string, unknown> | number | string;
    const millis =
      typeof dateValue === "object"
        ? Number(dateValue.$numberLong)
        : Number(dateValue);
    const date = new Date(millis);
    return Number.isNaN(date.valueOf())
      ? JSON.stringify(value)
      : date.toISOString();
  }
  return JSON.stringify(value);
}

function excelTable(rows: ExportRow[]): {
  columns: string[];
  values: ExcelCell[][];
} {
  const documents = rows.map((row) => {
    const value = JSON.parse(row.ejson) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  });
  const columns = [
    ...new Set(documents.flatMap((document) => Object.keys(document))),
  ];
  const values = documents.map((document) =>
    columns.map((column) => excelValue(document[column])),
  );
  return { columns, values };
}
export async function excelContent(rows: ExportRow[]): Promise<string> {
  const table = excelTable(rows);
  const workbook = new ExcelJS.Workbook();
  workbook
    .addWorksheet("Query Results")
    .addRows([table.columns, ...table.values]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}
