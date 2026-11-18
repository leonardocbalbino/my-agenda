/**
 * Etapa 8 de ponta a ponta: consentimento para lembretes no WhatsApp e
 * resposta "Confirmo presença" chegando pelo webhook assinado.
 * Usa dias/profissionais diferentes dos outros specs (rodam em paralelo no mesmo banco).
 */
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { WA_APP_SECRET, WA_OUTBOX, WA_VERIFY_TOKEN } from "./env";
import { completeSignIn, newEmail, nextWeekday, root, signIn, tenant } from "./helpers";

test.describe.configure({ mode: "serial" });

const webhook = root("/api/webhooks/whatsapp");
const sign = (body: string) =>
  `sha256=${createHmac("sha256", WA_APP_SECRET).update(body).digest("hex")}`;

function buttonReply(from: string, payload: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                {
                  id: `wamid.e2e.${Date.now()}`,
                  from,
                  type: "button",
                  button: { payload, text: "Confirmo presença" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

async function bookAsCustomer(page: Page) {
  await page.goto(tenant("navalha"));
  await page
    .getByRole("group", { name: "Profissional" })
    .getByRole("button", { name: "Thiago" })
    .click();
  await page.waitForURL(/profissional=/);
  await page.getByRole("group", { name: "Dia" }).getByRole("button").nth(4).click();
  await page.waitForURL(/dia=/);
  await page
    .getByRole("group", { name: "Horário" })
    .locator("button:not([disabled])")
    .first()
    .click();
  await page.waitForURL(/hora=/);
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await completeSignIn(page, newEmail("lembrete"));
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page.getByRole("heading", { name: "Agendamento confirmado" })).toBeVisible();
}

test("cliente ativa lembretes com telefone e aceite, e pode desativar", async ({ page }) => {
  await bookAsCustomer(page);
  const card = page.getByRole("region", { name: "Lembretes no WhatsApp" });
  await expect(card).toContainText("Sem lembrete, a gente avisa por e-mail");

  // Sem aceite: não ativa.
  await card.getByLabel("Celular com DDD").fill("(11) 99876-5432");
  await card.getByRole("button", { name: "Ativar lembretes" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "marque a caixa de aceite" }),
  ).toBeVisible();

  // Telefone inválido: não ativa.
  await card.getByLabel("Celular com DDD").fill("1234");
  await card.getByRole("checkbox").check();
  await card.getByRole("button", { name: "Ativar lembretes" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Telefone inválido" })).toBeVisible();

  await card.getByLabel("Celular com DDD").fill("(11) 99876-5432");
  await card.getByRole("checkbox").check();
  await card.getByRole("button", { name: "Ativar lembretes" }).click();
  await expect(card).toContainText("Ativos para (11) 99876-5432");

  await card.getByRole("button", { name: "Parar lembretes" }).click();
  await expect(card.getByRole("button", { name: "Ativar lembretes" })).toBeVisible();
});

test("webhook: recusa chamada sem assinatura e responde à verificação da Meta", async ({
  request,
}) => {
  const body = buttonReply("5511999990000", "CONFIRM:00000000-0000-0000-0000-000000000000");
  const json = { "content-type": "application/json" };
  expect((await request.post(webhook, { data: body, headers: json })).status()).toBe(401);
  expect(
    (
      await request.post(webhook, {
        data: body,
        headers: { ...json, "x-hub-signature-256": "sha256=00" },
      })
    ).status(),
  ).toBe(401);

  const ok = await request.get(
    `${webhook}?hub.mode=subscribe&hub.verify_token=${WA_VERIFY_TOKEN}&hub.challenge=abc123`,
  );
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe("abc123");
  const bad = await request.get(
    `${webhook}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=x`,
  );
  expect(bad.status()).toBe(403);
});

test("'Confirmo presença' pelo WhatsApp aparece no painel", async ({ page, request }) => {
  await signIn(page, "rafa@navalha.dev", tenant("navalha", "/painel"));
  await page.goto(tenant("navalha", `/painel?dia=${nextWeekday(4)}`)); // próxima quinta

  // Agendamento de balcão com telefone e aceite registrado pelo atendente.
  await page.getByRole("button", { name: "Novo agendamento" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cliente", { exact: true }).fill("Dona Cida");
  await dialog.getByLabel("Telefone (opcional)").fill("(11) 98765-1234");
  await dialog.getByRole("checkbox", { name: /aceita lembretes/ }).check();
  await dialog.getByLabel("Serviço").selectOption({ label: "Corte" });
  await dialog.getByLabel("Com", { exact: true }).selectOption({ label: "Lu" });
  await dialog.getByLabel("Horário").fill("16:15");
  await dialog.getByRole("button", { name: "Agendar" }).click();
  const block = page.getByRole("button", { name: /^Dona Cida, Corte, 16:15/ });
  await expect(block).toBeVisible();
  const bookingId = await block.getAttribute("data-booking");

  // A Meta entrega a resposta do botão, com o número sem o 9º dígito (acontece).
  const body = buttonReply("551187651234", `CONFIRM:${bookingId}`);
  const res = await request.post(webhook, {
    data: body,
    headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
  });
  expect(res.status()).toBe(200);

  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Dona Cida, Corte, 16:15.*presença confirmada$/ }),
  ).toBeVisible();

  // E o cliente recebeu a resposta no WhatsApp.
  const replies = readdirSync(WA_OUTBOX)
    .filter((f) => f.endsWith("-551187651234.json"))
    .map((f) => JSON.parse(readFileSync(path.join(WA_OUTBOX, f), "utf8")) as { text: string });
  expect(replies.some((r) => r.text.startsWith("Presença confirmada!"))).toBe(true);
});
