import path from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

export const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error("GEMINI_API_KEY environment variable not set.");

export const LIVE_ENGLISH_URL =
  "https://app.epanetjs.com/locales/en/translation.json";

export const LOCALES_DIR = path.join(process.cwd(), "locales");
export const DEFAULT_NS = "translation";

export type TargetLang = { code: string; name: string };

export const TARGET_LANGUAGES: TargetLang[] = [
  { code: "es", name: "Español (ES)" },
  { code: "pt", name: "Português (BR)" },
  { code: "fr", name: "Français (FR)" },
  { code: "nl", name: "Nederlands (NL)" },
  { code: "ja", name: "日本語 (JA)" },
];

export const VERBOSE =
  process.env.VERBOSE === "true" || process.env.VERBOSE === "1";
export const DRY_RUN =
  process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1";

// LLM chunk & retry settings
export const CHUNK_SIZE = 150;
export const MAX_RETRIES = 3;
export const RETRY_BASE_MS = 800;

export function vlog(msg: string, data?: unknown) {
  if (!VERBOSE) return;
  console.log(`[VERBOSE] ${msg}`);
  if (typeof data !== "undefined") {
    console.log(
      typeof data === "string" ? data : JSON.stringify(data, null, 2),
    );
  }
}
