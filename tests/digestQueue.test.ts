import { describe, expect, it } from "vitest";
import { createDigestQueue } from "../src/lib/digestQueue";

describe("digest queue", () => {
  it("assigns positions and releases jobs in enqueue order", () => {
    const queue = createDigestQueue();

    expect(queue.enqueue(["first", "second", "third"])).toEqual([
      { id: "first", position: 1 },
      { id: "second", position: 2 },
      { id: "third", position: 3 },
    ]);
    expect(queue.finish("second")).toBeUndefined();
    expect(queue.finish("first")).toBe("second");
    expect(queue.finish("third")).toBeUndefined();
    expect(queue.finish("second")).toBe("third");
    expect(queue.finish("third")).toBeUndefined();
  });

  it("skips a removed job without changing the order of the remaining jobs", () => {
    const queue = createDigestQueue();
    queue.enqueue(["first", "removed", "last"]);

    expect(queue.remove("removed")).toBeUndefined();
    expect(queue.finish("first")).toBe("last");
    expect(queue.remove("first")).toBeUndefined();
    expect(queue.finish("last")).toBeUndefined();
  });
});
