/**
 * Orchestrates the full translation workflow:
 * - init i18next
 * - fetch live EN, read local EN
 * - per-language: diff, translate via array-in/out, validate
 * - all-or-nothing atomic write for every language + sync local EN
 */

import path from "path";
import { initI18n } from "./translate/i18n";
import {
  DRY_RUN,
  LIVE_ENGLISH_URL,
  LOCALES_DIR,
  DEFAULT_NS,
  TARGET_LANGUAGES,
} from "./translate/config";
import { readJson, writeJsonAtomic, JSONObject } from "./translate/fs-utils";
import { translateValues } from "./translate/llm";
import { diffKeys } from "./translate/diff";
import { deleteAtPath, setAtPath } from "./translate/walkers";

export async function run(languageCode?: string) {
  console.log("Starting translation workflow...");

  await initI18n();

  // 1) Fetch live EN & load local EN
  const response = await fetch(LIVE_ENGLISH_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch live EN: ${response.status} ${response.statusText}`,
    );
  }
  const liveEN = (await response.json()) as JSONObject;
  const localENPath = path.join(LOCALES_DIR, "en", `${DEFAULT_NS}.json`);
  const localEN = await readJson(localENPath);

  // Filter languages based on languageCode parameter
  const languagesToProcess = languageCode
    ? TARGET_LANGUAGES.filter((lang) => lang.code === languageCode)
    : TARGET_LANGUAGES;

  if (languageCode && languagesToProcess.length === 0) {
    throw new Error(
      `Language code '${languageCode}' not found. Available languages: ${TARGET_LANGUAGES.map(
        (l) => l.code,
      ).join(", ")}`,
    );
  }

  const proposed: { langCode: string; filePath: string; data: JSONObject }[] =
    [];

  try {
    for (const lang of languagesToProcess) {
      console.log(`\n--- Processing ${lang.name} (${lang.code}) ---`);

      const targetPath = path.join(
        LOCALES_DIR,
        lang.code,
        `${DEFAULT_NS}.json`,
      );
      const targetJson = await readJson(targetPath);

      const { deleted, toTranslatePaths, toTranslateValues } = diffKeys(
        liveEN,
        localEN,
        targetJson,
      );

      console.log(
        `[SUMMARY] ${toTranslateValues.length} strings to translate (${lang.code}), ${deleted.length} keys to delete`,
      );

      const translatedValues =
        toTranslateValues.length > 0
          ? await translateValues(toTranslateValues, lang, liveEN, targetJson)
          : [];

      const updated = JSON.parse(JSON.stringify(targetJson)) as JSONObject;

      for (const p of deleted) deleteAtPath(updated, p);
      for (let i = 0; i < toTranslatePaths.length; i++) {
        setAtPath(updated, toTranslatePaths[i], translatedValues[i]);
      }

      proposed.push({
        langCode: lang.code,
        filePath: targetPath,
        data: updated,
      });
    }

    if (DRY_RUN) {
      console.log(
        `\n[DRY_RUN] ${languagesToProcess.length} language(s) processed successfully. No files written.`,
      );
    } else {
      for (const p of proposed) {
        await writeJsonAtomic(p.filePath, p.data);
        console.log(`✅ Wrote ${p.langCode}/${DEFAULT_NS}.json`);
      }
      // Only sync local EN if processing all languages
      if (!languageCode) {
        await writeJsonAtomic(localENPath, liveEN);
        console.log(`✅ Synced local EN to ${LIVE_ENGLISH_URL}`);
      }
    }

    console.log("\nTranslation workflow finished successfully.");
  } catch (err: any) {
    console.error("\n❌ Aborting — a failure occurred. No files were written.");
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
    throw err; // rethrow so tests can assert failure
  }
}

// Auto-run only when invoked directly (not when imported in tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const languageCode = process.argv[2];
  run(languageCode).catch((e) => {
    console.error("Unhandled error:", e);
    process.exitCode = 1;
  });
}

export default run;
