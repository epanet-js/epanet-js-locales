/**
 * Orchestrates the full translation workflow across one or more sources:
 * - init i18next
 * - per source: fetch live EN, read local EN, per-language diff/translate/validate,
 *   then all-or-nothing atomic write for that source + sync its local EN
 * Each source writes only its own namespace file (e.g. translation.json,
 * model-build.json), so sources never affect each other's output.
 */

import path from "path";
import { initI18n } from "./translate/i18n";
import {
  DRY_RUN,
  LIVE_ENGLISH_URL,
  LOCALES_DIR,
  DEFAULT_NS,
  TARGET_LANGUAGES,
  TRANSLATION_SOURCES,
  type TranslationSource,
  IS_GITHUB_ACTIONS,
  SLACK_OUTPUT_FILE,
} from "./translate/config";
import { readJson, writeJsonAtomic, JSONObject } from "./translate/fs-utils";
import { translateValues } from "./translate/llm";
import { diffKeys, diffEnglishChanges } from "./translate/diff";
import { deleteAtPath, setAtPath } from "./translate/walkers";
import {
  slackLogLanguage,
  slackLogError,
  slackSetCommitUrl,
  slackSetEnglishChanges,
  slackGeneratePayload,
  slackReset,
} from "./translate/slack-data";

// Translate a single source into locales/{lng}/{source.namespace}.json.
// Returns true if any language failed (matching the prior per-language behavior).
async function processSource(
  source: TranslationSource,
  languageCode?: string,
): Promise<boolean> {
  console.log(`\n=== Source: ${source.name} (${source.namespace}) ===`);

  // 1) Fetch live EN & load local EN (per source namespace)
  const response = await fetch(source.liveUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch live EN for ${source.name}: ${response.status} ${response.statusText}`,
    );
  }
  const liveEN = (await response.json()) as JSONObject;
  const localENPath = path.join(LOCALES_DIR, "en", `${source.namespace}.json`);
  const localEN = await readJson(localENPath);

  // Detect English changes for Slack notifications (collector accumulates per source)
  const englishChanges = diffEnglishChanges(liveEN, localEN);
  slackSetEnglishChanges({
    addedKeys: englishChanges.addedKeys.map((p) => p.join(".")),
    removedKeys: englishChanges.removedKeys.map((p) => p.join(".")),
    modifiedKeys: englishChanges.modifiedKeys.map((p) => p.join(".")),
    sampleStrings: [],
  });

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

  // Non-default sources (model-build) reuse the app's existing translations as a
  // terminology glossary so shared terms match the app. Read-only — never written.
  const usesAppGlossary = source.namespace !== DEFAULT_NS;

  const proposed: { langCode: string; filePath: string; data: JSONObject }[] =
    [];
  let hasErrors = false;

  for (const lang of languagesToProcess) {
    console.log(`\n--- Processing ${lang.name} (${lang.code}) ---`);

    const targetPath = path.join(
      LOCALES_DIR,
      lang.code,
      `${source.namespace}.json`,
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

    slackLogLanguage(lang.code, {
      langCode: lang.code,
      langName: lang.name,
      stringsTranslated: toTranslateValues.length,
      keysDeleted: deleted.length,
      addedKeys: toTranslatePaths.map((p) => p.join(".")),
      deletedKeys: deleted.map((p) => p.join(".")),
    });

    try {
      const glossary = usesAppGlossary
        ? await readJson(
            path.join(LOCALES_DIR, lang.code, `${DEFAULT_NS}.json`),
          )
        : undefined;

      const translatedValues =
        toTranslateValues.length > 0
          ? await translateValues(
              toTranslateValues,
              lang,
              liveEN,
              targetJson,
              glossary,
            )
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
      const errorMessage =
        translationError?.message || String(translationError);
      console.error(`❌ Translation failed for ${lang.code}:`, errorMessage);
      slackLogError(
        `Translation failed for ${lang.code} (${source.namespace}): ${errorMessage}`,
      );
      // Continue with other languages instead of aborting
      continue;
    }
  }

  if (DRY_RUN) {
    console.log(
      `\n[DRY_RUN] ${source.name}: ${languagesToProcess.length} language(s) processed. No files written.`,
    );
  } else {
    for (const p of proposed) {
      await writeJsonAtomic(p.filePath, p.data);
      console.log(`✅ Wrote ${p.langCode}/${source.namespace}.json`);
    }
    // Only sync local EN if processing all languages
    if (!languageCode) {
      await writeJsonAtomic(localENPath, liveEN);
      console.log(`✅ Synced local EN to ${source.liveUrl}`);
    }
  }

  return hasErrors;
}

export async function run(languageCode?: string) {
  console.log("Starting translation workflow...");

  // Initialize Slack data collection
  slackReset();

  await initI18n();

  // Set commit URL for Slack notifications (shared across sources)
  const commitUrl =
    IS_GITHUB_ACTIONS && process.env.GITHUB_SHA && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${
          process.env.GITHUB_REPOSITORY
        }/commit/${process.env.GITHUB_SHA}`
      : LIVE_ENGLISH_URL; // Fallback to live EN URL for local development
  slackSetCommitUrl(commitUrl);

  let hasErrors = false;

  try {
    for (const source of TRANSLATION_SOURCES) {
      const sourceHadErrors = await processSource(source, languageCode);
      hasErrors = hasErrors || sourceHadErrors;
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
