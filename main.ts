/**
 * Orchestrates the full translation workflow:
 * - init i18next
 * - fetch live EN, read local EN
 * - per-language: diff, translate via array-in/out, validate
 * - all-or-nothing atomic write for every language + sync local EN
 */

import path from "path";
import axios from "axios";
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

async function main() {
  console.log("Starting translation workflow...");

  await initI18n();

  // 1) Fetch live EN & load local EN
  const { data: liveEN } = await axios.get<JSONObject>(LIVE_ENGLISH_URL);
  const localENPath = path.join(LOCALES_DIR, "en", `${DEFAULT_NS}.json`);
  const localEN = await readJson(localENPath);

  // Stash proposed writes in memory. If anything fails, write nothing.
  const proposed: { langCode: string; filePath: string; data: JSONObject }[] =
    [];

  try {
    for (const lang of TARGET_LANGUAGES) {
      console.log(`\n--- Processing ${lang.name} (${lang.code}) ---`);

      const targetPath = path.join(
        LOCALES_DIR,
        lang.code,
        `${DEFAULT_NS}.json`,
      );
      const targetJson = await readJson(targetPath);

      // 2) Diff keys
      const { deleted, toTranslatePaths, toTranslateValues } = diffKeys(
        liveEN,
        localEN,
        targetJson,
      );

      console.log(
        `[SUMMARY] ${toTranslateValues.length} strings to translate (${lang.code}), ${deleted.length} keys to delete`,
      );

      // 3) Translate (array-in / array-out)
      const translatedValues =
        toTranslateValues.length > 0
          ? await translateValues(toTranslateValues, lang, liveEN, targetJson)
          : [];

      // 4) Build updated target in memory
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

    // If we reached here, all languages succeeded
    if (DRY_RUN) {
      console.log(
        "\n[DRY_RUN] All languages processed successfully. No files written.",
      );
    } else {
      for (const p of proposed) {
        await writeJsonAtomic(p.filePath, p.data);
        console.log(`✅ Wrote ${p.langCode}/${DEFAULT_NS}.json`);
      }
      await writeJsonAtomic(localENPath, liveEN);
      console.log(`✅ Synced local EN to ${LIVE_ENGLISH_URL}`);
    }

    console.log("\nTranslation workflow finished successfully.");
  } catch (err: any) {
    console.error("\n❌ Aborting — a failure occurred. No files were written.");
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exitCode = 1;
});
