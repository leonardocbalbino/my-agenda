import { describe, expect, it } from "vitest";
import { customerCancellation, splitMyBookings, type MyBooking } from "./service";

const start = new Date("2026-11-06T21:30:00Z");
const hoursBefore = (h: number) => new Date(start.getTime() - h * 3_600_000);

describe("customerCancellation", () => {
  it("confirmado: até 2h antes pode, depois não", () => {
    expect(customerCancellation("CONFIRMED", start, hoursBefore(3))).toBe("OK");
    expect(customerCancellation("CONFIRMED", start, hoursBefore(2))).toBe("OK");
    expect(customerCancellation("CONFIRMED", start, hoursBefore(1.99))).toBe(
      "CANCEL_WINDOW_CLOSED",
    );
  });

  it("pendente de pagamento sempre pode desistir", () => {
    expect(customerCancellation("PENDING_PAYMENT", start, hoursBefore(0.1))).toBe("OK");
  });

  it.each(["CANCELLED", "COMPLETED", "NO_SHOW"] as const)("%s não pode", (status) => {
    expect(customerCancellation(status, start, hoursBefore(48))).toBe("NOT_CANCELLABLE");
  });
});

describe("splitMyBookings", () => {
  const now = new Date("2026-11-06T15:00:00Z");
  const b = (id: string, startIso: string, status: MyBooking["status"]): MyBooking => ({
    id,
    tenantSlug: "t",
    tenantName: "T",
    offeringName: "Corte",
    resourceName: "R",
    start: new Date(startIso),
    end: new Date(new Date(startIso).getTime() + 30 * 60_000),
    timezone: "America/Sao_Paulo",
    status,
    priceCents: 4500,
  });

  it("próximos: ativos que ainda não terminaram, do mais cedo para o mais tarde", () => {
    const { upcoming, past } = splitMyBookings(
      [
        b("depois", "2026-11-08T12:00:00Z", "CONFIRMED"),
        b("antes", "2026-11-07T12:00:00Z", "PENDING_PAYMENT"),
        b("agora", "2026-11-06T14:45:00Z", "CONFIRMED"), // termina 15:15, ainda em andamento
        b("cancelado", "2026-11-09T12:00:00Z", "CANCELLED"),
        b("ontem", "2026-11-05T12:00:00Z", "COMPLETED"),
      ],
      now,
    );
    expect(upcoming.map((x) => x.id)).toEqual(["agora", "antes", "depois"]);
    expect(past.map((x) => x.id).sort()).toEqual(["cancelado", "ontem"]);
  });
});
