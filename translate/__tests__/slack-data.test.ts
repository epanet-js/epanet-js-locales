import { describe, it, expect, beforeEach } from "vitest";
import {
  SlackDataCollector,
  slackLog,
  slackLogLanguage,
  slackLogError,
  slackSetCommitUrl,
  slackGeneratePayload,
  slackReset,
  slackSetEnglishChanges,
} from "../slack-data";

describe("SlackDataCollector", () => {
  beforeEach(() => {
    slackReset();
  });

  describe("generateSlackPayload", () => {
    it("should generate payload with correct format for successful translation", () => {
      // Set up test data
      slackSetCommitUrl(
        "https://github.com/epanet-js/epanet-js-locales/commit/test123",
      );

      // Add language data
      slackLogLanguage("es", {
        langCode: "es",
        langName: "Español (ES)",
        stringsTranslated: 3,
        keysDeleted: 1,
        addedKeys: ["new.key1", "new.key2"],
        deletedKeys: ["old.key1"],
        sampleTranslations: [
          {
            key: "connect",
            english: "Connect",
            translated: "Conectar",
          },
          {
            key: "customer.point",
            english: "{{1}} customer point",
            translated: "{{1}} punto de consumo",
          },
        ],
      });

      slackLogLanguage("pt", {
        langCode: "pt",
        langName: "Português (BR)",
        stringsTranslated: 2,
        keysDeleted: 0,
        addedKeys: ["new.key1", "new.key2"],
        deletedKeys: [],
      });

      const payload = slackGeneratePayload();

      // Verify structure
      expect(payload).toHaveProperty("url");
      expect(payload).toHaveProperty("updatedKeys");
      expect(payload).toHaveProperty("spanishTranslation");
      expect(payload).toHaveProperty("status");
      expect(payload).toHaveProperty("summary");

      // Verify content
      expect(payload.url).toBe(
        "https://github.com/epanet-js/epanet-js-locales/commit/test123",
      );
      expect(payload.status).toBe("🟢 Passed - No issues in translation");

      // Verify updatedKeys format
      expect(payload.updatedKeys).toContain(
        "--- Processing Español (ES) (es) ---",
      );
      expect(payload.updatedKeys).toContain(
        "[SUMMARY] 3 strings to translate (es), 1 keys to delete",
      );
      expect(payload.updatedKeys).toContain(
        "--- Processing Português (BR) (pt) ---",
      );
      expect(payload.updatedKeys).toContain(
        "[SUMMARY] 2 strings to translate (pt), 0 keys to delete",
      );

      // Verify Spanish translation format
      expect(payload.spanishTranslation).toBe(
        "Connect\nConectar\n\n{{1}} customer point\n{{1}} punto de consumo",
      );

      // Verify summary
      expect(payload.summary).toContain(
        "All strings were translated in all languages",
      );
    });

    it("should handle error status correctly", () => {
      slackSetCommitUrl("https://github.com/test/commit");
      slackLogError("Translation API failed");

      const payload = slackGeneratePayload();

      expect(payload.status).toBe("🔴 Failed - Translation errors occurred");
    });

    it("should handle no translations needed", () => {
      slackSetCommitUrl("https://github.com/test/commit");
      slackLogLanguage("es", {
        langCode: "es",
        langName: "Español (ES)",
        stringsTranslated: 0,
        keysDeleted: 0,
      });

      const payload = slackGeneratePayload();

      expect(payload.status).toBe("🟡 Warning - No translations were needed");
      expect(payload.summary).toContain("No translations were needed");
    });

    it("should handle empty data gracefully", () => {
      const payload = slackGeneratePayload();

      expect(payload.url).toBe("");
      expect(payload.updatedKeys).toBe("No languages were processed");
      expect(payload.spanishTranslation).toBe("");
      expect(payload.status).toBe("🟡 Warning - No translations were needed");
      expect(payload.summary).toContain(
        "No changes detected in English local file",
      );
    });

    it("should truncate long text fields", () => {
      slackSetCommitUrl("https://github.com/test/commit");

      // Create a very long string
      const longString = "A".repeat(4000);
      slackLogLanguage("es", {
        langCode: "es",
        langName: "Español (ES)",
        stringsTranslated: 1,
        keysDeleted: 0,
        sampleTranslations: [
          {
            key: "test",
            english: longString,
            translated: longString,
          },
        ],
      });

      const payload = slackGeneratePayload();

      // Check that the spanishTranslation is truncated
      expect(payload.spanishTranslation.length).toBeLessThanOrEqual(3000);
      expect(payload.spanishTranslation).toContain(
        "... Review the commit for full details",
      );
    });
  });

  describe("singleton pattern", () => {
    it("should return the same instance", () => {
      const instance1 = SlackDataCollector.getInstance();
      const instance2 = SlackDataCollector.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("data collection", () => {
    it("should collect language data correctly", () => {
      slackLogLanguage("es", {
        langCode: "es",
        langName: "Español (ES)",
        stringsTranslated: 5,
        keysDeleted: 2,
      });

      slackLogLanguage("es", {
        sampleTranslations: [
          {
            key: "test",
            english: "Test",
            translated: "Prueba",
          },
        ],
      });

      const payload = slackGeneratePayload();

      expect(payload.updatedKeys).toContain(
        "5 strings to translate (es), 2 keys to delete",
      );
      expect(payload.spanishTranslation).toBe("Test\nPrueba");
    });

    it("should collect errors correctly", () => {
      slackLogError("Error 1");
      slackLogError("Error 2");

      const collector = SlackDataCollector.getInstance();
      const debugData = collector.getDebugData();

      expect(debugData.errors).toContain("Error 1");
      expect(debugData.errors).toContain("Error 2");
    });

    it("should handle English changes in summary", () => {
      slackSetCommitUrl("https://github.com/test/commit");

      // Set English changes
      slackSetEnglishChanges({
        addedKeys: ["new.key1", "new.key2"],
        removedKeys: ["old.key1"],
        modifiedKeys: ["modified.key1"],
        sampleStrings: [
          { key: "new.key1", value: "New Value 1" },
          { key: "new.key2", value: "New Value 2" },
          { key: "modified.key1", value: "Modified Value" },
        ],
      });

      // Add some language data
      slackLogLanguage("es", {
        langCode: "es",
        langName: "Español (ES)",
        stringsTranslated: 3,
        keysDeleted: 1,
      });

      const payload = slackGeneratePayload();

      expect(payload.summary).toContain(
        "2 strings added, 1 modified, 1 keys deleted in English local file",
      );
      expect(payload.summary).toContain(
        'Sample changes: "new.key1": "New Value 1", "new.key2": "New Value 2", "modified.key1": "Modified Value"',
      );
      expect(payload.summary).toContain(
        "All strings were translated in all languages",
      );
    });

    it("should handle no English changes gracefully", () => {
      slackSetCommitUrl("https://github.com/test/commit");

      // Set empty English changes
      slackSetEnglishChanges({
        addedKeys: [],
        removedKeys: [],
        modifiedKeys: [],
        sampleStrings: [],
      });

      const payload = slackGeneratePayload();

      expect(payload.summary).toContain(
        "No changes detected in English local file",
      );
      expect(payload.summary).toContain("No translations were needed");
    });
  });
});
