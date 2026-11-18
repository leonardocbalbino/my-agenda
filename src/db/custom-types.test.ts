import { describe, expect, it } from "vitest";
import { parseEwkbPoint, parsePeriod, serializePeriod } from "./custom-types";

describe("tstzrange", () => {
  it.each([
    [
      '["2026-11-06 18:30:00+00","2026-11-06 19:20:00+00")',
      "2026-11-06T18:30:00.000Z",
      "2026-11-06T19:20:00.000Z",
    ],
    [
      '["2026-11-06 15:30:00-03","2026-11-06 16:20:00.5-03")',
      "2026-11-06T18:30:00.000Z",
      "2026-11-06T19:20:00.500Z",
    ],
    [
      '["2026-11-06 23:30:00+05:30","2026-11-07 00:30:00+05:30")',
      "2026-11-06T18:00:00.000Z",
      "2026-11-06T19:00:00.000Z",
    ],
  ])("lê %s", (raw, start, end) => {
    const p = parsePeriod(raw);
    expect(p.start.toISOString()).toBe(start);
    expect(p.end.toISOString()).toBe(end);
  });

  it("rejeita intervalos infinitos ou fechados no fim", () => {
    expect(() => parsePeriod('["2026-11-06 18:30:00+00",)')).toThrow();
    expect(() => parsePeriod('["2026-11-06 18:30:00+00","2026-11-06 19:00:00+00"]')).toThrow();
  });

  it("serializa como [início, fim) em UTC e recusa período invertido", () => {
    const start = new Date("2026-11-06T18:30:00Z");
    const end = new Date("2026-11-06T19:00:00Z");
    expect(serializePeriod({ start, end })).toBe(
      "[2026-11-06T18:30:00.000Z,2026-11-06T19:00:00.000Z)",
    );
    expect(() => serializePeriod({ start: end, end: start })).toThrow(RangeError);
  });
});

describe("geography(Point)", () => {
  it("lê EWKB little-endian com SRID", () => {
    // SELECT 'SRID=4326;POINT(-46.6835 -23.565)'::geography
    const hex = "0101000020E6100000736891ED7C5747C0713D0AD7A39037C0";
    expect(parseEwkbPoint(hex)).toEqual({ lng: -46.6835, lat: -23.565 });
  });
});
