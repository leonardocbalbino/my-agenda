/**
 * Dinheiro é SEMPRE inteiro em centavos. Nunca use float para valor monetário.
 * O tipo `Cents` é "branded" para o compilador barrar `number` solto.
 */
export type Cents = number & { readonly __brand: "Cents" };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Valor monetário precisa ser inteiro em centavos, recebeu ${value}`);
  }
  return value as Cents;
}

const integerFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export interface FormatBRLOptions {
  /** Omite ",00" quando o valor é redondo: "R$ 45" em vez de "R$ 45,00". */
  hideZeroCents?: boolean;
}

/**
 * Formata centavos como BRL ("R$ 1.385,50") sem nunca passar por float:
 * a parte inteira e os centavos são separados com aritmética inteira.
 * O espaço depois de "R$" é não separável (U+00A0), para não quebrar linha.
 */
export function formatBRL(value: Cents, options: FormatBRLOptions = {}): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const rest = abs % 100;
  const reais = (abs - rest) / 100; // divisão exata: abs - rest é múltiplo de 100

  let out = `R$ ${integerFormatter.format(reais)}`;
  if (!(options.hideZeroCents && rest === 0)) {
    out += `,${String(rest).padStart(2, "0")}`;
  }
  return negative ? `-${out}` : out;
}
