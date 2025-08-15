export type PathArr = string[];
export type Leaf = { path: PathArr; value: string };

export function* walkLeaves(obj: any, prefix: PathArr = []): Generator<Leaf> {
  const keys = Object.keys(obj || {}).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const v = obj[k];
    const next = [...prefix, k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      yield* walkLeaves(v, next);
    } else if (typeof v === "string") {
      yield { path: next, value: v };
    }
  }
}

export function getAtPath(obj: any, path: PathArr): any {
  return path.reduce(
    (acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined),
    obj,
  );
}

export function setAtPath(obj: any, path: PathArr, value: string) {
  let curr = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!curr[k] || typeof curr[k] !== "object" || Array.isArray(curr[k])) {
      curr[k] = {};
    }
    curr = curr[k];
  }
  curr[path[path.length - 1]] = value;
}

export function deleteAtPath(obj: any, path: PathArr) {
  let curr = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!curr[k] || typeof curr[k] !== "object") return;
    curr = curr[k];
  }
  delete curr[path[path.length - 1]];

  // cleanup empty parents
  for (let i = path.length - 2; i >= 0; i--) {
    const parent = i === 0 ? obj : getAtPath(obj, path.slice(0, i));
    const key = path[i];
    if (
      parent &&
      typeof parent[key] === "object" &&
      Object.keys(parent[key] || {}).length === 0
    ) {
      delete parent[key];
    } else {
      break;
    }
  }
}
