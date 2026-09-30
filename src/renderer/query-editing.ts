import { parseExpression } from "@babel/parser";
import { object } from "../shared/bson";

export type QueryKeyIntent = "run" | "newline" | "indent" | "unindent";
export type QuerySuggestionIntent =
  | { type: "accept"; index: number }
  | { type: "move"; index: number }
  | { type: "dismiss" };

export function querySuggestionKeyIntent(
  key: string,
  isOpen: boolean,
  optionCount: number,
  selectedIndex: number,
): QuerySuggestionIntent | undefined {
  if (!isOpen || optionCount < 1) return undefined;
  const index = ((selectedIndex % optionCount) + optionCount) % optionCount;
  if (key === "Enter") return { type: "accept", index };
  if (key === "ArrowDown")
    return { type: "move", index: (index + 1) % optionCount };
  if (key === "ArrowUp")
    return { type: "move", index: (index + optionCount - 1) % optionCount };
  if (key === "Escape") return { type: "dismiss" };
  return undefined;
}

export function queryKeyIntent(
  key: string,
  ctrlKey = false,
  shiftKey = false,
  metaKey = false,
): QueryKeyIntent | undefined {
  if (key === "F5") return "run";
  if (key === "Enter") return "newline";
  if (key !== "Tab" || shiftKey || metaKey) return undefined;
  return ctrlKey ? "unindent" : "indent";
}

export function editQueryIndentation(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  tabWidth: number,
  intent: "indent" | "unindent",
) {
  const width = Math.max(1, Math.floor(tabWidth));
  const spaces = " ".repeat(width);
  if (intent === "indent" && selectionStart === selectionEnd) {
    const value =
      text.slice(0, selectionStart) + spaces + text.slice(selectionEnd);
    return {
      value,
      selectionStart: selectionStart + width,
      selectionEnd: selectionEnd + width,
    };
  }

  const firstLine = text.lastIndexOf("\n", selectionStart - 1) + 1;
  const lastLine =
    text.lastIndexOf("\n", Math.max(selectionStart, selectionEnd - 1)) + 1;
  const lineStarts = [firstLine];
  let lineStart = firstLine;
  while (lineStart < lastLine) {
    lineStart = text.indexOf("\n", lineStart) + 1;
    if (!lineStart) break;
    lineStarts.push(lineStart);
  }

  if (intent === "indent") {
    let value = text;
    for (const position of [...lineStarts].reverse()) {
      value = value.slice(0, position) + spaces + value.slice(position);
    }
    const offset = (position: number) =>
      lineStarts.filter((line) => line <= position).length * width;
    return {
      value,
      selectionStart: selectionStart + offset(selectionStart),
      selectionEnd: selectionEnd + offset(selectionEnd),
    };
  }

  const edits = lineStarts.flatMap((position) => {
    const count = text
      .slice(position, position + width)
      .match(/^ */)?.[0].length;
    return count ? [{ position, count }] : [];
  });
  let value = text;
  for (const { position, count } of [...edits].reverse()) {
    value = value.slice(0, position) + value.slice(position + count);
  }
  const offset = (position: number) =>
    edits.reduce(
      (shift, edit) =>
        shift + Math.min(edit.count, Math.max(0, position - edit.position)),
      0,
    );
  return {
    value,
    selectionStart: selectionStart - offset(selectionStart),
    selectionEnd: selectionEnd - offset(selectionEnd),
  };
}

/** Format syntax, without evaluating JS or round-tripping numbers through JSON.parse. */
export function formatQuery(text: string, indent = 2): string {
  const root = parseExpression(text.trim() || "{}", { sourceType: "module" });
  if (root.type !== "ObjectExpression")
    throw new Error("Expected a query document { … }");
  const print = (node: any, depth: number): string => {
    const pad = " ".repeat(depth * indent),
      child = " ".repeat((depth + 1) * indent);
    if (node.type === "ObjectExpression") {
      const properties = node.properties.map((p: any) => {
        if (
          p.type !== "ObjectProperty" ||
          p.computed ||
          p.method ||
          p.shorthand
        )
          throw new Error("Only literal query properties can be formatted");
        const key = p.key.type === "Identifier" ? p.key.name : p.key.value;
        if (typeof key !== "string" && typeof key !== "number")
          throw new Error("Invalid query key");
        return (
          child + JSON.stringify(String(key)) + ": " + print(p.value, depth + 1)
        );
      });
      return properties.length
        ? "{\n" + properties.join(",\n") + "\n" + pad + "}"
        : "{}";
    }
    if (node.type === "ArrayExpression") {
      if (node.elements.some((v: any) => !v))
        throw new Error("Sparse arrays are not supported");
      return node.elements.length
        ? "[\n" +
            node.elements
              .map((v: any) => child + print(v, depth + 1))
              .join(",\n") +
            "\n" +
            pad +
            "]"
        : "[]";
    }
    if (node.type === "StringLiteral") return JSON.stringify(node.value);
    if (node.type === "NumericLiteral")
      return node.extra?.raw ?? String(node.value);
    if (node.type === "BooleanLiteral") return String(node.value);
    if (node.type === "NullLiteral") return "null";
    if (
      node.type === "UnaryExpression" &&
      ["-", "+"].includes(node.operator) &&
      node.argument.type === "NumericLiteral"
    )
      return node.operator + print(node.argument, depth);
    if (
      node.type === "CallExpression" &&
      !node.optional &&
      node.callee.type === "Identifier" &&
      node.callee.name === "ISODate" &&
      node.arguments.length === 1 &&
      node.arguments[0].type === "StringLiteral"
    )
      return `ISODate(${JSON.stringify(node.arguments[0].value)})`;
    if (
      node.type === "NewExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "Date" &&
      node.arguments.length === 1 &&
      ["StringLiteral", "NumericLiteral", "UnaryExpression"].includes(
        node.arguments[0].type,
      ) &&
      (node.arguments[0].type !== "UnaryExpression" ||
        (["-", "+"].includes(node.arguments[0].operator) &&
          node.arguments[0].argument.type === "NumericLiteral"))
    )
      return `new Date(${print(node.arguments[0], depth)})`;
    throw new Error(`Unsupported query expression: ${node.type}`);
  };
  return print(root, 0);
}

export function querySortDirections(text: string): Record<string, 1 | -1> {
  try {
    return Object.fromEntries(
      Object.entries(object(text || "{}")).flatMap(([key, value]) => {
        const direction = Number(value);
        return direction === 1 || direction === -1 ? [[key, direction]] : [];
      }),
    );
  } catch {
    return {};
  }
}
export function hasQuerySort(text: string) {
  try {
    return Object.keys(object(text || "{}")).length > 0;
  } catch {
    return !!text.trim();
  }
}
