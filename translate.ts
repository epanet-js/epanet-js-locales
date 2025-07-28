/**
 * Translation Workflow Script
 *
 * Automatically translates missing or modified keys from live English data
 * to target languages using Google's Gemini AI.
 *
 * VERBOSE LOGGING:
 * To enable detailed logging for debugging API issues:
 *
 * Environment variable method:
 *   VERBOSE=true pnpm start
 *   VERBOSE=1 pnpm start
 *
 * Or add to your .env.local file:
 *   VERBOSE=true
 *
 * When verbose mode is enabled:
 * - All API requests/responses are logged to console
 * - Detailed log files are created with timestamps
 * - Data transformations are tracked step by step
 * - Function call details from Gemini are captured
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { promises as fs } from "fs";
import path from "path";
import axios from "axios";
import {
  GoogleGenerativeAI,
  FunctionDeclarationsTool,
  SchemaType,
  FunctionCallingMode,
} from "@google/generative-ai";

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error("GEMINI_API_KEY environment variable not set.");

const LIVE_ENGLISH_URL = "https://app.epanetjs.com/locales/en/translation.json";
const LOCALES_DIR = path.join(process.cwd(), "locales");
const TARGET_LANGUAGES = [
  { code: "pt", name: "Português (BR)" },
  { code: "fr", name: "Français (FR)" },
  { code: "nl", name: "Nederlands (NL)" },
];
const VERBOSE = process.env.VERBOSE === "true" || process.env.VERBOSE === "1";

// --- Verbose Logging ---
function verboseLog(message: string, data?: any) {
  if (VERBOSE) {
    console.log(`[VERBOSE] ${message}`);
    if (data !== undefined) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

function writeVerboseLogToFile(filename: string, content: string) {
  if (VERBOSE) {
    const logPath = path.join(
      process.cwd(),
      "logs",
      `${Date.now()}-${filename}.log`,
    );
    fs.writeFile(logPath, content, "utf-8").catch(console.error);
    console.log(`[VERBOSE] Log written to: ${logPath}`);
  }
}

/**
 * Recursively removes empty objects from the nested structure.
 */
function cleanupEmptyObjects(obj: NestedLocaleData, path: string[]): void {
  if (path.length === 0) return;

  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    current = current[path[i]] as NestedLocaleData;
  }

  const targetKey = path[path.length - 1];
  const targetObj = current[targetKey];

  if (
    typeof targetObj === "object" &&
    targetObj !== null &&
    Object.keys(targetObj).length === 0
  ) {
    delete current[targetKey];
    cleanupEmptyObjects(obj, path.slice(0, -1));
  }
}

// --- Type Definitions ---
type LocaleValue = string | { [key: string]: LocaleValue };
type NestedLocaleData = { [key: string]: LocaleValue };
type FlatLocaleData = { [key: string]: string };

// --- Gemini API Setup for Structured Output ---
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
});

/**
 * Recursively extracts all key-value pairs from a nested object,
 * using a path array to track the nested structure.
 */
function extractKeyValuePairs(
  obj: NestedLocaleData,
  path: string[] = [],
): Array<{ path: string[]; value: string }> {
  const result: Array<{ path: string[]; value: string }> = [];

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...path, key];

    if (typeof value === "string") {
      result.push({ path: currentPath, value });
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result.push(
        ...extractKeyValuePairs(value as NestedLocaleData, currentPath),
      );
    }
  }

  return result;
}

/**
 * Creates a unique key from a path array for comparison purposes.
 */
function pathToKey(path: string[]): string {
  return path.join("###"); // Use ### as separator to avoid conflicts with dots
}

/**
 * Sets a value in a nested object using a path array.
 */
function setNestedValue(
  obj: NestedLocaleData,
  path: string[],
  value: string,
): void {
  let current = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (
      !(key in current) ||
      typeof current[key] !== "object" ||
      current[key] === null ||
      Array.isArray(current[key])
    ) {
      current[key] = {};
    }
    current = current[key] as NestedLocaleData;
  }

  current[path[path.length - 1]] = value;
}

/**
 * Removes a value from a nested object using a path array.
 */
function removeNestedValue(obj: NestedLocaleData, path: string[]): void {
  let current = obj;

  // Navigate to the parent of the target
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current) || typeof current[key] !== "object") {
      return; // Path doesn't exist
    }
    current = current[key] as NestedLocaleData;
  }

  // Remove the final key
  const finalKey = path[path.length - 1];
  delete current[finalKey];

  // Clean up empty parent objects
  cleanupEmptyObjects(obj, path.slice(0, -1));
}

// --- Other Helper Functions (Modified to handle new types) ---

async function readJsonFile(filePath: string): Promise<NestedLocaleData> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    if ((error as any).code === "ENOENT") return {};
    throw error;
  }
}

async function writeJsonFile(filePath: string, data: NestedLocaleData) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Flattens a nested object into flat key-value pairs using ### as separator.
 * This handles the case where the AI returns nested objects instead of flat keys.
 */
function flattenNestedObject(obj: any, prefix: string = ""): FlatLocaleData {
  const result: FlatLocaleData = {};

  for (const [key, value] of Object.entries(obj)) {
    const currentKey = prefix ? `${prefix}###${key}` : key;

    if (typeof value === "string") {
      result[currentKey] = value;
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Recursively flatten nested objects
      Object.assign(result, flattenNestedObject(value, currentKey));
    }
  }

  return result;
}

async function getTranslationsFromGemini(
  liveEnglishData: NestedLocaleData,
  localTargetData: NestedLocaleData,
  keysToTranslate: FlatLocaleData,
  language: { code: string; name: string },
): Promise<FlatLocaleData | null> {
  if (Object.keys(keysToTranslate).length === 0) {
    verboseLog("No keys to translate, returning empty object");
    return {};
  }

  const prompt = `
        You are an expert UI translator. Translate the following JSON values from English to ${
          language.name
        }.
        The keys use dot notation to represent nesting.
        Maintain the original meaning, tone, style, and cultural context appropriate for ${
          language.name
        }.
        Placeholders like {{variable}} or {{1}} must be preserved exactly.
        
        Return ONLY a valid JSON object with the translated key-value pairs. Do not include any other text or explanation.

        Here is the full existing English JSON file for context:
        ${JSON.stringify(liveEnglishData, null, 2)}

        Here is the full existing ${language.name} JSON file for context:
        ${JSON.stringify(localTargetData, null, 2)}
        
        JSON with strings to translate:
        ${JSON.stringify(keysToTranslate, null, 2)}
    `;

  console.log(
    `Requesting translation for ${
      Object.keys(keysToTranslate).length
    } keys for ${language.name} (${language.code})...`,
  );

  verboseLog("=== GEMINI API REQUEST ===");
  verboseLog("Target language:", language);
  verboseLog(
    "Number of keys to translate:",
    Object.keys(keysToTranslate).length,
  );
  verboseLog("Keys to translate:", keysToTranslate);
  verboseLog("Full prompt:", prompt);

  const requestPayload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };

  verboseLog("Request payload:", requestPayload);

  try {
    verboseLog("Sending request to Gemini API...");
    const result = await model.generateContent(requestPayload);

    verboseLog("=== GEMINI API RESPONSE ===");
    verboseLog("Full response object:", {
      response: {
        candidates: result.response.candidates,
        usageMetadata: result.response.usageMetadata,
      },
    });

    // Get the response text
    const responseText = result.response.text();
    verboseLog("Response text:", responseText);

    if (!responseText) {
      verboseLog("ERROR: No text response received");
      return null;
    }

    try {
      // Parse the response as JSON (should be clean JSON from JSON mode)
      const translations = JSON.parse(responseText) as FlatLocaleData;

      verboseLog("=== SUCCESSFUL TRANSLATION ===");
      verboseLog("Parsed translations:", translations);

      // Validate the translations
      const originalKeys = Object.keys(keysToTranslate);
      const translatedKeys = Object.keys(translations);

      verboseLog("Translation validation:");
      verboseLog("  Original keys count:", originalKeys.length);
      verboseLog("  Translated keys count:", translatedKeys.length);
      verboseLog(
        "  Missing keys:",
        originalKeys.filter((k) => !translatedKeys.includes(k)),
      );
      verboseLog(
        "  Extra keys:",
        translatedKeys.filter((k) => !originalKeys.includes(k)),
      );

      writeVerboseLogToFile(
        "gemini-success",
        JSON.stringify(
          {
            request: { keysToTranslate, language, prompt },
            response: {
              responseText,
              translations,
              originalKeysCount: originalKeys.length,
              translatedKeysCount: translatedKeys.length,
            },
          },
          null,
          2,
        ),
      );

      return translations;
    } catch (parseError) {
      verboseLog("=== JSON PARSE ERROR ===");
      verboseLog("Failed to parse response as JSON:", parseError);
      verboseLog("Response text:", responseText);

      console.error("Failed to parse Gemini response as JSON:", parseError);

      writeVerboseLogToFile(
        "gemini-parse-error",
        JSON.stringify(
          {
            request: { keysToTranslate, language, prompt },
            response: {
              responseText,
              parseError: String(parseError),
            },
          },
          null,
          2,
        ),
      );

      return null;
    }
  } catch (error) {
    const err = error as Error;
    verboseLog("=== API ERROR ===");
    verboseLog("Error details:", {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });

    console.error("Error calling Gemini API:", error);

    writeVerboseLogToFile(
      "gemini-exception",
      JSON.stringify(
        {
          request: { keysToTranslate, language, prompt },
          error: {
            message: err.message,
            stack: err.stack,
            name: err.name,
            fullError: String(error),
          },
        },
        null,
        2,
      ),
    );

    return null;
  }
}

// --- Main Execution Logic (Updated to use path-based approach) ---
async function main() {
  console.log("Starting translation workflow...");

  if (VERBOSE) {
    console.log(`[VERBOSE] Verbose logging is ENABLED`);
    console.log(
      `[VERBOSE] Target languages: ${TARGET_LANGUAGES.map(
        (lang) => `${lang.name} (${lang.code})`,
      ).join(", ")}`,
    );
    console.log(`[VERBOSE] Live English URL: ${LIVE_ENGLISH_URL}`);
    console.log(`[VERBOSE] Locales directory: ${LOCALES_DIR}`);
  }

  // 1. Fetch live English data and read local files
  verboseLog("Fetching live English data from URL...");
  const { data: liveEnglishData } = await axios.get<NestedLocaleData>(
    LIVE_ENGLISH_URL,
  );
  verboseLog(
    "Live English data keys count:",
    Object.keys(liveEnglishData).length,
  );

  verboseLog("Reading local English file...");
  const localEnglishData = await readJsonFile(
    path.join(LOCALES_DIR, "en", "translation.json"),
  );
  verboseLog(
    "Local English data keys count:",
    Object.keys(localEnglishData).length,
  );

  // Extract key-value pairs from all data
  verboseLog("Extracting key-value pairs from live English data...");
  const liveEnglishPairs = extractKeyValuePairs(liveEnglishData);
  verboseLog("Live English pairs count:", liveEnglishPairs.length);

  verboseLog("Extracting key-value pairs from local English data...");
  const localEnglishPairs = extractKeyValuePairs(localEnglishData);
  verboseLog("Local English pairs count:", localEnglishPairs.length);

  // Create lookup maps for easier comparison
  const liveEnglishMap = new Map(
    liveEnglishPairs.map((pair) => [pathToKey(pair.path), pair]),
  );
  const localEnglishMap = new Map(
    localEnglishPairs.map((pair) => [pathToKey(pair.path), pair]),
  );

  verboseLog("Created lookup maps for comparison");

  for (const lang of TARGET_LANGUAGES) {
    console.log(`\n--- Processing language: ${lang.name} (${lang.code}) ---`);
    verboseLog(`Processing target language: ${lang.name} (${lang.code})`);

    const targetFilePath = path.join(
      LOCALES_DIR,
      lang.code,
      "translation.json",
    );
    verboseLog("Target file path:", targetFilePath);

    const localTargetData = await readJsonFile(targetFilePath);
    verboseLog(
      "Local target data keys count:",
      Object.keys(localTargetData).length,
    );

    // Clean up any erroneous "translations" wrapper that might exist
    if (
      localTargetData.translations &&
      typeof localTargetData.translations === "object"
    ) {
      console.log(
        `  [CLEANUP] Found erroneous "translations" wrapper, merging contents...`,
      );
      verboseLog("Found translations wrapper, merging contents...");
      Object.assign(localTargetData, localTargetData.translations);
      delete localTargetData.translations;
      verboseLog(
        "After cleanup, target data keys count:",
        Object.keys(localTargetData).length,
      );
    }

    verboseLog("Extracting key-value pairs from local target data...");
    const localTargetPairs = extractKeyValuePairs(localTargetData);
    const localTargetMap = new Map(
      localTargetPairs.map((pair) => [pathToKey(pair.path), pair]),
    );
    verboseLog("Local target pairs count:", localTargetPairs.length);

    const keysToTranslate: Array<{ path: string[]; value: string }> = [];
    let updatedTargetData: NestedLocaleData = { ...localTargetData };

    verboseLog("=== COMPARISON PHASE ===");

    // 1. Handle DELETED keys: Compare local English vs remote English
    const deletedKeys: string[] = [];
    for (const [keyStr, pair] of localEnglishMap) {
      if (!liveEnglishMap.has(keyStr)) {
        deletedKeys.push(keyStr);
        if (localTargetMap.has(keyStr)) {
          removeNestedValue(updatedTargetData, pair.path);
          console.log(`  [DELETED] Removed key: "${pair.path.join(" > ")}"`);
        }
      }
    }

    // 2. Handle NEW keys: Compare remote English vs target language
    const newKeys: string[] = [];
    for (const [keyStr, pair] of liveEnglishMap) {
      if (!localTargetMap.has(keyStr)) {
        newKeys.push(keyStr);
        console.log(`  [NEW] New key detected: "${pair.path.join(" > ")}"`);
        keysToTranslate.push(pair);
      }
    }

    // 3. Handle MODIFIED keys: Compare remote English vs local English
    const modifiedKeys: string[] = [];
    for (const [keyStr, livePair] of liveEnglishMap) {
      const localPair = localEnglishMap.get(keyStr);
      if (localPair && livePair.value !== localPair.value) {
        modifiedKeys.push(keyStr);
        console.log(
          `  [MODIFIED] Source text changed for: "${livePair.path.join(
            " > ",
          )}"`,
        );
        keysToTranslate.push(livePair);
      }
    }

    // 4. Summary of changes
    const totalChanges = newKeys.length + modifiedKeys.length;

    if (deletedKeys.length > 0) {
      console.log(`  [SUMMARY] Removed ${deletedKeys.length} deleted keys`);
    }
    if (totalChanges > 0) {
      console.log(
        `  [SUMMARY] Will translate ${totalChanges} keys (${newKeys.length} new, ${modifiedKeys.length} modified)`,
      );
    } else {
      console.log(
        `  [SUMMARY] No changes detected - target language is up to date`,
      );
    }

    // 5. Get new translations from Gemini (only if there are keys to translate)
    if (keysToTranslate.length > 0) {
      // Convert to flat format for Gemini API
      const flatKeysToTranslate: FlatLocaleData = {};
      for (const pair of keysToTranslate) {
        flatKeysToTranslate[pathToKey(pair.path)] = pair.value;
      }

      const newTranslations = await getTranslationsFromGemini(
        liveEnglishData,
        localTargetData,
        flatKeysToTranslate,
        lang,
      );

      if (newTranslations) {
        // 6. Apply new translations to the target data
        // Handle both flat and nested responses from the AI
        const flattenedTranslations = flattenNestedObject(newTranslations);

        for (const [keyStr, translatedValue] of Object.entries(
          flattenedTranslations,
        )) {
          const originalPair = keysToTranslate.find(
            (p) => pathToKey(p.path) === keyStr,
          );
          if (originalPair) {
            setNestedValue(
              updatedTargetData,
              originalPair.path,
              translatedValue,
            );
          }
        }

        // 7. Write the updated target file (preserving order)
        await writeJsonFile(targetFilePath, updatedTargetData);
        console.log(`✅ Successfully updated ${targetFilePath}`);
      } else {
        console.error(
          `❌ Failed to get translations for ${lang.name} (${lang.code}). The local file will not be updated.`,
        );
      }
    } else {
      // Even if no translations needed, we might have deleted keys or need cleanup
      if (deletedKeys.length > 0 || localTargetData.translations) {
        await writeJsonFile(targetFilePath, updatedTargetData);
        console.log(
          `✅ Updated ${targetFilePath} (removed deleted keys/cleaned structure)`,
        );
      } else {
        console.log(`✅ No updates needed for ${targetFilePath}`);
      }
    }
  }

  // 9. Finally, overwrite the local English file with the live one for the next run
  await writeJsonFile(
    path.join(LOCALES_DIR, "en", "translation.json"),
    liveEnglishData,
  );
  console.log(`\n✅ Synced local English file with ${LIVE_ENGLISH_URL}`);
  console.log("Translation workflow finished.");
}

main().catch(console.error);
