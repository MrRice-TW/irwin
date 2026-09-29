import { describe, expect, it } from "vitest";
import { filterHistory } from "../src/renderer/history-filter";

describe("history filtering", () => {
  const items = [
    { id: "1", label: "Recent people", database: "app", collection: "people", code: "db.people.find({active:true})" },
    { id: "2", label: "Orders", database: "commerce", collection: "orders", code: "db.orders.find({status:'open'})" },
  ];

  it("searches labels, namespaces and saved query text without changing source order", () => {
    expect(filterHistory(items, "COMMERCE").map((item) => item.id)).toEqual(["2"]);
    expect(filterHistory(items, "active:true").map((item) => item.id)).toEqual(["1"]);
    expect(filterHistory(items, "")).toEqual(items);
  });
});
