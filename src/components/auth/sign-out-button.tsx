import { Button } from "@/components/ui";
import { rootUrl } from "@/lib/urls";

/** Formulário simples: funciona em qualquer subdomínio e sem JavaScript. */
export function SignOutButton() {
  return (
    <form method="post" action={rootUrl("/api/sair")}>
      <Button type="submit" variant="outline">
        Sair
      </Button>
    </form>
  );
}
