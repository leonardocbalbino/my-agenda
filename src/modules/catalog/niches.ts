export const NICHES = ["BARBERSHOP", "SPORTS_VENUE", "SALON", "AESTHETICS", "PET"] as const;

export type Niche = (typeof NICHES)[number];

export const NICHE_LABEL: Record<Niche, { full: string; short: string }> = {
  BARBERSHOP: { full: "Barbearia", short: "Barbearia" },
  SPORTS_VENUE: { full: "Quadras e arenas", short: "Quadras" },
  SALON: { full: "Salão de beleza", short: "Salão" },
  AESTHETICS: { full: "Estética", short: "Estética" },
  PET: { full: "Pet", short: "Pet" },
};
