import { describe, expect, it } from "vitest";
import { cn } from "./cn";
import { dayChip, formatDistance, formatRating, longPeriod, whenLabel } from "./format";

describe("format", () => {
  it("formatRating usa vírgula", () => {
    expect(formatRating(4.9)).toBe("4,9");
    expect(formatRating(5)).toBe("5,0");
  });

  it("formatDistance", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(1234)).toBe("1,2 km");
    expect(formatDistance(5000)).toBe("5,0 km");
  });
});

describe("cn", () => {
  it("não confunde tamanho de texto customizado com cor", () => {
    expect(cn("text-body text-ink")).toBe("text-body text-ink");
  });

  it("resolve conflito dentro do mesmo grupo", () => {
    expect(cn("text-body", "text-caption")).toBe("text-caption");
    expect(cn("rounded-control", "rounded-pill")).toBe("rounded-pill");
    expect(cn("bg-surface", "bg-brand")).toBe("bg-brand");
  });
});

describe("datas das telas de agendamento", () => {
  const SP = "America/Sao_Paulo";
  const now = new Date("2026-11-06T15:00:00Z"); // sexta 12:00 em SP

  it("whenLabel", () => {
    expect(whenLabel(new Date("2026-11-06T21:30:00Z"), SP, now)).toBe("Hoje 18:30");
    expect(whenLabel(new Date("2026-11-07T21:30:00Z"), SP, now)).toBe("Amanhã 18:30");
    expect(whenLabel(new Date("2026-11-09T12:00:00Z"), SP, now)).toBe("Seg 09/11 09:00");
    // 01:30 UTC de sábado ainda é sexta 22:30 em SP.
    expect(whenLabel(new Date("2026-11-07T01:30:00Z"), SP, now)).toBe("Hoje 22:30");
  });

  it("dayChip", () => {
    const today = { year: 2026, month: 11, day: 6 };
    expect(dayChip(today, today)).toMatchObject({ top: "Hoje", bottom: "06" });
    expect(dayChip({ year: 2026, month: 11, day: 7 }, today)).toMatchObject({
      top: "Sáb",
      bottom: "07",
    });
    expect(dayChip({ year: 2026, month: 11, day: 7 }, today).full).toBe("sábado, 7 de novembro");
  });

  it("longPeriod", () => {
    expect(longPeriod(new Date("2026-11-07T21:30:00Z"), new Date("2026-11-07T22:20:00Z"), SP)).toBe(
      "sábado, 7 de novembro, 18:30–19:20",
    );
  });
});
