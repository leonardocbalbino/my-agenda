/**
 * Etapa 5 de ponta a ponta: fluxo público de agendamento (barbearia e arena),
 * login no meio do fluxo, reserva pendente com sinal, mensalista, cancelamento
 * e horário disputado por duas pessoas.
 */
import { expect, test, type Page } from "@playwright/test";
import { completeSignIn, newEmail, root, signIn, tenant } from "./helpers";

const slots = (page: Page) => page.getByRole("group", { name: "Horário" });
const footer = (page: Page) =>
  page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: /Confirmar|Pagar|Assinar/ }) });

/** Escolhe serviço, profissional e o 2º dia aberto; devolve o 1º horário livre. */
async function pickBarberSlot(page: Page, service: RegExp, pro: string) {
  await page.goto(tenant("navalha"));
  await page.getByRole("button", { name: service }).click();
  await page.waitForURL(/servico=/);
  await page
    .getByRole("group", { name: "Profissional" })
    .getByRole("button", { name: pro })
    .click();
  await page.waitForURL(/profissional=/);
  await page.getByRole("group", { name: "Dia" }).getByRole("button").nth(1).click();
  await page.waitForURL(/dia=/);
  const slot = slots(page).locator("button:not([disabled])").first();
  const time = (await slot.innerText()).trim();
  await slot.click();
  await page.waitForURL(/hora=/);
  await expect(slot).toHaveAttribute("aria-pressed", "true");
  return time;
}

test.describe("barbearia", () => {
  test("cliente escolhe, faz login no meio do fluxo, confirma, vê em 'Meus agendamentos' e cancela", async ({
    page,
  }) => {
    const time = await pickBarberSlot(page, /^Corte 30 min/, "Diego");
    await expect(footer(page)).toContainText(`Corte · Diego ·`);
    await expect(footer(page)).toContainText(time);
    await expect(footer(page)).toContainText("Pague no local");
    const pageWithChoice = page.url();

    // Sem login: o CTA leva para o login e volta para a mesma escolha.
    await page.getByRole("button", { name: "Confirmar agendamento" }).click();
    await completeSignIn(page, newEmail("barba"));
    await expect(page).toHaveURL(pageWithChoice);

    await page.getByRole("button", { name: "Confirmar agendamento" }).click();
    await expect(page).toHaveURL(/\/agendamento\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
    await expect(page.getByText("Diego", { exact: true })).toBeVisible();
    const bookingUrl = page.url();

    // O horário agora aparece ocupado.
    await page.goto(pageWithChoice);
    await expect(slots(page).getByRole("button", { name: `${time}, indisponível` })).toBeDisabled();

    await page.goto(root("/meus-agendamentos"));
    const item = page.getByRole("link", { name: /Barbearia Navalha/ });
    await expect(item).toContainText("Corte · Diego");
    await expect(item).toContainText("Confirmado");

    await page.goto(bookingUrl);
    await page.getByRole("button", { name: "Cancelar agendamento" }).click();
    await expect(page.getByRole("heading", { name: "Agendamento cancelado" })).toBeVisible();

    // Cancelado libera o horário.
    await page.goto(pageWithChoice.replace(/&?hora=[^&]+/, ""));
    await expect(slots(page).getByRole("button", { name: time, exact: true })).toBeEnabled();
  });

  test("duas pessoas no mesmo horário: a segunda recebe aviso e escolhe outro", async ({
    browser,
  }) => {
    const a = await browser.newPage();
    const b = await browser.newPage();
    try {
      await signIn(a, newEmail("a"), root("/meus-agendamentos"));
      await signIn(b, newEmail("b"), root("/meus-agendamentos"));
      const time = await pickBarberSlot(a, /^Barba 25 min/, "Rafa");
      await b.goto(a.url());
      await expect(slots(b).getByRole("button", { name: time, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await a.getByRole("button", { name: "Confirmar agendamento" }).click();
      await expect(a.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();

      await b.getByRole("button", { name: "Confirmar agendamento" }).click();
      await expect(
        b.getByRole("alert").filter({ hasText: "não está mais disponível" }),
      ).toBeVisible();
      await expect(slots(b).getByRole("button", { name: `${time}, indisponível` })).toBeDisabled();
    } finally {
      await a.close();
      await b.close();
    }
  });
});

test.describe("arena", () => {
  test("horário nobre com sinal de 50%: fica aguardando pagamento e pode desistir", async ({
    page,
  }) => {
    await signIn(page, newEmail("arena"), root("/meus-agendamentos"));
    await page.goto(tenant("arenabeirario"));
    await page.getByRole("group", { name: "Dia" }).getByRole("button").nth(1).click();
    await page.waitForURL(/dia=/);
    await expect(page.getByText("Horário nobre a partir das 18h")).toBeVisible();

    const prime = slots(page)
      .locator("button:not([disabled])", { hasText: /^(18|19|20|21|22|23):00/ })
      .first();
    await expect(prime).toContainText("R$ 220");
    await prime.click();
    await page.waitForURL(/hora=/);

    await page.getByRole("button", { name: "Pagar sinal no Pix · R$ 110" }).click();
    await expect(page.getByRole("heading", { name: "Falta o pagamento" })).toBeVisible();
    await expect(page.getByText("R$ 110,00", { exact: true })).toBeVisible();
    await expect(page.getByText("Aguardando pagamento")).toBeVisible();

    await page.getByRole("button", { name: "Desistir deste horário" }).click();
    await expect(page.getByRole("heading", { name: "Agendamento cancelado" })).toBeVisible();
  });

  test("virar mensalista reserva 4 semanas e cobra o mês", async ({ page }) => {
    await signIn(page, newEmail("mensal"), root("/meus-agendamentos"));
    await page.goto(tenant("arenabeirario"));
    await page.getByRole("group", { name: "Dia" }).getByRole("button").nth(2).click();
    await page.waitForURL(/dia=/);
    const morning = slots(page)
      .locator("button:not([disabled])", { hasText: /^(08|09|10|11):00/ })
      .first();
    await expect(morning).toContainText("R$ 160");
    await morning.click();
    await page.waitForURL(/hora=/);

    await page.getByRole("checkbox", { name: /Virar mensalista/ }).check();
    await page.waitForURL(/mensal=1/);
    await page.getByRole("button", { name: "Assinar com Pix · R$ 640" }).click();
    await expect(page.getByRole("heading", { name: "Falta o pagamento" })).toBeVisible();
    await expect(page.getByText("Society (mensalista)")).toBeVisible();

    await page.goto(root("/meus-agendamentos"));
    await expect(page.getByRole("link", { name: /Arena Beira-Rio/ })).toHaveCount(4);
  });
});
