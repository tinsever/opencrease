import { expect, it } from "vitest";
import { validatePages } from "./render";

it("validates PDF pages before launching Chromium", () => {
  expect(validatePages([{ html: "<main>Type</main>", width: 320.2, height: 180.7 }])).toEqual([{ html: "<main>Type</main>", width: 320, height: 181 }]);
  for (const input of [null, [], [{}], [{ html: "", width: 10, height: 10 }], [{ html: "x", width: NaN, height: 10 }], [{ html: "x", width: 10, height: 20_001 }], Array(501).fill({ html: "x", width: 1, height: 1 })]) expect(() => validatePages(input)).toThrow();
});
