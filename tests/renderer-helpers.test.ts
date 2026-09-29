import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import {
  collectionSort,
  csvContent,
  excelContent,
  shellSessionId,
} from "../src/renderer/helpers";

describe("renderer helpers", () => {
  it("sorts collection names alphabetically without case sensitivity", () => {
    expect(
      collectionSort([
        { name: "zebra", type: "collection" },
        { name: "Alpha", type: "collection" },
        { name: "beta", type: "collection" },
      ]).map((item) => item.name),
    ).toEqual(["Alpha", "beta", "zebra"]);
  });

  it("uses the same session id for free commands on collection tabs", () => {
    expect(shellSessionId({ id: "tab-1", kind: "collection" })).toBe(
      "tab-1-free",
    );
    expect(shellSessionId({ id: "tab-2", kind: "shell" })).toBe("tab-2");
  });

  it("exports loaded query rows as escaped CSV", () => {
    const rows = [
      { ejson: '{"name":"Ada","note":"A,B","active":true}', editable: true },
      {
        ejson: '{"name":"Grace","note":"He said \\\"hello\\\"","active":false}',
        editable: true,
      },
    ];

    expect(csvContent(rows)).toBe(
      '\uFEFFname,note,active\r\nAda,"A,B",true\r\nGrace,"He said ""hello""",false\r\n',
    );
  });

  it("escapes spreadsheet formulas in text and headers without changing negative numbers", () => {
    const rows = [
      {
        ejson: JSON.stringify({
          "=header": "=1+1",
          plus: "+SUM(1,1)",
          minusText: "-cmd",
          at: "@SUM(1,1)",
          tab: "\t=1+1",
          carriage: "\r=1+1",
          lineFeed: "\n=1+1",
          leadingSpace: " =1+1",
          fullWidth: "＝1+1",
          originalApostrophe: "'=1+1",
          numberLikeObject: { $numberInt: "=1+1" },
          noncanonicalNumberLikeObject: { $numberDecimal: "+1" },
          negativeNumber: -42,
        }),
        editable: true,
      },
    ];

    const [header, values] = parseCsv(csvContent(rows), {
      bom: true,
    }) as string[][];

    expect(header).toEqual([
      "'=header",
      "plus",
      "minusText",
      "at",
      "tab",
      "carriage",
      "lineFeed",
      "leadingSpace",
      "fullWidth",
      "originalApostrophe",
      "numberLikeObject",
      "noncanonicalNumberLikeObject",
      "negativeNumber",
    ]);
    expect(values).toEqual([
      "'=1+1",
      "'+SUM(1,1)",
      "'-cmd",
      "'@SUM(1,1)",
      "'\t=1+1",
      "'\r=1+1",
      "'\n=1+1",
      "' =1+1",
      "'＝1+1",
      "''=1+1",
      '{"$numberInt":"=1+1"}',
      '{"$numberDecimal":"+1"}',
      "-42",
    ]);
  });

  it("exports loaded query rows as a real XLSX package", async () => {
    const rows = [
      {
        ejson: JSON.stringify({
          name: "Ada & Grace",
          score: 98,
          formulaText: "=1+1",
        }),
        editable: true,
      },
    ];
    const output = await excelContent(rows);
    const bytes = Buffer.from(output, "base64");

    expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(output).not.toContain("<table>");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    const sheet = workbook.getWorksheet("Query Results");
    expect(sheet?.getCell("A1").value).toBe("name");
    expect(sheet?.getCell("B1").value).toBe("score");
    expect(sheet?.getCell("C1").value).toBe("formulaText");
    expect(sheet?.getCell("A2").value).toBe("Ada & Grace");
    expect(sheet?.getCell("B2").value).toBe(98);
    expect(sheet?.getCell("C2").value).toBe("=1+1");
    expect(sheet?.getCell("C2").type).toBe(ExcelJS.ValueType.String);
  });

  it("round-trips BSON values and heterogeneous rows through the XLSX reader", async () => {
    const rows = [
      {
        ejson: JSON.stringify({
          name: "繁體中文 & English",
          active: true,
          count: { $numberLong: "9007199254740993" },
          price: { $numberDecimal: "123456789.123456789" },
          id: { $oid: "507f1f77bcf86cd799439011" },
          nested: { city: "台北", tags: ["a", "b"] },
          empty: null,
        }),
        editable: true,
      },
      { ejson: '{"name":"Second","score":-42}', editable: true },
    ];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(await excelContent(rows), "base64") as never,
    );
    const sheet = workbook.getWorksheet("Query Results")!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "name",
      "active",
      "count",
      "price",
      "id",
      "nested",
      "empty",
      "score",
    ]);
    expect(sheet.getCell("A2").value).toBe("繁體中文 & English");
    expect(sheet.getCell("B2").value).toBe(true);
    expect(sheet.getCell("C2").value).toBe("9007199254740993");
    expect(sheet.getCell("D2").value).toBe("123456789.123456789");
    expect(sheet.getCell("E2").value).toBe(
      'ObjectId("507f1f77bcf86cd799439011")',
    );
    expect(JSON.parse(sheet.getCell("F2").value as string)).toEqual({
      city: "台北",
      tags: ["a", "b"],
    });
    expect(sheet.getCell("G2").value).toBeNull();
    expect(sheet.getCell("B3").value).toBe("");
    expect(sheet.getCell("H3").value).toBe(-42);
  });
});
