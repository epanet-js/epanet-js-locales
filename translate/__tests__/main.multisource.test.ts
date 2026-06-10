import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Captures every writeJsonAtomic + every LLM prompt so we can assert per-source.
const writes: { file: string; obj: any }[] = [];
const prompts: string[] = [];

vi.mock("@google/generative-ai", () => {
  class FakeModel {
    async generateContent(req: any) {
      const prompt = req?.contents?.[0]?.parts?.[0]?.text ?? "";
      prompts.push(prompt);
      const match = prompt.match(
        /Input \(JSON array of English strings\):\n([\s\S]*)$/,
      );
      const arr: string[] = match ? JSON.parse(match[1]) : [];
      // model-build prompts carry the app glossary block; tag output accordingly
      const prefix = prompt.includes("Preferred existing translations")
        ? "MB:"
        : "APP:";
      return {
        response: { text: () => JSON.stringify(arr.map((s) => `${prefix}${s}`)) },
      };
    }
  }
  class GoogleGenerativeAI {
    constructor(_: string) {}
    getGenerativeModel(_: any) {
      return new FakeModel();
    }
  }
  return { GoogleGenerativeAI };
});

const appLiveEN = { greeting: "Hello", shared: "Pipe" };
const appLocalENprev = { greeting: "Hello" }; // "shared" is new in live
const appTargetES = { greeting: "Hola mundo" }; // existing app es (also the glossary)
const mbLiveEN = { build: "Build model", shared: "Pipe" };

globalThis.fetch = vi.fn(async (url: any) => ({
  ok: true,
  json: async () =>
    String(url).includes("/app/") ? appLiveEN : mbLiveEN,
})) as any;

vi.mock("../fs-utils", async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    readJson: vi.fn(async (file: string) => {
      if (file.endsWith("/en/translation.json")) return appLocalENprev;
      if (file.endsWith("/es/translation.json")) return appTargetES;
      if (file.endsWith("/en/model-build.json")) return {};
      if (file.endsWith("/es/model-build.json")) return {};
      return {};
    }),
    writeJsonAtomic: vi.fn(async (file: string, obj: any) => {
      writes.push({ file, obj });
    }),
  };
});

vi.mock("../config", () => ({
  API_KEY: "fake",
  LIVE_ENGLISH_URL: "https://fake/app/en.json",
  MODEL_BUILD_ENGLISH_URL: "https://fake/mb/en.json",
  LOCALES_DIR: "/tmp/locales",
  DEFAULT_NS: "translation",
  TRANSLATION_SOURCES: [
    {
      name: "App",
      liveUrl: "https://fake/app/en.json",
      namespace: "translation",
    },
    {
      name: "Model builder",
      liveUrl: "https://fake/mb/en.json",
      namespace: "model-build",
    },
  ],
  TARGET_LANGUAGES: [{ code: "es", name: "Español (ES)" }],
  VERBOSE: false,
  DRY_RUN: false,
  IS_GITHUB_ACTIONS: false,
  SLACK_OUTPUT_FILE: "slack-payload.json",
  SLACK_MAX_CHARACTERS: 3000,
  SLACK_TRUNCATE_SUFFIX: "... Review the commit for full details",
  CHUNK_SIZE: 999,
  MAX_RETRIES: 1,
  RETRY_BASE_MS: 1,
  vlog: () => {},
}));

vi.mock("../slack-data", () => ({
  slackLog: vi.fn(),
  slackLogLanguage: vi.fn(),
  slackLogError: vi.fn(),
  slackSetCommitUrl: vi.fn(),
  slackSetEnglishChanges: vi.fn(),
  slackGeneratePayload: vi.fn(() => ({
    url: "",
    updatedKeys: "",
    spanishTranslation: "",
    status: "",
    summary: "",
  })),
  slackReset: vi.fn(),
}));

import { run } from "../../main";

let restoreLogs: (() => void) | undefined;
beforeEach(() => {
  writes.length = 0;
  prompts.length = 0;
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  restoreLogs = () => {
    errSpy.mockRestore();
    logSpy.mockRestore();
  };
});
afterEach(() => {
  restoreLogs?.();
});

describe("orchestration (multi-source)", () => {
  const findWrite = (suffix: string) =>
    writes.find((w) => w.file.endsWith(suffix));

  it("writes both namespaces without cross-contamination and bootstraps model-build", async () => {
    await run();

    // App source → es/translation.json: app keys only, existing key preserved
    const appEs = findWrite("/es/translation.json");
    expect(appEs).toBeTruthy();
    expect(appEs!.obj.greeting).toBe("Hola mundo"); // untouched
    expect(appEs!.obj.shared).toBe("APP:Pipe"); // newly translated
    expect(appEs!.obj.build).toBeUndefined(); // no model-build key leaked

    // Model-build source → es/model-build.json: bootstrapped from empty, mb keys only
    const mbEs = findWrite("/es/model-build.json");
    expect(mbEs).toBeTruthy();
    expect(mbEs!.obj.build).toBe("MB:Build model");
    expect(mbEs!.obj.shared).toBe("MB:Pipe");
    expect(mbEs!.obj.greeting).toBeUndefined(); // no app key leaked

    // Each source syncs its own EN snapshot
    expect(findWrite("/en/translation.json")!.obj).toEqual(appLiveEN);
    expect(findWrite("/en/model-build.json")!.obj).toEqual(mbLiveEN);
  });

  it("passes the app translations as glossary when translating model-build", async () => {
    await run();

    const appPrompt = prompts.find(
      (p) => !p.includes("Preferred existing translations"),
    );
    const mbPrompt = prompts.find((p) =>
      p.includes("Preferred existing translations"),
    );

    expect(appPrompt).toBeTruthy(); // app translated WITHOUT glossary
    expect(mbPrompt).toBeTruthy(); // model-build translated WITH glossary
    expect(mbPrompt).toContain("Hola mundo"); // app's es wording is in the glossary block
  });
});
