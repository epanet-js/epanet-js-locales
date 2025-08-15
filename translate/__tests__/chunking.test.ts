import { describe, it, expect, vi } from "vitest";
import { chunk, retry } from "../chunking";

describe("chunking & retry", () => {
  it("chunks arrays", () => {
    const arr = Array.from({ length: 7 }, (_, i) => i + 1);
    expect(chunk(arr, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it("retries flaky function and succeeds", async () => {
    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
      return "ok";
    });
    const result = await retry(fn, 5, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(retry(fn, 2, 5)).rejects.toThrow(/always fails/);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
