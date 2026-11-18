/**
 * Etapa 6 de ponta a ponta: painel do estabelecimento (dono da Navalha).
 * O seed coloca a agenda de "hoje" igual ao layout do PDF.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newEmail, nextWeekday, signIn, tenant } from "./helpers";

test.use({ viewport: { width: 1280, height: 1100 } });
test.describe.configure({ mode: "serial" });

const PX = 1.1; // px por minuto na grade
let page: Page;

const column = (name: string) => page.getByRole("region", { name: `Agenda de ${name}` });
const block = (name: RegExp) => page.locator("[data-booking]").filter({ hasText: name });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  page = await context.newPage();
  await signIn(page, "rafa@navalha.dev", tenant("navalha", "/painel"));
  await expect(page.getByText("Agenda da equipe")).toBeVisible();
});
test.afterAll(() => page.context().close());

test("agenda do dia: colunas por profissional, blocos por status e indicadores", async () => {
  for (const name of ["Rafa", "Diego", "Lu", "Thiago"]) await expect(column(name)).toBeVisible();
  await expect(
    column("Rafa").getByRole("button", {
      name: /^Paulo S\., Corte \+ barba, 11:00 às 11:50, Confirmado$/,
    }),
  ).toBeVisible();
  await expect(
    column("Lu").getByRole("button", { name: /^Rodrigo V\..*Aguardando pagamento$/ }),
  ).toBeVisible();
  await expect(page.getByText("Agendamentos hoje")).toBeVisible();
  await expect(page.getByText(/vieram do marketplace/)).toBeVisible();
});

test("arrastar e soltar remarca para outro profissional e horário, e persiste", async () => {
  const card = block(/^Marcos R\./);
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const target = await column("Thiago").boundingBox();
  // Faixa da grade começa às 09:00; 16:00 fica (16-9)*60 min abaixo do topo da coluna.
  const y = target!.y + (16 - 9) * 60 * PX + 6;
  await page.mouse.move(from!.x + 20, from!.y + 5);
  await page.mouse.down();
  await page.mouse.move(from!.x + 60, from!.y + 40, { steps: 5 });
  await page.mouse.move(target!.x + 40, y, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("Agendamento remarcado")).toBeVisible();

  await page.reload();
  await expect(
    column("Thiago").getByRole("button", { name: /^Marcos R\., Corte \+ barba, 16:00 às 16:50/ }),
  ).toBeVisible();
  await expect(
    column("Diego").locator("[data-booking]").filter({ hasText: "Marcos R." }),
  ).toHaveCount(0);
});

test("detalhes: desfazer e marcar falta (ontem)", async () => {
  await page.getByRole("link", { name: "Dia anterior" }).click();
  await page.waitForURL(/dia=/);
  await column("Diego")
    .getByRole("button", { name: /^Caio M\..*Não compareceu$/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Desfazer" }).click();
  await expect(
    column("Diego").getByRole("button", { name: /^Caio M\..*Confirmado$/ }),
  ).toBeVisible();

  await column("Diego")
    .getByRole("button", { name: /^Caio M\./ })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Não compareceu" }).click();
  await expect(
    column("Diego").getByRole("button", { name: /^Caio M\..*Não compareceu$/ }),
  ).toBeVisible();
});

test("novo agendamento de balcão e bloqueio de horário", async () => {
  const day = nextWeekday(3); // próxima quarta
  await page.goto(tenant("navalha", `/painel?dia=${day}`));

  await page.getByRole("button", { name: "Novo agendamento" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cliente", { exact: true }).fill("Seu Zé");
  await dialog.getByLabel("Serviço").selectOption({ label: "Barba" });
  await dialog.getByLabel("Com", { exact: true }).selectOption({ label: "Rafa" });
  await dialog.getByLabel("Horário").fill("10:00");
  await dialog.getByRole("button", { name: "Agendar" }).click();
  await expect(
    column("Rafa").getByRole("button", { name: /^Seu Zé, Barba, 10:00 às 10:25, Confirmado$/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Novo agendamento" }).click();
  await dialog.getByRole("button", { name: "Bloquear horário" }).click();
  await dialog.getByLabel("De quem").selectOption({ label: "Rafa" });
  await dialog.getByLabel("Início").fill("15:00");
  await dialog.getByLabel("Fim").fill("16:00");
  await dialog.getByLabel("Motivo (opcional)").fill("Consulta");
  await dialog.getByRole("button", { name: "Bloquear", exact: true }).click();
  await expect(column("Rafa").getByText("Consulta")).toBeVisible();

  // O horário bloqueado some da página pública.
  const pub = await page.context().newPage();
  const params = new URLSearchParams({ dia: day });
  await pub.goto(tenant("navalha", `/?${params}`));
  await pub
    .getByRole("group", { name: "Profissional" })
    .getByRole("button", { name: "Rafa" })
    .click();
  await pub.waitForURL(/profissional=/);
  await expect(
    pub.getByRole("group", { name: "Horário" }).getByRole("button", { name: /^15:00/ }),
  ).toHaveCount(0);
  await expect(
    pub.getByRole("group", { name: "Horário" }).getByRole("button", { name: "16:00", exact: true }),
  ).toBeVisible();
  await pub.close();

  await column("Rafa")
    .getByRole("button", { name: /Remover bloqueio Consulta/ })
    .click();
  await expect(column("Rafa").getByText("Consulta")).toHaveCount(0);
});

test("cadastrar serviço: validação e aparece na página pública", async () => {
  await page.goto(tenant("navalha", "/painel/servicos/novo"));
  await page.getByLabel("Nome").fill("Pezinho");
  await page.getByLabel("Duração (min)").fill("15");
  await page.getByLabel("Preço (R$)").fill("vinte");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Valor inválido. Ex.: 45,00")).toBeVisible();
  // O que foi digitado continua lá (o React 19 limparia o formulário).
  await expect(page.getByLabel("Nome")).toHaveValue("Pezinho");
  await expect(page.getByLabel("Duração (min)")).toHaveValue("15");

  await page.getByLabel("Preço (R$)").fill("20,00");
  for (const name of ["Diego", "Lu", "Thiago"])
    await page.getByRole("checkbox", { name }).uncheck();
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.waitForURL(/\/painel\/servicos$/);
  await expect(page.getByRole("link", { name: /Pezinho/ })).toContainText("R$ 20");
  await expect(page.getByRole("link", { name: /Pezinho/ })).toContainText("Rafa");

  await page.goto(tenant("navalha", "/"));
  await expect(page.getByRole("button", { name: /^Pezinho 15 min R\$ 20$/ })).toBeVisible();
});

test("jornada semanal: abrir no domingo e salvar", async () => {
  await page.goto(tenant("navalha", "/painel/equipe"));
  await page.getByRole("link", { name: /^Lu/ }).click();
  await page.waitForURL(/\/painel\/equipe\/[0-9a-f-]{36}$/);
  const sunday = page.getByRole("listitem").filter({ hasText: /^Domingo/ });
  await sunday.getByRole("button", { name: "Faixa" }).click();
  await page.getByRole("button", { name: "Salvar horários" }).click();
  await expect(page.getByText("Horários salvos")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Domingo: início")).toHaveValue("09:00");
});

test("equipe: adicionar e remover pessoa", async () => {
  const email = newEmail("equipe");
  await page.goto(tenant("navalha", "/painel/equipe"));
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Agenda", { exact: true }).selectOption({ label: "Lu" });
  await page.getByRole("button", { name: "Adicionar à equipe" }).click();
  await expect(page.getByText("Pessoa adicionada")).toBeVisible();
  await expect(page.getByText(`${email} · Equipe · agenda de Lu`)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`Remover ${email.split("@")[0]}`) }).click();
  await expect(page.getByText(`${email} · Equipe`)).toHaveCount(0);
});

for (const path of ["/painel", "/painel/servicos/novo", "/painel/equipe", "/painel/clientes"]) {
  test(`${path} não tem violações de acessibilidade (WCAG 2.2 AA)`, async () => {
    await page.goto(tenant("navalha", path));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });
}
