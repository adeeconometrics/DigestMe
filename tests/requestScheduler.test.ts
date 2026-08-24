import { describe, expect, it } from "vitest";
import { createRequestScheduler } from "../src/pyodide/requestScheduler";

describe("engine request scheduler", () => {
  it("holds requests beyond the concurrency cap until a slot finishes", async () => {
    const started: number[] = [];
    const resolvers = new Map<number, () => void>();
    const scheduler = createRequestScheduler<number>(2, async (value) => {
      started.push(value);
      await new Promise<void>((resolve) => resolvers.set(value, resolve));
    });

    scheduler.enqueue({ requestId: 1, value: 1 });
    scheduler.enqueue({ requestId: 2, value: 2 });
    scheduler.enqueue({ requestId: 3, value: 3 });

    expect(started).toEqual([1, 2]);
    expect(resolvers.has(3)).toBe(false);

    resolvers.get(1)?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual([1, 2, 3]);

    resolvers.get(2)?.();
    resolvers.get(3)?.();
  });

  it("removes a queued request without consuming a slot", async () => {
    const started: number[] = [];
    const resolvers = new Map<number, () => void>();
    const scheduler = createRequestScheduler<number>(2, async (value) => {
      started.push(value);
      await new Promise<void>((resolve) => resolvers.set(value, resolve));
    });

    scheduler.enqueue({ requestId: 1, value: 1 });
    scheduler.enqueue({ requestId: 2, value: 2 });
    scheduler.enqueue({ requestId: 3, value: 3 });

    expect(scheduler.cancel(3)).toBe(true);
    resolvers.get(1)?.();
    resolvers.get(2)?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual([1, 2]);
    expect(scheduler.cancel(3)).toBe(false);
  });
});
