import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { E2E_ROOT, OUTBOX } from "./env";

export const root = (p = "/") => `http://${E2E_ROOT}${p}`;
export const tenant = (slug: string, p = "/") => `http://${slug}.${E2E_ROOT}${p}`;
export const newEmail = (prefix = "e2e") => `${prefix}-${randomUUID().slice(0, 8)}@teste.dev`;

export function latestLinkFor(email: string): string {
  const files = readdirSync(OUTBOX)
    .filter((f) => f.endsWith(`-${email}.json`))
    .sort();
  const msg = JSON.parse(readFileSync(path.join(OUTBOX, files.at(-1)!), "utf8")) as {
    text: string;
  };
  return /https?:\/\/\S+/.exec(msg.text)![0];
}

/** Já na tela /entrar: pede o link mágico e abre. */
export async function completeSignIn(page: Page, email: string) {
  await expect(page).toHaveURL(new RegExp(`^${root("/entrar").replace(/[.?]/g, "\$&")}`));
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Receber link de acesso" }).click();
  await expect(page.getByRole("heading", { name: "Confira seu e-mail" })).toBeVisible();
  await page.goto(latestLinkFor(email));
}

/** Abre uma página protegida, faz login e volta para ela. */
export async function signIn(page: Page, email: string, from: string) {
  await page.goto(from);
  await completeSignIn(page, email);
}
