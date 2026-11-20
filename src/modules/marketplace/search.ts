/**
 * Busca do marketplace sobre a vitrine pública (view public_listings: só
 * tenants listados e ativos, só colunas públicas) e "próximos horários livres".
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { addDays, parseISODate, todayIn, toISODate } from "@/lib/time";
import type { Niche } from "@/modules/catalog/niches";
import { getAvailableSlots } from "@/modules/scheduling";

export interface SearchInput {
  niche?: Niche | null;
  /** "O quê": serviço ou estabelecimento. */
  q?: string | null;
  /** "Onde" em texto: bairro ou cidade. */
  where?: string | null;
  /** "Perto de mim": coordenadas do navegador. */
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number;
  limit?: number;
}

export interface Listing {
  tenantId: string;
  slug: string;
  name: string;
  niche: Niche;
  brandColor: string;
  neighborhood: string;
  city: string;
  timezone: string;
  startingPriceCents: number | null;
  isRental: boolean;
  offeringNames: string[];
  headlineOfferingId: string | null;
  distanceMeters: number | null;
}

/** Escapa curingas do LIKE no texto digitado. */
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function searchListings(db: Db, input: SearchInput): Promise<Listing[]> {
  const hasPoint =
    typeof input.lat === "number" &&
    typeof input.lng === "number" &&
    Math.abs(input.lat) <= 90 &&
    Math.abs(input.lng) <= 180;
  const point = hasPoint
    ? sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography`
    : sql`null::geography`;
  const q = input.q?.trim() ? like(input.q.trim()) : null;
  const where = input.where?.trim() ? like(input.where.trim()) : null;
  const radiusM = (input.radiusKm ?? 25) * 1000;

  const r = await db.execute<{
    tenant_id: string;
    slug: string;
    name: string;
    niche: Niche;
    brand_color: string;
    neighborhood: string;
    city: string;
    timezone: string;
    starting_price_cents: number | null;
    is_rental: boolean | null;
    offering_names: string[];
    headline_offering_id: string | null;
    distance_m: number | null;
  }>(sql`
    select l.*, case when ${hasPoint} and l.geo is not null
                     then round(ST_Distance(l.geo, ${point}))::int end as distance_m
      from public_listings l
     where (${input.niche ?? null}::niche is null or l.niche = ${input.niche ?? null}::niche)
       and (${q}::text is null
            or unaccent(l.name) ilike unaccent(${q})
            or unaccent(l.neighborhood) ilike unaccent(${q})
            or exists (select 1 from unnest(l.offering_names) n where unaccent(n) ilike unaccent(${q})))
       and (${where}::text is null
            or unaccent(l.neighborhood) ilike unaccent(${where})
            or unaccent(l.city) ilike unaccent(${where}))
       and (not ${hasPoint} or l.geo is null or ST_DWithin(l.geo, ${point}, ${radiusM}))
     order by distance_m nulls last, l.name
     limit ${input.limit ?? 48}`);

  return r.rows.map((x) => ({
    tenantId: x.tenant_id,
    slug: x.slug,
    name: x.name,
    niche: x.niche,
    brandColor: x.brand_color,
    neighborhood: x.neighborhood,
    city: x.city,
    timezone: x.timezone,
    startingPriceCents: x.starting_price_cents,
    isRental: Boolean(x.is_rental),
    offeringNames: x.offering_names ?? [],
    headlineOfferingId: x.headline_offering_id,
    distanceMeters: x.distance_m,
  }));
}

export interface FreeSlot {
  /** "18:30" */
  label: string;
  start: Date;
  /** Profissional ou quadra sugerido (o que o "Qualquer" escolheria). */
  resourceId: string;
}

export interface NextFree {
  date: string;
  slots: FreeSlot[];
}

/** Quando: dia relativo a hoje e hora mínima (null = a partir de agora). */
export interface When {
  dayOffset: number;
  fromHour: number | null;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const cache = new Map<string, { value: Promise<NextFree | null>; expires: number }>();
const TTL = 60_000;

/**
 * Até 3 próximos horários livres do serviço vitrine, no dia pedido; se o dia não
 * tiver nada, olha os próximos dias (até uma semana). Cache de 1 min por tenant.
 */
export function nextFreeSlots(
  db: Db,
  listing: Pick<Listing, "tenantId" | "timezone" | "headlineOfferingId">,
  when: When,
  now = new Date(),
): Promise<NextFree | null> {
  if (!listing.headlineOfferingId) return Promise.resolve(null);
  const key = `${listing.tenantId}|${listing.headlineOfferingId}|${when.dayOffset}|${when.fromHour}|${Math.floor(now.getTime() / TTL)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now.getTime()) return hit.value;
  if (cache.size > 2_000) cache.clear();

  const value = (async () => {
    const first = addDays(todayIn(listing.timezone, now), when.dayOffset);
    for (let d = 0; d < 7; d++) {
      const date = toISODate(addDays(first, d));
      const { slots } = await getAvailableSlots(db, listing.tenantId, {
        offeringId: listing.headlineOfferingId!,
        resourceId: null,
        date,
        now,
      });
      const minFrom = d === 0 && when.fromHour !== null ? when.fromHour * 60 : -1;
      const free = slots
        .filter((s) => s.available && s.resourceId && toMin(s.localTime) >= minFrom)
        .slice(0, 3)
        .map((s) => ({ label: s.localTime, start: s.start, resourceId: s.resourceId! }));
      if (free.length) return { date, slots: free };
    }
    return null;
  })().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { value, expires: now.getTime() + TTL });
  return value;
}

/** Link do horário no card: já abre a confirmação com tudo escolhido. */
export function slotPath(
  listing: Pick<Listing, "isRental" | "headlineOfferingId">,
  date: string,
  slot: FreeSlot,
  ref: string,
): string {
  const params = new URLSearchParams({
    servico: listing.headlineOfferingId ?? "",
    dia: date,
    hora: slot.label,
    [listing.isRental ? "quadra" : "profissional"]: slot.resourceId,
    ref,
  });
  return `/?${params}`;
}

/** "hoje" · "amanhã" · "sáb 21/11" para a legenda do card. */
export function dayCaption(date: string, timezone: string, now = new Date()): string {
  const today = todayIn(timezone, now);
  if (date === toISODate(today)) return "hoje";
  if (date === toISODate(addDays(today, 1))) return "amanhã";
  const d = parseISODate(date)!;
  const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(d.year, d.month - 1, d.day, 12)))
    .replace(".", "");
  return `${wd} ${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}`;
}

export const WHEN_OPTIONS: { value: string; label: string; when: When }[] = [
  { value: "agora", label: "Hoje, a partir de agora", when: { dayOffset: 0, fromHour: null } },
  { value: "hoje-12", label: "Hoje, a partir das 12h", when: { dayOffset: 0, fromHour: 12 } },
  { value: "hoje-18", label: "Hoje, a partir das 18h", when: { dayOffset: 0, fromHour: 18 } },
  { value: "amanha", label: "Amanhã", when: { dayOffset: 1, fromHour: null } },
  { value: "amanha-18", label: "Amanhã, a partir das 18h", when: { dayOffset: 1, fromHour: 18 } },
];

export const NICHE_SLUGS: Record<string, Niche> = {
  barbearia: "BARBERSHOP",
  quadras: "SPORTS_VENUE",
  salao: "SALON",
  estetica: "AESTHETICS",
  pet: "PET",
};
