import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { Share } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button, EstablishmentCard, StatusBadge, buttonVariants } from "@/components/ui";
import { brandStyle, brandTokens, contrast } from "@/lib/brand";
import { cents } from "@/lib/money";
import { BOOKING_STATUSES } from "@/modules/booking/status";
import { ChipDemo, SlotGridDemo, SlotRowDemo } from "./demos";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

const SWATCHES = [
  { name: "Petróleo 700", token: "--brand", hex: "#0F766E", use: "marca, links, confirmado" },
  { name: "Petróleo 100", token: "--brand-soft", hex: "#CCEDE7", use: "fundos de destaque" },
  { name: "Laranja 700", token: "--action", hex: "#C2410C", use: "CTA principal" },
  { name: "Laranja 100", token: "--action-soft", hex: "#FFEDD5", use: "horário selecionado" },
  { name: "Tinta", token: "--ink", hex: "#121417", use: "texto" },
  { name: "Papel", token: "--paper", hex: "#FAFAF7", use: "fundo · borda #E4E2DC" },
];

const TENANT_SAMPLES = [
  { name: "Barbearia Navalha", hex: "#7A4E24" },
  { name: "Arena Beira-Rio", hex: "#166534" },
  { name: "Studio Amarelo", hex: "#FACC15" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-border pt-10">
      <h2 className="text-heading font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DESIGN_PAGE !== "1") {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="sr-only">Design system do Marcaí</h1>
          <Logo />
          <p className="mt-1 text-body text-muted">Todos os horários da cidade, num lugar só.</p>
        </div>
        <p className="text-caption text-muted">Identidade v0.1 · base 4 px · raio 12 / 16 / 999</p>
      </header>

      <Section title="Cores">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {SWATCHES.map((s) => (
            <li key={s.token}>
              <div
                className="h-20 rounded-card border border-border"
                style={{ backgroundColor: `var(${s.token})` }}
              />
              <p className="mt-2 text-body font-semibold">{s.name}</p>
              <p className="text-caption text-muted">
                <code className="tabular">{s.hex}</code> · {s.use}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-caption text-muted">Status da reserva</span>
          {BOOKING_STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <p className="text-caption text-muted">
          Cada estabelecimento troca o petróleo pela cor da própria marca na página dele. O laranja
          de ação e os status ficam fixos.
        </p>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section title="Tipografia">
          <p className="font-display text-display font-bold">Reserve a quadra das 20h</p>
          <p className="font-display text-title font-bold">Título 32</p>
          <p className="font-display text-heading font-semibold">Título 24</p>
          <p className="text-caption text-muted">Space Grotesk 600/700 · títulos 48 / 32 / 24</p>
          <p className="text-body-lg">
            Inter para todo o resto: listas, formulários, agenda. Números tabulares nos horários e
            preços: <strong className="tabular">09:00 · 10:30 · R$&nbsp;60,00</strong>
          </p>
          <p className="text-caption text-muted">Inter 400/500/600 · corpo 17 / 15 / 13</p>
        </Section>

        <Section title="Botões e chips">
          <div className="flex flex-wrap gap-3">
            <Button variant="action">Agendar horário</Button>
            <Button variant="brand">Salvar</Button>
            <Button variant="outline">Cancelar</Button>
            <Button variant="dark">Entrar</Button>
            <Button variant="ghost" size="icon" aria-label="Compartilhar">
              <Share strokeWidth={2} aria-hidden />
            </Button>
          </div>
          <ChipDemo />
          <p className="text-caption text-muted">Horários: livre · selecionado · ocupado</p>
          <SlotGridDemo />
          <SlotRowDemo />
        </Section>
      </div>

      <Section title="Card de estabelecimento">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <li>
            <EstablishmentCard
              name="Barbearia Navalha"
              href="#navalha"
              nicheLabel="Barbearia"
              rating={4.9}
              area="Pinheiros"
              distanceMeters={1200}
              price={{ kind: "from", amount: cents(4500) }}
              placeholderColor="#1F2A2E"
              slots={[
                { label: "18:00", href: "#navalha-1800" },
                { label: "18:30", href: "#navalha-1830" },
                { label: "19:30", href: "#navalha-1930" },
              ]}
              slotsCaption="próximos livres hoje"
            />
          </li>
          <li>
            <EstablishmentCard
              name="Arena Beira-Rio"
              href="#arena"
              nicheLabel="Quadras"
              rating={4.7}
              area="Society e beach tennis"
              distanceMeters={2800}
              price={{ kind: "perHour", amount: cents(18000) }}
              placeholderColor="#14532D"
              slots={[
                { label: "19:00", href: "#arena-1900" },
                { label: "21:00", href: "#arena-2100" },
                { label: "22:00", href: "#arena-2200" },
              ]}
            />
          </li>
          <li>
            <EstablishmentCard
              name="Studio Lâmina"
              href="#lamina"
              nicheLabel="Salão"
              rating={4.8}
              area="Vila Madalena"
              distanceMeters={850}
              price={{ kind: "from", amount: cents(7000) }}
              placeholderColor="#4A2C2A"
              slots={[]}
            />
          </li>
        </ul>
      </Section>

      <Section title="Marca do tenant">
        <p className="text-body text-muted">
          <code>brandTokens()</code> deriva fundo suave, tinta e texto sobre a marca com contraste
          AA. Uma cor clara (amarelo) passa a usar texto escuro automaticamente.
        </p>
        <ul className="grid gap-4 md:grid-cols-3">
          {TENANT_SAMPLES.map((t) => {
            const tokens = brandTokens(t.hex);
            return (
              <li
                key={t.hex}
                style={brandStyle(t.hex) as CSSProperties}
                className="overflow-hidden rounded-card border border-border bg-surface"
              >
                <div className="bg-brand px-4 py-5 text-on-brand">
                  <p className="font-display text-heading font-bold">{t.name}</p>
                  <p className="text-caption">
                    {t.hex} · texto {contrast(tokens.onBrand, tokens.brand).toFixed(1)}:1
                  </p>
                </div>
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex gap-2">
                    <span className="inline-flex h-11 items-center rounded-control bg-brand-soft px-3.5 font-semibold text-brand-ink tabular">
                      14:00
                    </span>
                    <a
                      href="#marca"
                      className="inline-flex min-h-11 items-center px-1 font-semibold text-brand-ink underline"
                    >
                      Ver serviços
                    </a>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="brand">Salvar</Button>
                    <a href="#marca" className={buttonVariants({ variant: "action" })}>
                      Confirmar
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
    </main>
  );
}
