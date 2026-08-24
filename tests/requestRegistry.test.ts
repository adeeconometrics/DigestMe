import { describe, expect, it } from "vitest";
import { createRequestRegistry } from "../src/pyodide/requestRegistry";
import type { WireValue } from "../src/types";

describe("engine request registry", () => {
  it("routes stream events to their registered request", () => {
    const first: WireValue[] = [];
    const second: WireValue[] = [];
    const registry = createRequestRegistry();

    registry.register(1, { payload: "first", onStream: (event) => first.push(event) });
    registry.register(2, { payload: "second", onStream: (event) => second.push(event) });
    registry.dispatch(2, { name: "second-event" });
    registry.dispatch(1, { name: "first-event" });

    expect(first).toEqual([{ name: "first-event" }]);
    expect(second).toEqual([{ name: "second-event" }]);

    registry.remove(1);
    registry.dispatch(1, { name: "late-event" });
    expect(first).toEqual([{ name: "first-event" }]);
  });
});
