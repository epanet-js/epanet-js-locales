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
  IS_GITHUB_ACTIONS,
  SLACK_OUTPUT_FILE,
} from "./translate/config";
import { readJson, writeJsonAtomic, JSONObject } from "./translate/fs-utils";
import { translateValues } from "./translate/llm";
import { diffKeys, diffEnglishChanges } from "./translate/diff";
import { deleteAtPath, setAtPath } from "./translate/walkers";
import {
  slackLog,
  slackLogLanguage,
  slackLogError,
  slackSetCommitUrl,
  slackSetEnglishChanges,
  slackGeneratePayload,
  slackReset,
} from "./translate/slack-data";

export async function run(languageCode?: string) {
  console.log("Starting translation workflow...");

  // Initialize Slack data collection
  slackReset();

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

  // Detect English changes for Slack notifications
  const englishChanges = diffEnglishChanges(liveEN, localEN);
  slackSetEnglishChanges({
    addedKeys: englishChanges.addedKeys.map((p) => p.join(".")),
    removedKeys: englishChanges.removedKeys.map((p) => p.join(".")),
    modifiedKeys: englishChanges.modifiedKeys.map((p) => p.join(".")),
    sampleStrings: [],
    //sampleStrings: [
    //  ...englishChanges.addedValues.slice(0, 3).map((value, i) => ({
    //    key: englishChanges.addedKeys[i].join("."),
    //    value,
    //  })),
    //  ...englishChanges.modifiedValues.slice(0, 2).map((mod) => ({
    //    key: mod.key.join("."),
    //    value: mod.newValue,
    //  })),
    //].slice(0, 5), // Limit to 5 sample strings
  });

  // Set commit URL for Slack notifications
  const commitUrl =
    IS_GITHUB_ACTIONS && process.env.GITHUB_SHA && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${
          process.env.GITHUB_REPOSITORY
        }/commit/${process.env.GITHUB_SHA}`
      : LIVE_ENGLISH_URL; // Fallback to live EN URL for local development
  slackSetCommitUrl(commitUrl);

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

  let hasErrors = false;
  let errorMessage = "";

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

      // Collect language processing data for Slack
      slackLogLanguage(lang.code, {
        langCode: lang.code,
        langName: lang.name,
        stringsTranslated: toTranslateValues.length,
        keysDeleted: deleted.length,
        addedKeys: toTranslatePaths.map((p) => p.join(".")),
        deletedKeys: deleted.map((p) => p.join(".")),
      });

      try {
        const translatedValues =
          toTranslateValues.length > 0
            ? await translateValues(toTranslateValues, lang, liveEN, targetJson)
            : [];

        const updated = JSON.parse(JSON.stringify(targetJson)) as JSONObject;

        for (const p of deleted) deleteAtPath(updated, p);
        for (let i = 0; i < toTranslatePaths.length; i++) {
          setAtPath(updated, toTranslatePaths[i], translatedValues[i]);
        }

        // Collect sample translations for Slack (Spanish only)
        if (lang.code === "es" && toTranslateValues.length > 0) {
          const sampleTranslations = toTranslateValues.map((original, i) => ({
            key: toTranslatePaths[i].join("."),
            english: original,
            translated: translatedValues[i],
          }));
          slackLogLanguage(lang.code, { sampleTranslations });
        }

        proposed.push({
          langCode: lang.code,
          filePath: targetPath,
          data: updated,
        });
      } catch (translationError: any) {
        hasErrors = true;
        errorMessage = translationError?.message || String(translationError);
        console.error(`❌ Translation failed for ${lang.code}:`, errorMessage);

        // Log error for Slack notifications
        slackLogError(`Translation failed for ${lang.code}: ${errorMessage}`);

        // Continue with other languages instead of aborting
        continue;
      }
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

    if (hasErrors) {
      console.log("\n⚠️  Translation workflow completed with errors.");
    } else {
      console.log("\n✅ Translation workflow finished successfully.");
    }

    // Generate and write Slack payload if in GitHub Actions
    if (IS_GITHUB_ACTIONS) {
      const payload = slackGeneratePayload();
      await writeJsonAtomic(SLACK_OUTPUT_FILE, payload);
      console.log(`📤 Slack payload written to ${SLACK_OUTPUT_FILE}`);
    }

    // Set exit code if there were errors
    if (hasErrors) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    console.error("\n❌ Aborting — a failure occurred. No files were written.");
    console.error(err?.stack || err?.message || String(err));

    // Log error for Slack notifications
    slackLogError(err?.message || String(err));

    // Generate and write Slack payload even on error if in GitHub Actions
    if (IS_GITHUB_ACTIONS) {
      try {
        const payload = slackGeneratePayload();
        await writeJsonAtomic(SLACK_OUTPUT_FILE, payload);
        console.log(
          `📤 Slack payload written to ${SLACK_OUTPUT_FILE} (error state)`,
        );
      } catch (payloadError) {
        console.error("Failed to write Slack payload:", payloadError);
      }
    }

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
