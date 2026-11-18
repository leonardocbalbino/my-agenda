import { cents, type Cents } from "@/lib/money";

export type PaymentPolicy = "ON_SITE" | "DEPOSIT" | "FULL";

/**
 * Quanto o cliente paga online no ato. Aritmética inteira em centavos;
 * o sinal arredonda meio centavo para cima (R$ 0,005 -> R$ 0,01).
 */
export function prepaidAmount(price: number, policy: PaymentPolicy, depositBps: number): Cents {
  if (!Number.isSafeInteger(price) || price < 0) throw new RangeError("Preço inválido");
  if (!Number.isInteger(depositBps) || depositBps < 0 || depositBps > 10_000) {
    throw new RangeError("Sinal inválido");
  }
  switch (policy) {
    case "ON_SITE":
      return cents(0);
    case "FULL":
      return cents(price);
    case "DEPOSIT":
      return cents(Math.floor((price * depositBps + 5_000) / 10_000));
  }
}
