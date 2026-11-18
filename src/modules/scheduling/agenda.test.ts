import { describe, expect, it } from "vitest";
import { canTransition, panelTransitions } from "@/modules/booking/status";
import { computeKpis, shiftDay, type AgendaBooking, type AgendaColumn } from "./agenda";

const col = (id: string, working: [number, number][]): AgendaColumn => ({ id, name: id, working });
const bk = (
  resourceId: string,
  startMin: number,
  endMin: number,
  status: AgendaBooking["status"] = "CONFIRMED",
  extra: Partial<AgendaBooking> = {},
): AgendaBooking => ({
  id: `${resourceId}-${startMin}`,
  resourceId,
  customerName: "C",
  offeringName: "Corte",
  status,
  source: "TENANT_PAGE",
  start: new Date(0),
  end: new Date(0),
  startMin,
  endMin,
  priceCents: 4500,
  prepaidCents: 0,
  ...extra,
});

describe("computeKpis", () => {
  it("conta, soma e calcula ocupação e a maior janela livre", () => {
    const k = computeKpis(
      [
        col("a", [
          [540, 720],
          [780, 1260],
        ]),
        col("b", [[540, 1260]]),
      ],
      [
        bk("a", 540, 600),
        bk("a", 600, 630, "COMPLETED", { prepaidCents: 2000 }),
        bk("b", 600, 630, "PENDING_PAYMENT", { source: "MARKETPLACE" }),
        bk("b", 700, 730, "NO_SHOW"),
      ],
      25,
    );
    expect(k.bookings).toBe(4);
    expect(k.fromMarketplace).toBe(1);
    expect(k.forecastCents).toBe(3 * 4500); // falta não entra no previsto
    expect(k.paidOnlineCents).toBe(2000); // só confirmados/concluídos
    // Ocupado: 60 + 30 (a) + 30 + 30 (b; a falta também segurou o horário) = 150 de 1380 min.
    expect(k.occupancy).toBe(Math.round((150 * 100) / (660 + 720)));
    expect(k.longestFree).toEqual({ from: 730, to: 1260 });
    expect(k.noShowRate).toBe(25);
  });

  it("sem expediente, ocupação é nula", () => {
    expect(computeKpis([col("a", [])], [], null)).toMatchObject({
      occupancy: null,
      longestFree: null,
    });
  });
});

describe("transições do painel", () => {
  it("confirmado pode concluir, faltar ou cancelar; cancelado é final", () => {
    expect(panelTransitions("CONFIRMED")).toEqual(["COMPLETED", "NO_SHOW", "CANCELLED"]);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("NO_SHOW", "CONFIRMED")).toBe(true); // desfazer
    expect(canTransition("PENDING_PAYMENT", "COMPLETED")).toBe(false);
  });
});

describe("shiftDay", () => {
  it("atravessa mês e ano", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});
