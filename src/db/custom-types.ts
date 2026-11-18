import { customType } from "drizzle-orm/pg-core";

/**
 * Intervalo meio-aberto [start, end) em UTC, gravado como `tstzrange`.
 * A conexão usa TimeZone=UTC (ver client.ts); o fuso da Location só entra na exibição.
 */
export interface Period {
  start: Date;
  end: Date;
}

function parseTimestamp(raw: string): Date {
  // Postgres: "2026-11-06 18:30:00+00" ou "2026-11-06 18:30:00.5-03" ou "...+05:30"
  const iso = raw.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Timestamp inválido vindo do banco: ${raw}`);
  return d;
}

export function parsePeriod(value: string): Period {
  const m = /^\[\s*"?([^",]+)"?\s*,\s*"?([^",]+)"?\s*\)$/.exec(value);
  if (!m) throw new Error(`Período deve ser [início, fim) finito, recebeu: ${value}`);
  return { start: parseTimestamp(m[1]), end: parseTimestamp(m[2]) };
}

export function serializePeriod({ start, end }: Period): string {
  if (!(start < end)) throw new RangeError("Período precisa ter início antes do fim");
  return `[${start.toISOString()},${end.toISOString()})`;
}

export const tstzrange = customType<{ data: Period; driverData: string }>({
  dataType: () => "tstzrange",
  toDriver: serializePeriod,
  fromDriver: parsePeriod,
});

/** Ponto WGS84 (SRID 4326). */
export interface GeoPoint {
  lng: number;
  lat: number;
}

/** Lê EWKB hex de um Point (formato que o PostGIS devolve para geography). */
export function parseEwkbPoint(hex: string): GeoPoint {
  const buf = Buffer.from(hex, "hex");
  const le = buf.readUInt8(0) === 1;
  const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  const hasSrid = (type & 0x20000000) !== 0;
  if ((type & 0xff) !== 1) throw new Error("Esperado um POINT");
  const offset = 5 + (hasSrid ? 4 : 0);
  const read = (o: number) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  return { lng: read(offset), lat: read(offset + 8) };
}

export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType: () => "geography(Point,4326)",
  toDriver: ({ lng, lat }) => {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new RangeError("Coordenada inválida");
    return `SRID=4326;POINT(${lng} ${lat})`;
  },
  fromDriver: parseEwkbPoint,
});
