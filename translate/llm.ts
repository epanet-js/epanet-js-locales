import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  API_KEY,
  CHUNK_SIZE,
  MAX_RETRIES,
  RETRY_BASE_MS,
  vlog,
} from "./config";
import { placeholdersMatch } from "./placeholders";
import { chunk, retry } from "./chunking";

export type JSONObject = Record<string, any>;
export type TargetLang = { code: string; name: string };

const genAI = new GoogleGenerativeAI(API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

function buildPrompt(
  values: string[],
  langName: string,
  liveEN: JSONObject,
  target: JSONObject,
) {
  return `
You are a professional UI translator. Translate each English UI string into ${langName}.
Return ONLY valid JSON: a single array of strings, same length and order as the input array.

Rules:
- Preserve placeholders exactly: {{var}}, {{1}}, {0}, %s, etc.
- Keep sentence casing and punctuation style.
- Do not add, remove, or reorder entries. No objects, no extra text.

Full English JSON (context):
${JSON.stringify(liveEN, null, 2)}

Existing ${langName} JSON (context):
${JSON.stringify(target, null, 2)}

Input (JSON array of English strings):
${JSON.stringify(values, null, 2)}
`.trim();
}

async function callLLMArray(
  values: string[],
  lang: TargetLang,
  liveEN: JSONObject,
  target: JSONObject,
): Promise<string[]> {
  if (values.length === 0) return [];

  const prompt = buildPrompt(values, lang.name, liveEN, target);
  vlog(`LLM prompt for ${lang.code}`, prompt);

  const req = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  };

  const res = await model.generateContent(req);
  const text = res.response.text();
  vlog(`LLM raw response (${lang.code})`, text);

  let out: unknown;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response for ${lang.code}`);
  }
  if (!Array.isArray(out))
    throw new Error(`Expected JSON array for ${lang.code}`);
  if (!out.every((s) => typeof s === "string"))
    throw new Error(`Non-string item in array for ${lang.code}`);
  if ((out as string[]).length !== values.length)
    throw new Error(`Length mismatch for ${lang.code}`);

  // Placeholder validation
  for (let i = 0; i < values.length; i++) {
    if (!placeholdersMatch(values[i], (out as string[])[i])) {
      throw new Error(
        `Placeholder mismatch (${lang.code}) at idx ${i}: "${values[i]}" -> "${
          (out as string[])[i]
        }"`,
      );
    }
  }

  return out as string[];
}

export async function translateValues(
  values: string[],
  lang: TargetLang,
  liveEN: JSONObject,
  target: JSONObject,
): Promise<string[]> {
  const pieces = chunk(values, CHUNK_SIZE);
  const results: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const translated = await retry(
      () => callLLMArray(pieces[i], lang, liveEN, target),
      MAX_RETRIES,
      RETRY_BASE_MS,
    );
    results.push(...translated);
  }
  return results;
}
