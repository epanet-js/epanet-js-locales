import { describe, it, expect } from "vitest";
import { diffKeys } from "../diff";
import {
  liveEN,
  localEN_previous,
  targetFR_existing,
  targetNL_existing,
} from "./fixtures";

describe("diffKeys", () => {
  it("detects deleted, new, and modified for FR", () => {
    const { deleted, toTranslatePaths, toTranslateValues } = diffKeys(
      liveEN,
      localEN_previous,
      targetFR_existing,
    );

    // deleted: localEN had menu.view; liveEN no longer has it; target has it -> delete
    expect(deleted.map((p) => p.join("."))).toEqual(["menu.view"]);

    // new: app.about missing in target -> translate
    // modified: localEN app.about != liveEN app.about -> translate
    const paths = toTranslatePaths.map((p) => p.join("."));
    expect(paths).toContain("app.about");
    // save/cancel/greet shouldn't be included (already present and same source)
    expect(paths).not.toContain("app.button.save");
    expect(paths).not.toContain("app.button.cancel");
    expect(paths).not.toContain("app.button.greet");

    // values align with liveEN
    const idx = paths.indexOf("app.about");
    expect(toTranslateValues[idx]).toBe("About the app");
  });

  it("detects nothing to delete for NL and maybe nothing to translate", () => {
    const { deleted, toTranslatePaths } = diffKeys(
      liveEN,
      localEN_previous,
      targetNL_existing,
    );
    expect(deleted).toEqual([]); // NL target doesn't have menu.view, so nothing to delete
    // NL already has app.about and others; only modified key is app.about (since localEN changed),
    // but target has a translation (we still re-translate because source changed!)
    expect(toTranslatePaths.map((p) => p.join("."))).toContain("app.about");
  });
});
