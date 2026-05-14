import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @tauri-apps/api/core BEFORE importing the SUT so the import binding
// resolves to our vi.fn(). Tauri's real invoke would throw outside a tauri runtime.
const invokeMock = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
// Also stub event subscription so the module doesn't try to register listeners.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { writeStdin } from "../terminal";

describe("writeStdin", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a small payload as a single invoke", async () => {
    await writeStdin(1, "hello");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("write_stdin", {
      sessionId: 1,
      data: "hello",
    });
  });

  it("does not invoke for empty data", async () => {
    await writeStdin(1, "");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("chunks payloads larger than 64 KiB", async () => {
    // Build a > 64 KiB ASCII string. 70 000 bytes = 70 KiB.
    const big = "a".repeat(70_000);
    await writeStdin(2, big);
    // Should have been chunked into at least 2 invokes.
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Concatenated chunks must equal the original payload.
    const reconstructed = invokeMock.mock.calls
      .map((c) => (c[1] as { data: string }).data)
      .join("");
    expect(reconstructed).toBe(big);
  });

  it("serializes overlapping writes to the same session in call order", async () => {
    // Make invoke resolve slowly so the queue actually has to wait.
    const order: string[] = [];
    let pendingResolves: (() => void)[] = [];
    invokeMock.mockImplementation(async (_cmd: string, args: { data: string }) => {
      order.push(args.data);
      await new Promise<void>((resolve) => {
        pendingResolves.push(resolve);
      });
    });

    const p1 = writeStdin(3, "first");
    const p2 = writeStdin(3, "second");
    const p3 = writeStdin(3, "third");

    // Drain the queue manually, in order.
    while (pendingResolves.length > 0 || invokeMock.mock.calls.length < 3) {
      // Allow the awaiting code to advance.
      await Promise.resolve();
      const r = pendingResolves.shift();
      if (r) r();
    }
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("does not poison subsequent writes when one rejects", async () => {
    invokeMock.mockImplementationOnce(async () => {
      throw new Error("transient PTY failure");
    });
    // The first call rejects; the second should still go through.
    await expect(writeStdin(4, "boom")).rejects.toThrow("transient PTY failure");
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(writeStdin(4, "ok")).resolves.toBeUndefined();
    // Both invokes happened.
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
