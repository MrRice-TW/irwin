const spreadsheetFormulaStarts = new Set([
  "=",
  "+",
  "-",
  "@",
  "\t",
  "\r",
  "＝",
  "＋",
  "－",
  "＠",
]);
const unsafeControlStarts = new Set(["\t", "\r", "\n"]);

export function csvFormulaEscapingSidecar(): string {
  return JSON.stringify(
    { version: 2, columns: [], formulaEscaping: "apostrophe-v1" },
    null,
    2,
  );
}

function hasFormulaTrigger(value: string): boolean {
  let index = 0;
  while (value[index] === "'") index++;
  if (unsafeControlStarts.has(value[index] || "")) return true;
  while (
    index < value.length &&
    (/\s/.test(value[index]) ||
      value[index] === "\0" ||
      value[index] === "\uFEFF")
  ) {
    index++;
  }
  return spreadsheetFormulaStarts.has(value[index] || "");
}

export function escapeCsvText(value: string): string {
  return hasFormulaTrigger(value) ? `'${value}` : value;
}

export function unescapeCsvText(value: string): string {
  return value.startsWith("'") && hasFormulaTrigger(value.slice(1))
    ? value.slice(1)
    : value;
}
