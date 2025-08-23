/**
 * Slack Data Collection Module
 *
 * Provides a singleton-based data collection system for Slack notifications.
 * Similar to the existing vlog() pattern in config.ts, but collects structured data
 * for generating Slack payloads.
 */

import { SLACK_MAX_CHARACTERS, SLACK_TRUNCATE_SUFFIX } from "./config";

export interface SlackNotificationData {
  url: string;
  updatedKeys: string;
  spanishTranslation: string;
  status: string;
  summary: string;
}

export interface LanguageProcessingData {
  langCode: string;
  langName: string;
  stringsTranslated: number;
  keysDeleted: number;
  addedKeys: string[];
  modifiedKeys: string[];
  deletedKeys: string[];
  sampleTranslations: Array<{
    key: string;
    english: string;
    translated: string;
  }>;
}

export interface EnglishChangesData {
  addedKeys: string[];
  removedKeys: string[];
  modifiedKeys: string[];
  sampleStrings: Array<{ key: string; value: string }>;
}

export class SlackDataCollector {
  private static instance: SlackDataCollector;

  private languageData: Map<string, LanguageProcessingData> = new Map();
  private englishChanges: EnglishChangesData = {
    addedKeys: [],
    removedKeys: [],
    modifiedKeys: [],
    sampleStrings: [],
  };
  private errors: string[] = [];
  private commitUrl: string = "";
  private generalData: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): SlackDataCollector {
    if (!SlackDataCollector.instance) {
      SlackDataCollector.instance = new SlackDataCollector();
    }
    return SlackDataCollector.instance;
  }

  /**
   * Log general data by category
   */
  log(category: string, data: any): void {
    this.generalData.set(category, data);
  }

  /**
   * Log language-specific processing data
   */
  logLanguage(langCode: string, data: Partial<LanguageProcessingData>): void {
    const existing = this.languageData.get(langCode) || {
      langCode,
      langName: "",
      stringsTranslated: 0,
      keysDeleted: 0,
      addedKeys: [],
      modifiedKeys: [],
      deletedKeys: [],
      sampleTranslations: [],
    };

    this.languageData.set(langCode, { ...existing, ...data });
  }

  /**
   * Log an error
   */
  logError(error: string): void {
    this.errors.push(error);
  }

  /**
   * Set the commit URL
   */
  setCommitUrl(url: string): void {
    this.commitUrl = url;
  }

  /**
   * Set English changes data
   */
  setEnglishChanges(changes: EnglishChangesData): void {
    this.englishChanges = changes;
  }

  /**
   * Truncate text to character limit with suffix
   */
  private truncateText(
    text: string,
    maxLength: number = SLACK_MAX_CHARACTERS,
  ): string {
    const maxContentLength = maxLength - SLACK_TRUNCATE_SUFFIX.length;

    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxContentLength) + SLACK_TRUNCATE_SUFFIX;
  }

  /**
   * Generate the final Slack payload
   */
  generateSlackPayload(): SlackNotificationData {
    // Format updatedKeys (similar to console output)
    const languageEntries = Array.from(this.languageData.values());
    let updatedKeys = "";

    if (languageEntries.length > 0) {
      updatedKeys = languageEntries
        .map((lang) => {
          const langDisplay = `${lang.langName} (${lang.langCode})`;
          return `--- Processing ${langDisplay} ---\n[SUMMARY] ${lang.stringsTranslated} strings to translate (${lang.langCode}), ${lang.keysDeleted} keys to delete`;
        })
        .join("\n\n");
    } else {
      updatedKeys = "No languages were processed";
    }

    // Format Spanish translations (bilingual format)
    const spanishData = this.languageData.get("es");
    let spanishTranslation = "";
    if (
      spanishData?.sampleTranslations &&
      spanishData.sampleTranslations.length > 0
    ) {
      spanishTranslation = spanishData.sampleTranslations
        .map((t) => `${t.english}\n${t.translated}`)
        .join("\n\n");
    }

    // Determine status
    const totalStringsTranslated = languageEntries.reduce(
      (sum, lang) => sum + lang.stringsTranslated,
      0,
    );

    let status: string;
    if (this.errors.length > 0) {
      status = "🔴 Failed - Translation errors occurred";
    } else if (totalStringsTranslated === 0) {
      status = "⚪️ No translations were needed";
    } else {
      status = "🟢 Passed - No issues in translation";
    }

    // Generate summary
    const addedCount = this.englishChanges.addedKeys.length;
    const modifiedCount = this.englishChanges.modifiedKeys.length;
    const deletedCount = this.englishChanges.removedKeys.length;

    let summary = "";
    if (addedCount > 0 || modifiedCount > 0 || deletedCount > 0) {
      summary = `${addedCount} strings added, ${modifiedCount} modified, ${deletedCount} keys deleted in English local file`;

      // Add sample strings if available
      if (this.englishChanges.sampleStrings.length > 0) {
        const sampleText = this.englishChanges.sampleStrings
          .slice(0, 3) // Limit to 3 samples in summary
          .map((s) => `"${s.key}": "${s.value}"`)
          .join(", ");
        summary += `\n\nSample changes: ${sampleText}`;
      }
    } else {
      summary = "No changes detected in English local file";
    }

    // Add translation summary
    if (totalStringsTranslated > 0) {
      summary += `\n\nAll strings were translated in all languages`;
    } else {
      summary += `\n\nNo translations were needed`;
    }

    return {
      url: this.commitUrl,
      updatedKeys: this.truncateText(updatedKeys),
      spanishTranslation: this.truncateText(spanishTranslation),
      status,
      summary: this.truncateText(summary),
    };
  }

  /**
   * Reset all data (for testing)
   */
  reset(): void {
    this.languageData.clear();
    this.englishChanges = {
      addedKeys: [],
      removedKeys: [],
      modifiedKeys: [],
      sampleStrings: [],
    };
    this.errors = [];
    this.commitUrl = "";
    this.generalData.clear();
  }

  /**
   * Get current data for debugging/testing
   */
  getDebugData() {
    return {
      languageData: Object.fromEntries(this.languageData),
      englishChanges: this.englishChanges,
      errors: this.errors,
      commitUrl: this.commitUrl,
      generalData: Object.fromEntries(this.generalData),
    };
  }
}

// Simple logging functions (similar to vlog pattern)
export function slackLog(category: string, data: any): void {
  SlackDataCollector.getInstance().log(category, data);
}

export function slackLogLanguage(
  langCode: string,
  data: Partial<LanguageProcessingData>,
): void {
  SlackDataCollector.getInstance().logLanguage(langCode, data);
}

export function slackLogError(error: string): void {
  SlackDataCollector.getInstance().logError(error);
}

export function slackSetCommitUrl(url: string): void {
  SlackDataCollector.getInstance().setCommitUrl(url);
}

export function slackSetEnglishChanges(changes: EnglishChangesData): void {
  SlackDataCollector.getInstance().setEnglishChanges(changes);
}

export function slackGeneratePayload(): SlackNotificationData {
  return SlackDataCollector.getInstance().generateSlackPayload();
}

export function slackReset(): void {
  SlackDataCollector.getInstance().reset();
}
