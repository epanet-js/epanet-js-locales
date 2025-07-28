import { promises as fs } from "fs";
import path from "path";
import axios from "axios";
import {
  GoogleGenerativeAI,
  FunctionDeclarationTool,
  Part,
  GenerationConfig,
} from "@google/generative-ai";

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error("GEMINI_API_KEY environment variable not set.");

const LIVE_ENGLISH_URL = "https://app.epanetjs.com/locales/en/translation.json";
const LOCALES_DIR = path.join(process.cwd(), "locales");
const TARGET_LANGUAGES = ["fr"]; //  target languages

// --- Type Definitions ---
type LocaleData = { [key: string]: string };

// --- Gemini API Setup for Structured Output ---
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash-latest",
});

const translationTool: FunctionDeclarationTool = {
  functionDeclarations: [
    {
      name: "save_translations",
      description: "Saves translated strings for a given language.",
      parameters: {
        type: "OBJECT",
        description:
          "An object where keys are the original English keys and values are the translated strings.",
        properties: {}, // We leave this empty to allow any string key
        required: [],
      },
    },
  ],
};

// --- Helper Functions ---
async function readJsonFile(filePath: string): Promise<LocaleData> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    // If the file doesn't exist, it's the same as an empty object
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, data: LocaleData) {
  const sortedData = Object.keys(data)
    .sort()
    .reduce((obj, key) => {
      obj[key] = data[key];
      return obj;
    }, {} as LocaleData);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(sortedData, null, 2), "utf-8");
}

async function getTranslationsFromGemini(
  keysToTranslate: LocaleData,
  langName: string,
): Promise<LocaleData | null> {
  if (Object.keys(keysToTranslate).length === 0) {
    return {};
  }

  const prompt = `
        You are an expert UI translator. Translate the following JSON values from English to ${langName}.
        Maintain the original meaning, tone, and style.
        Placeholders like {{variable}} or %s must be preserved exactly.
        
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
      toolConfig: {
        functionCallingConfig: { mode: "ONE_CALL", name: "save_translations" },
      },
    });

    const call = result.response.functionCalls()?.[0];

    if (call && call.name === "save_translations") {
      return call.args as LocaleData;
    } else {
      console.error("Gemini did not return the expected function call.");
      console.error("Full Response:", JSON.stringify(result.response, null, 2));
      return null;
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return null;
  }
}

// --- Main Execution Logic ---
async function main() {
  console.log("Starting translation workflow...");

  // 1. Fetch live English data and read local files
  const { data: liveEnglishData } = await axios.get<LocaleData>(
    LIVE_ENGLISH_URL,
  );
  const localEnglishData = await readJsonFile(
    path.join(LOCALES_DIR, "en", "translation.json"),
  );

  for (const lang of TARGET_LANGUAGES) {
    console.log(`\n--- Processing language: ${lang.toUpperCase()} ---`);
    const targetFilePath = path.join(LOCALES_DIR, lang, "translation.json");
    const localTargetData = await readJsonFile(targetFilePath);

    const keysToTranslate: LocaleData = {};
    const finalTargetData: LocaleData = {};

    const allEnglishKeys = new Set(Object.keys(liveEnglishData));

    // 2. Compare and determine changes
    for (const key of allEnglishKeys) {
      const liveEnValue = liveEnglishData[key];
      const localEnValue = localEnglishData[key];
      const localTargetValue = localTargetData[key];

      if (localTargetValue === undefined) {
        console.log(`  [ADDED] New key detected: "${key}"`);
        keysToTranslate[key] = liveEnValue;
      } else if (localEnValue !== undefined && liveEnValue !== localEnValue) {
        console.log(`  [MODIFIED] Source text changed for: "${key}"`);
        keysToTranslate[key] = liveEnValue;
      } else {
        // Unchanged, keep existing translation
        finalTargetData[key] = localTargetValue;
      }
    }

    // Identify deleted keys
    const deletedKeys = Object.keys(localTargetData).filter(
      (k) => !allEnglishKeys.has(k),
    );
    if (deletedKeys.length > 0) {
      console.log(
        `  [DELETED] Removing ${deletedKeys.length} keys: ${deletedKeys.join(
          ", ",
        )}`,
      );
    }

    // 3. Get new translations from Gemini
    const newTranslations = await getTranslationsFromGemini(
      keysToTranslate,
      lang,
    );

    if (newTranslations) {
      // 4. Merge new translations into the final data
      Object.assign(finalTargetData, newTranslations);

      // 5. Write the updated target file
      await writeJsonFile(targetFilePath, finalTargetData);
      console.log(`✅ Successfully updated ${targetFilePath}`);
    } else {
      console.error(
        `❌ Failed to get translations for ${lang}. The local file will not be updated.`,
      );
    }
  }

  // 6. Finally, overwrite the local English file with the live one for the next run
  await writeJsonFile(
    path.join(LOCALES_DIR, "en", "translation.json"),
    liveEnglishData,
  );
  console.log(`\n✅ Synced local English file with ${LIVE_ENGLISH_URL}`);
  console.log("Translation workflow finished.");
}

main().catch(console.error);
