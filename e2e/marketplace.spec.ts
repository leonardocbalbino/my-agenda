/**
 * Etapa 9 de ponta a ponta: marketplace (/explorar), deep link do horário e
 * atribuição "veio do marketplace" por token assinado.
 * Usa o 3º horário de cada card: os outros specs pegam o 1º livre (rodam em paralelo).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { completeSignIn, newEmail, root, signIn, tenant } from "./helpers";

const card = (page: Page, name: string) =>
  page.getByRole("article").filter({ has: page.getByRole("heading", { name }) });

/** Abre o painel do dono no dia da reserva e devolve o texto do diálogo do bloco do cliente. */
async function panelDetails(
  browser: Browser,
  owner: string,
  slug: string,
  day: string,
  customer: string,
) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  await signIn(page, owner, tenant(slug, "/painel"));
  await page.goto(tenant(slug, `/painel?dia=${day}`));
  await page.locator("[data-booking]").filter({ hasText: customer }).first().click();
  const text = await page.getByRole("dialog").innerText();
  await ctx.close();
  return text;
}

test("filtros e busca", async ({ page }) => {
  await page.goto(root("/explorar?quando=amanha"));
  await expect(card(page, "Barbearia Navalha")).toBeVisible();
  await expect(card(page, "Arena Beira-Rio")).toBeVisible();

  const filters = page.getByRole("navigation", { name: "Filtrar por tipo de negócio" });
  await filters.getByRole("link", { name: "Quadras" }).click();
  await expect(filters.getByRole("link", { name: "Quadras" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(card(page, "Arena Beira-Rio")).toBeVisible();
  await expect(card(page, "Barbearia Navalha")).toHaveCount(0);

  await page.goto(root("/explorar"));
  const search = page.getByRole("search");
  await search.getByLabel("O quê").fill("corte");
  await search.getByRole("button", { name: "Buscar horários" }).click();
  await page.waitForURL(/q=corte/);
  await expect(card(page, "Barbearia Navalha")).toBeVisible();
  await expect(card(page, "Arena Beira-Rio")).toHaveCount(0);

  await page.goto(root("/explorar?q=nada-com-isso"));
  await expect(page.getByText("Nenhum lugar encontrado com esses filtros.")).toBeVisible();
});

test("tocar no horário abre a confirmação com tudo escolhido e a reserva conta como marketplace", async ({
  page,
  browser,
}) => {
  await page.goto(root("/explorar?quando=amanha"));
  const navalha = card(page, "Barbearia Navalha");
  await expect(navalha.getByText(/^próximos livres /)).toBeVisible();
  const slots = navalha.getByRole("list", { name: /Próximos horários livres/ }).getByRole("link");
  await expect(slots).toHaveCount(3);
  const time = (await slots.nth(2).innerText()).trim();
  await slots.nth(2).click();

  // Página do tenant já com serviço, profissional, dia e hora escolhidos.
  await page.waitForURL(/navalha\..*[?&]ref=/);
  const url = new URL(page.url());
  expect(url.searchParams.get("hora")).toBe(time);
  expect(url.searchParams.get("profissional")).toBeTruthy();
  const footer = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Confirmar agendamento" }) });
  await expect(footer).toContainText(time);
  await expect(page.getByRole("button", { name: "Confirmar agendamento" })).toBeEnabled();

  const email = newEmail("mkt");
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await completeSignIn(page, email);
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();

  const details = await panelDetails(
    browser,
    "rafa@navalha.dev",
    "navalha",
    url.searchParams.get("dia")!,
    email.split("@")[0],
  );
  expect(details).toContain("veio do marketplace");
});

test("token de origem adulterado não conta como marketplace", async ({ page, browser }) => {
  await page.goto(root("/explorar?quando=amanha"));
  const slots = card(page, "Arena Beira-Rio")
    .getByRole("list", { name: /Próximos horários livres/ })
    .getByRole("link");
  const href = (await slots.nth(2).getAttribute("href"))!;
  const u = new URL(href);
  const ref = u.searchParams.get("ref")!;
  u.searchParams.set("ref", `${ref.slice(0, -3)}${ref.endsWith("A") ? "B" : "A"}AA`);
  await page.goto(u.toString());

  const email = newEmail("forjado");
  await page.getByRole("button", { name: /Pagar sinal no Pix/ }).click();
  await completeSignIn(page, email);
  await page.getByRole("button", { name: /Pagar sinal no Pix/ }).click();
  await expect(page.getByRole("heading", { name: "Falta o pagamento" })).toBeVisible();

  const details = await panelDetails(
    browser,
    "marcos@beirario.dev",
    "arenabeirario",
    u.searchParams.get("dia")!,
    email.split("@")[0],
  );
  expect(details).not.toContain("veio do marketplace");
});
