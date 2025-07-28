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
const TARGET_LANGUAGES = ["fr"];

// --- Type Definitions ---
type LocaleValue = string | { [key: string]: LocaleValue };
type NestedLocaleData = { [key: string]: LocaleValue };
type FlatLocaleData = { [key: string]: string };

// --- Gemini API Setup for Structured Output ---
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash-latest",
});

const translationTool: FunctionDeclarationsTool = {
  functionDeclarations: [
    {
      name: "save_translations",
      description: "Saves translated strings for a given language.",
      parameters: {
        type: SchemaType.OBJECT,
        description:
          "An object where keys are the original English keys and values are the translated strings.",
        properties: {},
        required: [],
      },
    },
  ],
};

/**
 * Flattens a nested object into a single level with dot notation.
 * e.g., { a: { b: 'c' } } => { 'a.b': 'c' }
 */
function flattenObject(obj: NestedLocaleData, prefix = ""): FlatLocaleData {
  return Object.keys(obj).reduce((acc, k) => {
    const pre = prefix.length ? prefix + "." : "";
    if (
      typeof obj[k] === "object" &&
      obj[k] !== null &&
      !Array.isArray(obj[k])
    ) {
      Object.assign(acc, flattenObject(obj[k] as NestedLocaleData, pre + k));
    } else {
      acc[pre + k] = String(obj[k]);
    }
    return acc;
  }, {} as FlatLocaleData);
}

/**
 * Unflattens an object with dot notation back into a nested object.
 * e.g., { 'a.b': 'c' } => { a: { b: 'c' } }
 */
function unflattenObject(data: FlatLocaleData): NestedLocaleData {
  const result: NestedLocaleData = {};
  for (const key in data) {
    const keys = key.split(".");
    keys.reduce((acc, part, index) => {
      if (index === keys.length - 1) {
        acc[part] = data[key];
      } else {
        acc[part] = acc[part] || {};
      }
      return acc[part] as NestedLocaleData;
    }, result);
  }
  return result;
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
  // Sort top-level keys for consistency
  const sortedData = Object.keys(data)
    .sort()
    .reduce((obj, key) => {
      obj[key] = data[key];
      return obj;
    }, {} as NestedLocaleData);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(sortedData, null, 2), "utf-8");
}

async function getTranslationsFromGemini(
  keysToTranslate: FlatLocaleData,
  langName: string,
): Promise<FlatLocaleData | null> {
  if (Object.keys(keysToTranslate).length === 0) {
    return {};
  }

  const prompt = `
        You are an expert UI translator. Translate the following JSON values from English to ${langName}.
        The keys use dot notation to represent nesting.
        Maintain the original meaning, tone, and style.
        Placeholders like {{variable}} or {{1}} must be preserved exactly.
        
        JSON with strings to translate:
        ${JSON.stringify(keysToTranslate, null, 2)}
    `;

  console.log(
    `Requesting translation for ${
      Object.keys(keysToTranslate).length
    } keys for ${langName}...`,
  );

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [translationTool],
    });

    const call = result.response.functionCalls()?.[0];
    if (call && call.name === "save_translations") {
      return call.args as FlatLocaleData;
    } else {
      console.error("Gemini did not return the expected function call.");
      return null;
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return null;
  }
}

// --- Main Execution Logic (Updated to use flatten/unflatten) ---
async function main() {
  console.log("Starting translation workflow...");

  // 1. Fetch live English data and read local files
  const { data: liveEnglishData } = await axios.get<NestedLocaleData>(
    LIVE_ENGLISH_URL,
  );
  const localEnglishData = await readJsonFile(
    path.join(LOCALES_DIR, "en", "translation.json"),
  );

  // FLATTEN all data for comparison
  const flatLiveEnglishData = flattenObject(liveEnglishData);
  const flatLocalEnglishData = flattenObject(localEnglishData);

  for (const lang of TARGET_LANGUAGES) {
    console.log(`\n--- Processing language: ${lang.toUpperCase()} ---`);
    const targetFilePath = path.join(LOCALES_DIR, lang, "translation.json");
    const localTargetData = await readJsonFile(targetFilePath);
    const flatLocalTargetData = flattenObject(localTargetData);

    const keysToTranslate: FlatLocaleData = {};
    let finalFlatTargetData: FlatLocaleData = {};

    const allLiveKeys = new Set(Object.keys(flatLiveEnglishData));

    // 2. Compare and determine changes using flattened data
    for (const key of allLiveKeys) {
      const liveEnValue = flatLiveEnglishData[key];
      const localEnValue = flatLocalEnglishData[key];
      const localTargetValue = flatLocalTargetData[key];

      if (localTargetValue === undefined) {
        console.log(`  [ADDED] New key detected: "${key}"`);
        keysToTranslate[key] = liveEnValue;
      } else if (localEnValue !== undefined && liveEnValue !== localEnValue) {
        console.log(`  [MODIFIED] Source text changed for: "${key}"`);
        keysToTranslate[key] = liveEnValue;
      } else {
        finalFlatTargetData[key] = localTargetValue;
      }
    }

    const deletedKeys = Object.keys(flatLocalTargetData).filter(
      (k) => !allLiveKeys.has(k),
    );
    if (deletedKeys.length > 0) {
      console.log(`  [DELETED] Removing ${deletedKeys.length} keys.`);
    }

    // 3. Get new translations from Gemini
    const newTranslations = await getTranslationsFromGemini(
      keysToTranslate,
      lang,
    );

    if (newTranslations) {
      // 4. Merge new translations into the final flat data
      Object.assign(finalFlatTargetData, newTranslations);

      // 5. UNFLATTEN the data back to its nested structure
      const finalNestedTargetData = unflattenObject(finalFlatTargetData);

      // 6. Write the updated, nested target file
      await writeJsonFile(targetFilePath, finalNestedTargetData);
      console.log(`✅ Successfully updated ${targetFilePath}`);
    } else {
      console.error(
        `❌ Failed to get translations for ${lang}. The local file will not be updated.`,
      );
    }
  }

  // 7. Finally, overwrite the local English file with the live one for the next run
  await writeJsonFile(
    path.join(LOCALES_DIR, "en", "translation.json"),
    liveEnglishData,
  );
  console.log(`\n✅ Synced local English file with ${LIVE_ENGLISH_URL}`);
  console.log("Translation workflow finished.");
}

main().catch(console.error);
