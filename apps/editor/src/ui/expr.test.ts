import { describe, expect, it } from "vitest";
import { evaluateExpression, formatNumber, parseFieldInput, pxValue } from "./expr";

describe("evaluateExpression", () => {
  it("handles arithmetic with precedence and parentheses", () => {
    expect(evaluateExpression("24*2")).toBe(48);
    expect(evaluateExpression("10 + 4 * 2")).toBe(18);
    expect(evaluateExpression("(10 + 4) * 2")).toBe(28);
    expect(evaluateExpression("100/3")).toBe(33.333);
    expect(evaluateExpression("-8 + 2")).toBe(-6);
    expect(evaluateExpression("2x3")).toBe(6);
  });
  it("strips px and accepts comma decimals", () => {
    expect(evaluateExpression("12px + 4px")).toBe(16);
    expect(evaluateExpression("1,5")).toBe(1.5);
  });
  it("rejects invalid input", () => {
    expect(evaluateExpression("")).toBeNull();
    expect(evaluateExpression("abc")).toBeNull();
    expect(evaluateExpression("4 +")).toBeNull();
    expect(evaluateExpression("1/0")).toBeNull();
    expect(evaluateExpression("(2")).toBeNull();
  });
});

describe("parseFieldInput", () => {
  it("returns numbers for expressions", () => {
    expect(parseFieldInput("16*3")).toBe(48);
  });
  it("keeps tokens, units and keywords", () => {
    expect(parseFieldInput("var(--spacing-4)")).toBe("var(--spacing-4)");
    expect(parseFieldInput("--radius-md")).toBe("var(--radius-md)");
    expect(parseFieldInput("50%")).toBe("50%");
    expect(parseFieldInput("1.5em")).toBe("1.5em");
    expect(parseFieldInput("Auto")).toBe("auto");
    expect(parseFieldInput("calc(100% - 24px)")).toBe("calc(100% - 24px)");
  });
  it("can refuse units", () => {
    expect(parseFieldInput("50%", { allowUnits: false })).toBeNull();
  });
});

describe("helpers", () => {
  it("pxValue", () => {
    expect(pxValue(12)).toBe(12);
    expect(pxValue("12px")).toBe(12);
    expect(pxValue("-4")).toBe(-4);
    expect(pxValue("50%")).toBeNull();
  });
  it("formatNumber", () => {
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(2)).toBe("2");
    expect(formatNumber(0.123456)).toBe("0.12");
    expect(formatNumber(-0.001)).toBe("0");
  });
});

describe("formatNumber integers", () => {
  it("keeps zeros in integers", () => {
    expect(formatNumber(100, 0)).toBe("100");
    expect(formatNumber(1440)).toBe("1440");
    expect(formatNumber(10.5)).toBe("10.5");
  });
});
