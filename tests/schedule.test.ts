import { describe, expect, it } from "vitest";
import { dailyTarget, pacedAllowance, windowFractionElapsed } from "../lib/schedule";

describe("dailyTarget", () => {
  const min = 3;
  const max = 10;
  const cooldown = 14;

  it("never drops below the daily minimum, even with an empty pool", () => {
    expect(dailyTarget(0, cooldown, min, max)).toBe(3);
    expect(dailyTarget(20, cooldown, min, max)).toBe(3);
  });

  it("grows with the pool (pool ÷ cooldown days)", () => {
    expect(dailyTarget(42, cooldown, min, max)).toBe(3); // floor(42/14)=3
    expect(dailyTarget(84, cooldown, min, max)).toBe(6);
    expect(dailyTarget(112, cooldown, min, max)).toBe(8);
  });

  it("caps at the daily maximum", () => {
    expect(dailyTarget(140, cooldown, min, max)).toBe(10);
    expect(dailyTarget(1000, cooldown, min, max)).toBe(10);
  });
});

describe("windowFractionElapsed", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 1, h, m));

  it("is 0 before the window and 1 after", () => {
    expect(windowFractionElapsed(at(4), 5, 21)).toBe(0);
    expect(windowFractionElapsed(at(22), 5, 21)).toBe(1);
  });

  it("is ~0.5 at the midpoint", () => {
    expect(windowFractionElapsed(at(13), 5, 21)).toBeCloseTo(0.5, 5);
  });
});

describe("pacedAllowance", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h));

  it("releases the target gradually across the day", () => {
    expect(pacedAllowance(10, at(4), 5, 21)).toBe(0); // before window
    expect(pacedAllowance(10, at(13), 5, 21)).toBe(5); // halfway
    expect(pacedAllowance(10, at(21), 5, 21)).toBe(10); // end of window
  });

  it("never exceeds the target", () => {
    expect(pacedAllowance(3, at(23), 5, 21)).toBe(3);
  });
});
