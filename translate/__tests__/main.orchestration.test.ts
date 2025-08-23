import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { run } from "../../main";

// --- Mocks ---
vi.mock("@google/generative-ai", () => {
  class FakeModel {
    private responder: (input: string) => string[] = () => [];
    setResponder(fn: (input: string) => string[]) {
      this.responder = fn;
    }
    async generateContent(req: any) {
      const prompt = req?.contents?.[0]?.parts?.[0]?.text ?? "";
      const out = (this as any)._responder
        ? (this as any)._responder(prompt)
        : this.responder(prompt);
      return {
        response: {
          text: () => JSON.stringify(out),
        },
      };
    }
  }
  class GoogleGenerativeAI {
    model: any;
    constructor(_: string) {}
    getGenerativeModel(_: any) {
      const m = new FakeModel();
      // expose setter so tests can tweak behavior
      (globalThis as any).__fakeModel = m;
      return m;
    }
  }
  return { GoogleGenerativeAI };
});

// Mock global fetch
globalThis.fetch = vi.fn().mockImplementation(async () => ({
  ok: true,
  json: async () => (globalThis as any).__liveEN, // grab current value at call time
}));

const writes: any[] = [];
vi.mock("../fs-utils", async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    readJson: vi.fn(async (file: string) => {
      if (file.endsWith("/en/translation.json"))
        return (globalThis as any).__localEN_prev;
      if (file.endsWith("/fr/translation.json"))
        return (globalThis as any).__targetFR;
      if (file.endsWith("/nl/translation.json"))
        return (globalThis as any).__targetNL;
      return {};
    }),
    writeJsonAtomic: vi.fn(async (file: string, obj: any) => {
      writes.push({ file, obj });
    }),
  };
});

// Override config constants (no real env)
vi.mock("../config", () => {
  return {
    API_KEY: "fake",
    LIVE_ENGLISH_URL: "https://fake/live/en.json",
    LOCALES_DIR: "/tmp/locales",
    DEFAULT_NS: "translation",
    TARGET_LANGUAGES: [
      { code: "fr", name: "Français (FR)" },
      { code: "nl", name: "Nederlands (NL)" },
    ],
    VERBOSE: false,
    DRY_RUN: false,
    IS_GITHUB_ACTIONS: false,
    SLACK_OUTPUT_FILE: "slack-payload.json",
    SLACK_MAX_CHARACTERS: 3000,
    SLACK_TRUNCATE_SUFFIX: "... Review the commit for full details",
    CHUNK_SIZE: 999,
    MAX_RETRIES: 2,
    RETRY_BASE_MS: 1,
    vlog: () => {},
  };
});

// Mock Slack data collection
vi.mock("../slack-data", () => {
  return {
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
  };
});

// --- Imports after mocks ---
import {
  liveEN,
  localEN_previous,
  targetFR_existing,
  targetNL_existing,
} from "./fixtures";

function setModelResponder(fn: (prompt: string) => string[]) {
  (globalThis as any).__fakeModel._responder = fn;
}

let restoreLogs: (() => void) | undefined;

beforeEach(() => {
  // ... your existing setup
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

describe("orchestration (main)", () => {
  beforeEach(() => {
    writes.length = 0;
    (globalThis as any).__liveEN = liveEN;
    (globalThis as any).__localEN_prev = localEN_previous;
    (globalThis as any).__targetFR = JSON.parse(
      JSON.stringify(targetFR_existing),
    );
    (globalThis as any).__targetNL = JSON.parse(
      JSON.stringify(targetNL_existing),
    );
  });

  it("writes all languages & syncs EN when all succeed", async () => {
    // For FR: need translation for app.about; For NL: also app.about (modified source)
    setModelResponder((prompt) => {
      // naive parse: just return one-item or n-item array of "X-" + index
      // more realistic: return translations derived from prompt length
      const match = prompt.match(
        /Input \(JSON array of English strings\):\n([\s\S]*)$/,
      );
      const arr = match ? JSON.parse(match[1]) : [];
      // return same length array with "T:" prefix to simulate translation
      return arr.map((s: string) => `T:${s}`);
    });

    // Run main
    await run();

    // We expect 3 writes: fr/translation.json, nl/translation.json, en/translation.json
    const files = writes.map((w) => w.file);
    expect(files.filter((f) => f.includes("/fr/translation.json")).length).toBe(
      1,
    );
    expect(files.filter((f) => f.includes("/nl/translation.json")).length).toBe(
      1,
    );
    expect(files.filter((f) => f.includes("/en/translation.json")).length).toBe(
      1,
    );

    // app.about must be set to translated value T:About the app
    const frWrite = writes.find((w) => w.file.includes("/fr/translation.json"));
    expect(frWrite.obj.app.about).toBe("T:About the app");
    // deleted view removed
    expect(frWrite.obj.menu.view).toBeUndefined();
  });

  it("writes nothing if any language fails validation", async () => {
    // Make FR succeed, NL fail by returning wrong length
    let callCount = 0;
    setModelResponder((prompt) => {
      callCount++;
      const input = JSON.parse(
        (prompt.match(
          /Input \(JSON array of English strings\):\n([\s\S]*)$/,
        ) || [, "[]"])[1],
      );
      if (callCount === 1) {
        return input.map((s: string) => `FR:${s}`); // ok
      } else {
        return input.slice(0, Math.max(0, input.length - 1)); // wrong length -> should abort all
      }
    });

    // re-import main to trigger run; capture exitCode setting via try/catch
    writes.length = 0;
    await expect(run()).rejects.toThrow(/Length mismatch/);
    expect(writes.length).toBe(0);
  });
});
