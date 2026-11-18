"use client";

import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { rootUrl } from "./urls";

/** Toda chamada de auth vai para a raiz (cookie no domínio raiz). */
export const authClient = createAuthClient({
  baseURL: rootUrl("/api/auth"),
  fetchOptions: { credentials: "include" },
  plugins: [magicLinkClient()],
});
