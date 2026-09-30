import { describe, expect, it } from "vitest";
import { Decimal128, Double, Int32, Long, ObjectId } from "bson";
import { formatDocument, prettyDocument, shellJsonLanguage } from "../src/renderer/json-format";
import { decode, encode } from "../src/shared/bson";

describe("JSON document formatting", () => {
  it("uses the configured indentation width", () => {
    expect(
      prettyDocument(
        { profile: { name: "Ada", tags: ["math", "code"] } },
        { indent: 4 },
      ),
    ).toContain("    profile: {");
  });

  it("keeps BSON values readable and type-safe in shell-friendly syntax", () => {
    expect(
      prettyDocument(
        {
          _id: { $oid: "6a4f6bffbed892721b94b460" },
          number1: { $numberInt: "1" },
          number2: { $numberDouble: "1.2" },
        },
        { indent: 2 },
      ),
    ).toContain(
      'ObjectId("6a4f6bffbed892721b94b460")',
    );
    expect(prettyDocument({ number1: { $numberInt: "1" } }, { indent: 2 })).toContain(
      'number1: Int32("1")',
    );
  });
  it("formats JSON or shell-friendly documents with the configured indentation", () => {
    expect(formatDocument("{\"name\":\"Ada\",\"n\":{\"$numberInt\":\"1\"}}", 4)).toContain(
      '    n: Int32("1")',
    );
  });

  it("formats a manually entered single-quoted ISODate without changing its value", () => {
    const editable = formatDocument(
      "{ createdAt: ISODate('2026-07-02T09:26:31.616Z') }",
      2,
    );

    expect(editable).toContain(
      'createdAt: ISODate("2026-07-02T09:26:31.616Z")',
    );
    expect(decode(editable).createdAt.toISOString()).toBe(
      "2026-07-02T09:26:31.616Z",
    );
  });

  it("uses the JSON view's friendly BSON syntax for safe document edits", () => {
    const document = {
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      count: new Int32(7),
      score: new Double(1),
      exactLong: Long.fromString("42"),
      largeLong: Long.fromString("9007199254740993"),
      price: Decimal128.fromString("1234.50"),
      createdAt: new Date("2025-01-02T03:04:05.000Z"),
    };
    const source = encode(document);
    const expected = prettyDocument(JSON.parse(source), { indent: 2 });
    const editable = formatDocument(source, 2);

    expect(editable).toBe(expected);
    expect(editable).toContain('ObjectId("507f1f77bcf86cd799439011")');
    expect(editable).toContain('Int32("7")');
    expect(editable).toContain('Double("1.0")');
    expect(editable).toContain('Long("42")');
    expect(editable).toContain('Long("9007199254740993")');
    expect(editable).toContain('Decimal128("1234.50")');
    expect(editable).toContain('ISODate("2025-01-02T03:04:05.000Z")');
    expect(encode(decode(editable))).toBe(source);
    const reformatted = formatDocument(editable, 4);
    expect(reformatted).toContain('    _id: ObjectId("507f1f77bcf86cd799439011")');
    expect(encode(decode(reformatted))).toBe(source);
    expect(() => decode('{ _id: ObjectId("invalid") }')).toThrow();
    expect(() => decode('{ count: Int32("2147483648") }')).toThrow();
    expect(() => decode('{ count: Long("9223372036854775808") }')).toThrow();
  });

  it("uses a diagnostic-free Mongo JSON mode for display", () => {
    expect(shellJsonLanguage).toBe("mongo-json");
  });
});
