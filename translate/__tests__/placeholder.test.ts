import { describe, it, expect } from "vitest";
import { extractPlaceholders, placeholdersMatch } from "../placeholders";

describe("placeholders", () => {
  it("extracts various placeholder styles", () => {
    const s = "Hello {{name}} {0} %s and %1$s";
    const ph = extractPlaceholders(s).sort();
    expect(ph).toEqual(["{{name}}", "{0}", "%1$s", "%s"].sort());
  });

  it("matches equal placeholder sets", () => {
    expect(placeholdersMatch("Hi {{x}}", "Salut {{x}}")).toBe(true);
    expect(placeholdersMatch("A {0} B %s", "A {0} B %s")).toBe(true);
  });

  it("detects mismatch", () => {
    expect(placeholdersMatch("Hi {{x}}", "Salut {{y}}")).toBe(false);
    expect(placeholdersMatch("A {0}", "A {1}")).toBe(false);
  });
});
