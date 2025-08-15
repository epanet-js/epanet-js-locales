import { JSONObject } from "./fs-utils";
import { Leaf, PathArr, walkLeaves } from "./walkers";

export function diffKeys(
  liveEN: JSONObject,
  localEN: JSONObject,
  target: JSONObject,
): {
  deleted: PathArr[];
  toTranslatePaths: PathArr[];
  toTranslateValues: string[];
} {
  const liveLeaves = [...walkLeaves(liveEN)];
  const localLeaves = [...walkLeaves(localEN)];
  const targetLeaves = new Map<string, Leaf>(
    [...walkLeaves(target)].map((leaf) => [leaf.path.join("\u0000"), leaf]),
  );

  // Deleted keys: in localEN but not in liveEN
  const liveSet = new Set(liveLeaves.map((l) => l.path.join("\u0000")));
  const deleted: PathArr[] = [];
  for (const leaf of localLeaves) {
    const key = leaf.path.join("\u0000");
    if (!liveSet.has(key)) {
      if (targetLeaves.has(key)) deleted.push(leaf.path);
    }
  }

  // New or modified
  const localMap = new Map(
    localLeaves.map((l) => [l.path.join("\u0000"), l.value]),
  );
  const toTranslatePaths: PathArr[] = [];
  const toTranslateValues: string[] = [];
  for (const leaf of liveLeaves) {
    const key = leaf.path.join("\u0000");
    const targetHas = targetLeaves.has(key);
    const localVal = localMap.get(key);
    const isNew = !targetHas;
    const isModified = typeof localVal === "string" && localVal !== leaf.value;

    if (isNew || isModified) {
      toTranslatePaths.push(leaf.path);
      toTranslateValues.push(leaf.value);
    }
  }

  return { deleted, toTranslatePaths, toTranslateValues };
}
