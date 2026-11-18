import { NextResponse } from "next/server";
import { rootUrl } from "@/lib/urls";
import { getAuth } from "@/modules/identity/auth";

/**
 * Logout por POST de formulário, para funcionar a partir de qualquer subdomínio
 * (uma chamada fetch cross-origin para /api/auth seria barrada pelo navegador).
 * Repassa os Set-Cookie do Better Auth, que apagam o cookie no domínio raiz.
 */
export async function POST(request: Request) {
  const res = await getAuth().api.signOut({ headers: request.headers, asResponse: true });
  const out = NextResponse.redirect(rootUrl("/"), 303);
  for (const cookie of res.headers.getSetCookie()) out.headers.append("set-cookie", cookie);
  return out;
}
