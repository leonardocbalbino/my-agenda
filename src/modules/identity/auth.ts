import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { getDb, type Db } from "@/db/client";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { protocol, rootDomain, rootHostname, rootUrl } from "@/lib/urls";
import { getEmailProvider, type EmailProvider } from "@/modules/notifications/email";
import { isTrustedRedirect, REDIRECT_PARAMS } from "./redirects";

export interface AuthDeps {
  db: Db;
  email: EmailProvider;
  /** Usado só em testes: sem o plugin de cookies do Next. */
  withNextCookies?: boolean;
}

/**
 * Conta GLOBAL: login único (e-mail mágico ou Google) na raiz, com cookie no
 * domínio raiz para valer em todos os subdomínios ({slug}.marcai.com.br).
 * Domínios customizados não compartilham cookie: o login cruzado entra na Etapa 10.
 */
export function createAuth({ db, email, withNextCookies = true }: AuthDeps) {
  const google =
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined;

  return betterAuth({
    appName: "Marcaí",
    baseURL: rootUrl(),
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    // Só e-mail mágico e Google: sem senha para vazar.
    emailAndPassword: { enabled: false },
    socialProviders: google,
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    user: {
      additionalFields: {
        phone: { type: "string", required: false, input: true },
        // Nunca vem do cliente: só o backoffice/seed define SUPER_ADMIN.
        platformRole: { type: "string", required: false, input: false },
      },
    },
    trustedOrigins: [rootUrl(), `${protocol()}://*.${rootDomain()}`],
    hooks: {
      // Defesa própria contra open redirect (ver redirects.ts).
      before: createAuthMiddleware(async (ctx) => {
        const sources = [ctx.body, ctx.query] as (Record<string, unknown> | undefined)[];
        for (const source of sources) {
          for (const key of REDIRECT_PARAMS) {
            const value = source?.[key];
            if (
              typeof value === "string" &&
              value !== "" &&
              !isTrustedRedirect(value, rootDomain(), protocol())
            ) {
              throw new APIError("BAD_REQUEST", { message: "URL de retorno não permitida" });
            }
          }
        }
      }),
    },
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "marcai",
      crossSubDomainCookies: { enabled: true, domain: rootHostname() },
      useSecureCookies: protocol() === "https",
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        // Padrão (5/min por IP) bloqueia clientes reais atrás do mesmo IP de operadora (CGNAT).
        rateLimit: { window: 60, max: 30 },
        sendMagicLink: async ({ email: to, url }) => {
          await email.send({
            to,
            subject: "Seu link de acesso ao Marcaí",
            text: `Use este link para entrar (vale por 10 minutos):\n${url}\n\nSe não foi você, ignore este e-mail.`,
          });
        },
      }),
      ...(withNextCookies ? [nextCookies()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __marcaiAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__marcaiAuth ??= createAuth({ db: getDb(), email: getEmailProvider() });
  return globalForAuth.__marcaiAuth;
}
