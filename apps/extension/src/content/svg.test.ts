import { expect, it } from "vitest";
import { rewriteSvgReferences } from "./svg";

it("rewrites quoted and absolute local SVG paint references before XML escaping", () => {
  const ids = new Map([["g", "capture-g"]]);
  const page = "https://example.com/page";
  expect(rewriteSvgReferences('url("#g")', ids, page)).toBe("url(#capture-g)");
  expect(rewriteSvgReferences("url('https://example.com/page#g')", ids, page)).toBe("url(#capture-g)");
  expect(rewriteSvgReferences("#g", ids, page)).toBe("#capture-g");
  expect(rewriteSvgReferences("url(https://other.example/sprite#g)", ids, page)).toBe("url(https://other.example/sprite#g)");
});
