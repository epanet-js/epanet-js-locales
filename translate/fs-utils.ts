import { promises as fs } from "fs";
import path from "path";

export type JSONObject = Record<string, any>;

export async function readJson(filePath: string): Promise<JSONObject> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (err: any) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
}

export async function writeJsonAtomic(filePath: string, obj: JSONObject) {
  const tmp = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}
