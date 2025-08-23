import { describe, it, expect } from "vitest";

describe("Slack Configuration", () => {
  it("should have correct character limit constants", async () => {
    const { SLACK_MAX_CHARACTERS, SLACK_TRUNCATE_SUFFIX } = await import(
      "../config"
    );
    expect(SLACK_MAX_CHARACTERS).toBe(3000);
    expect(SLACK_TRUNCATE_SUFFIX).toBe(
      "... Review the commit for full details",
    );
  });

  it("should have GitHub Actions detection constant", async () => {
    const { IS_GITHUB_ACTIONS } = await import("../config");
    expect(typeof IS_GITHUB_ACTIONS).toBe("boolean");
  });

  it("should have Slack output file constant", async () => {
    const { SLACK_OUTPUT_FILE } = await import("../config");
    expect(typeof SLACK_OUTPUT_FILE).toBe("string");
    expect(SLACK_OUTPUT_FILE).toBe("slack-payload.json");
  });

  it("should not break existing configuration", async () => {
    const config = await import("../config");

    // Verify existing constants are still available
    expect(config.API_KEY).toBeDefined();
    expect(config.LIVE_ENGLISH_URL).toBeDefined();
    expect(config.LOCALES_DIR).toBeDefined();
    expect(config.DEFAULT_NS).toBeDefined();
    expect(config.TARGET_LANGUAGES).toBeDefined();
    expect(config.VERBOSE).toBeDefined();
    expect(config.DRY_RUN).toBeDefined();
    expect(config.CHUNK_SIZE).toBeDefined();
    expect(config.MAX_RETRIES).toBeDefined();
    expect(config.RETRY_BASE_MS).toBeDefined();
    expect(config.vlog).toBeDefined();
  });

  it("should export all new Slack constants", async () => {
    const config = await import("../config");

    // Verify new Slack constants are available
    expect(config.IS_GITHUB_ACTIONS).toBeDefined();
    expect(config.SLACK_OUTPUT_FILE).toBeDefined();
    expect(config.SLACK_MAX_CHARACTERS).toBeDefined();
    expect(config.SLACK_TRUNCATE_SUFFIX).toBeDefined();
  });
});
