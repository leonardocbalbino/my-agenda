# Marcaí (nome provisório)

Plataforma SaaS multi-tenant de agendamentos: marketplace, página do estabelecimento,
painel e backoffice num único app Next.js.

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 · componentes no
padrão shadcn/ui (cva + `cn`) · Drizzle + PostgreSQL 16/PostGIS · Better Auth ·
Redis/BullMQ · Vitest · Playwright + axe.

## Rodando

```bash
pnpm install
cp .env.example .env
pnpm db:up                # Postgres 16 + PostGIS e Redis (Docker)
pnpm db:setup             # papéis, banco e extensões (superusuário, idempotente)
pnpm db:migrate           # migrations como marcai_migrator
pnpm db:seed              # Barbearia Navalha + Arena Beira-Rio, agenda de hoje
pnpm dev                  # http://localhost:3000 · design system em /design
```

`pnpm db:reset` recria o banco do zero (setup --reset + migrate + seed).

## Banco e multi-tenancy

- Três papéis: `marcai_migrator` (dono das tabelas, roda migrations/seed), `marcai_app`
  (aplicação) e `marcai_public` (NOLOGIN, dono da view `public_listings`). Nenhum papel
  que faz login tem BYPASSRLS; as tabelas de tenant usam `FORCE ROW LEVEL SECURITY`, então
  nem o dono escapa do RLS.
- Acesso a dados de tenant sempre por `withTenant(db, tenantId, fn)` / `withContext(...)`
  (`src/modules/tenancy/context.ts`), que faz `set_config('app.tenant_id', ..., true)` local à
  transação.
- Referências entre tabelas de tenant são FKs compostas `(tenant_id, id)`.
- Tabelas: schema em `src/db/schema` → `pnpm db:generate`. RLS, constraints, grants e views:
  migration SQL custom (`pnpm exec drizzle-kit generate --custom --name=...`).
- Toda tabela nova com `tenant_id` precisa de RLS + policy: o teste de integração
  falha se faltar.

| Script           | O que faz                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm test`      | Testes unitários (Vitest)                                                                         |
| `pnpm test:int`  | Integração contra Postgres real (`marcai_test`, recriado a cada execução): RLS e double-booking   |
| `pnpm test:e2e`  | Build de produção + acessibilidade (axe, WCAG 2.2 AA) e alvos de toque ≥ 44px, em desktop e 390px |
| `pnpm typecheck` | `tsc --noEmit`                                                                                    |
| `pnpm lint`      | ESLint                                                                                            |
| `pnpm format`    | Prettier (ordena classes Tailwind)                                                                |

## Estrutura

```
src/
  app/                 rotas (superfícies entram como route groups nas próximas etapas)
    design/            vitrine do design system (só em dev, ou ENABLE_DESIGN_PAGE=1)
  components/
    ui/                Button, Chip, SlotButton, StatusBadge, EstablishmentCard
    brand/             Logo
  lib/
    brand.ts           brandTokens(): tokens de marca do tenant com contraste AA garantido
    money.ts           Cents (inteiro) + formatBRL, sem float
    format.ts, cn.ts
  modules/             monolito modular: importe só do index.ts de cada módulo
    tenancy catalog scheduling booking payments notifications marketplace billing
e2e/                   Playwright
```

## Design system

Tokens em `src/app/globals.css` (`:root` + `@theme inline`), expostos como utilities:
`bg-brand`, `text-brand-ink`, `bg-action`, `bg-status-confirmed`, `rounded-card`,
`text-display`/`title`/`heading`/`body-lg`/`body`/`caption`, `tabular`, `shadow-float`.

- Na página do tenant, aplique `style={brandStyle(tenant.brandColor)}` num ancestral. Só
  `--brand`, `--brand-soft`, `--brand-ink` e `--on-brand` mudam; `--action` e status, nunca.
- `variant="action"` (laranja) é exclusivo do CTA principal: Agendar, Confirmar, Pagar.
- Valores monetários: sempre `Cents` (inteiro). Nunca float.

## Hosts, login e permissões

Em dev, o domínio raiz é `marcai.localhost:3000` (`*.localhost` resolve sozinho no navegador):

| URL                                    | Superfície                            |
| -------------------------------------- | ------------------------------------- |
| `http://marcai.localhost:3000`         | raiz: landing, login (`/entrar`)      |
| `http://navalha.marcai.localhost:3000` | página do tenant (`/painel` = painel) |
| `http://admin.marcai.localhost:3000`   | backoffice (SUPER_ADMIN)              |

- `src/proxy.ts` só **roteia** pelo Host (rewrite para `/t/{slug}` ou `/admin`). Quem autoriza
  são os guards em `src/modules/identity/guards.ts`, chamados em cada página, Server Action e
  Route Handler protegidos.
- Login por e-mail mágico (e Google, se `GOOGLE_CLIENT_ID/SECRET` estiverem definidos). Em dev o
  link aparece no terminal do `pnpm dev`; com `DEV_EMAIL_OUTBOX=pasta`, também vira um JSON nessa
  pasta.
- O cookie de sessão vale no domínio raiz e em todos os subdomínios. Domínio customizado ainda não
  compartilha login (Etapa 10).
- Contas do seed: `rafa@navalha.dev` (dono), `carla@navalha.dev` (gerente), `diego@navalha.dev`
  (equipe), `marcos@beirario.dev` (dono da arena), `cliente@marcai.dev`, `admin@marcai.dev`.
- Os redirects pós-login (`callbackURL`) são validados por `src/modules/identity/redirects.ts`:
  só caminhos relativos, a raiz, `admin.` e `{slug}.` da plataforma.

## Agendamento e jobs

- Página pública do tenant (`{slug}.<raiz>/`): barbearia/salão (serviço → profissional → dia e
  horário) ou arena (quadra → dia → slot de 1h, mensalista), conforme as ofertas do tenant. A
  escolha fica na URL (`?servico=&profissional=&dia=&hora=`, `?quadra=&mensal=1`), então um link
  já abre com tudo selecionado.
- `createBooking` (`src/modules/booking/service.ts`) revalida o horário no motor, escolhe o
  profissional em "Qualquer" e grava. A trava final é a exclusion constraint do banco.
- Pagamento no local: confirma na hora. Sinal ou integral: fica `PENDING_PAYMENT` por 10 min.
  A expiração tem três camadas: job atrasado por reserva (BullMQ), varredura a cada minuto
  (`expire_pending_bookings()`, papel `marcai_jobs`) e limpeza na hora de reservar.
- Rode o worker junto com o app: `pnpm worker` (precisa de Redis: `pnpm db:up`).
- Cliente cancela até 2h antes (pendente pode desistir a qualquer momento). "Meus agendamentos"
  fica na raiz (`/meus-agendamentos`).

## Painel do estabelecimento

`{slug}.<raiz>/painel` (login com conta que tenha membership no tenant):

- **Agenda:** colunas por profissional/espaço, linhas de 30 min, blocos por status, bloqueios
  em preto. Arrastar e soltar remarca (encaixe de 15 min); clicar abre detalhes com concluir,
  não compareceu, cancelar, confirmar e remarcar por teclado. "Novo agendamento" cria
  agendamento de balcão ou bloqueio de horário. Quatro indicadores do dia.
- **Serviços, Equipe (agendas, jornada semanal, pessoas) e Clientes.** Financeiro, Minha página e
  Configurações aparecem como "em breve".
- Regras em `src/modules/booking/panel.ts` e `src/modules/catalog/admin.ts`: toda ação
  revalida o papel. STAFF só mexe na própria coluna; só o dono adiciona/remove dono; o negócio
  nunca fica sem dono.

## Confirmação e lembretes (WhatsApp / e-mail)

- O worker (`pnpm worker`) procura a cada minuto o que está devido em todos os tenants
  (`due_notifications()`): **confirmação** logo após confirmar ou remarcar, **lembrete 24h** e
  **lembrete 2h** antes. Cada envio é registrado em `notification_log` com chave única
  (reserva, tipo, horário): nada sai em dobro, mesmo com vários workers.
- **Consentimento (LGPD):** WhatsApp só para quem aceitou: o cliente na página do agendamento ou
  o atendente no agendamento de balcão (com o cliente). Responder **PARAR** desliga. Sem WhatsApp
  (ou se falhar), vai por e-mail.
- **Templates na Meta** (categoria Utilidade, `pt_BR`), parâmetros nesta ordem:
  - `marcai_confirmacao`: `Olá, {{1}}! Seu horário em {{2}} está confirmado: {{3}} com {{4}}, {{5}}.`
  - `marcai_lembrete`: `Olá, {{1}}! Lembrete: {{5}} você tem {{3}} com {{4}} em {{2}}.` com dois
    botões de resposta rápida: "Confirmo presença" e "Preciso remarcar".
- **Webhook:** `https://<raiz>/api/webhooks/whatsapp` (assinatura `X-Hub-Signature-256` obrigatória,
  idempotente por mensagem). "Confirmo presença" marca a reserva (o painel mostra); "Preciso
  remarcar" responde com o link da reserva.

## Marketplace

`<raiz>/explorar`: busca por nicho, texto ("O quê": serviço, nome ou bairro, sem acento), lugar
(bairro/cidade ou "Usar minha localização", com distância via PostGIS) e "Quando". Lê só a view
`public_listings` (tenants listados e ativos, colunas públicas).

- Cada card mostra até 3 **horários livres reais** do serviço vitrine (o mais barato), calculados
  pelo motor de disponibilidade; sem horário no dia, mostra o próximo dia aberto. Cache de 1 min.
- Tocar no horário abre a página do estabelecimento com serviço, profissional/quadra, dia e hora
  escolhidos.
- **Origem "marketplace"** (comissão maior): o link leva `?ref=` assinado (HMAC, vale para aquele
  tenant por 6h), conferido de novo na confirmação. Sem token válido, conta como página do
  estabelecimento.
