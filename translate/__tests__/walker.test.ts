import { describe, it, expect } from "vitest";
import { walkLeaves, setAtPath, deleteAtPath, getAtPath } from "../walkers";

describe("walkers", () => {
  it("walkLeaves returns leaves in stable order", () => {
    const obj = { b: { y: "2", x: "1" }, a: { c: "3" } };
    const leaves = [...walkLeaves(obj)].map((l) => ({
      path: l.path.join("."),
      value: l.value,
    }));
    expect(leaves).toEqual([
      { path: "a.c", value: "3" },
      { path: "b.x", value: "1" },
      { path: "b.y", value: "2" },
    ]);
  });

  it("setAtPath creates nested objects as needed", () => {
    const obj: any = {};
    setAtPath(obj, ["foo", "bar", "baz"], "ok");
    expect(obj).toEqual({ foo: { bar: { baz: "ok" } } });
    expect(getAtPath(obj, ["foo", "bar", "baz"])).toBe("ok");
  });

  it("deleteAtPath removes empty parents", () => {
    const obj: any = { foo: { bar: { baz: "ok" }, keep: "x" } };
    deleteAtPath(obj, ["foo", "bar", "baz"]);
    expect(obj).toEqual({ foo: { keep: "x" } });
    // delete last leaf in subtree
    deleteAtPath(obj, ["foo", "keep"]);
    expect(obj).toEqual({});
  });
});
