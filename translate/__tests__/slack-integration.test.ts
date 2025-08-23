import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Slack data collection to capture calls
vi.mock("../slack-data", () => {
  const mockSlackFunctions = {
    slackLog: vi.fn(),
    slackLogLanguage: vi.fn(),
    slackLogError: vi.fn(),
    slackSetCommitUrl: vi.fn(),
    slackSetEnglishChanges: vi.fn(),
    slackGeneratePayload: vi.fn(() => ({
      url: "test-url",
      updatedKeys: "test-keys",
      spanishTranslation: "test-translation",
      status: "test-status",
      summary: "test-summary",
    })),
    slackReset: vi.fn(),
  };

  // Expose the mock functions globally for testing
  (globalThis as any).__mockSlackFunctions = mockSlackFunctions;

  return mockSlackFunctions;
});

import { run } from "../../main";

// Mock other dependencies
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    constructor() {}
    getGenerativeModel() {
      return {
        generateContent: vi.fn().mockResolvedValue({
          response: { text: () => JSON.stringify(["translated"]) },
        }),
      };
    }
  },
}));

vi.mock("../fs-utils", () => ({
  readJson: vi.fn().mockResolvedValue({}),
  writeJsonAtomic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config", () => ({
  API_KEY: "fake",
  LIVE_ENGLISH_URL: "https://fake/live/en.json",
  LOCALES_DIR: "/tmp/locales",
  DEFAULT_NS: "translation",
  TARGET_LANGUAGES: [{ code: "es", name: "Español (ES)" }],
  VERBOSE: false,
  DRY_RUN: false,
  IS_GITHUB_ACTIONS: true, // Enable GitHub Actions mode
  SLACK_OUTPUT_FILE: "test-slack-payload.json",
  SLACK_MAX_CHARACTERS: 3000,
  SLACK_TRUNCATE_SUFFIX: "... Review the commit for full details",
  CHUNK_SIZE: 150,
  MAX_RETRIES: 3,
  RETRY_BASE_MS: 800,
  vlog: vi.fn(),
}));

// Mock fetch
globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: vi.fn().mockResolvedValue({ test: "live-en" }),
});

describe("Slack Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize Slack data collection at start", async () => {
    await run();

    const mockSlackFunctions = (globalThis as any).__mockSlackFunctions;
    expect(mockSlackFunctions.slackReset).toHaveBeenCalledTimes(1);
  });

  it("should set commit URL after fetching live EN", async () => {
    await run();

    const mockSlackFunctions = (globalThis as any).__mockSlackFunctions;
    expect(mockSlackFunctions.slackSetCommitUrl).toHaveBeenCalledWith(
      "https://fake/live/en.json",
    );
  });

  it("should log language processing data", async () => {
    await run();

    const mockSlackFunctions = (globalThis as any).__mockSlackFunctions;
    expect(mockSlackFunctions.slackLogLanguage).toHaveBeenCalledWith("es", {
      langCode: "es",
      langName: "Español (ES)",
      stringsTranslated: expect.any(Number),
      keysDeleted: expect.any(Number),
      addedKeys: expect.any(Array),
      deletedKeys: expect.any(Array),
    });
  });

  it("should generate and write Slack payload on success", async () => {
    const { writeJsonAtomic } = await import("../fs-utils");

    await run();

    const mockSlackFunctions = (globalThis as any).__mockSlackFunctions;
    expect(mockSlackFunctions.slackGeneratePayload).toHaveBeenCalledTimes(1);
    expect(writeJsonAtomic).toHaveBeenCalledWith(
      "test-slack-payload.json",
      expect.objectContaining({
        url: "test-url",
        updatedKeys: "test-keys",
        spanishTranslation: "test-translation",
        status: "test-status",
        summary: "test-summary",
      }),
    );
  });

  it("should log errors and generate payload on failure", async () => {
    const { writeJsonAtomic } = await import("../fs-utils");

    // Mock a failure
    const mockError = new Error("Translation failed");
    const mockSlackFunctions = (globalThis as any).__mockSlackFunctions;
    mockSlackFunctions.slackGeneratePayload.mockImplementation(() => {
      throw mockError;
    });

    try {
      await run();
    } catch (error) {
      // Expected to fail
    }

    expect(mockSlackFunctions.slackLogError).toHaveBeenCalledWith(
      expect.stringContaining("Translation failed"),
    );
  });
});
