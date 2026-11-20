"use client";

import { LocateFixed } from "lucide-react";
import { useState } from "react";

/**
 * "Perto de mim": pede a localização ao navegador, preenche lat/lng do
 * formulário de busca e envia. Sem permissão, avisa e a busca segue por texto.
 */
export function LocateButton({ formId }: { formId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "denied">("idle");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!navigator.geolocation) return setState("denied");
          setState("busy");
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const form = document.getElementById(formId) as HTMLFormElement | null;
              if (!form) return;
              (form.elements.namedItem("lat") as HTMLInputElement).value =
                pos.coords.latitude.toFixed(5);
              (form.elements.namedItem("lng") as HTMLInputElement).value =
                pos.coords.longitude.toFixed(5);
              (form.elements.namedItem("onde") as HTMLInputElement).value = "";
              form.requestSubmit();
            },
            () => setState("denied"),
            { timeout: 10_000, maximumAge: 300_000 },
          );
        }}
        className="flex min-h-11 items-center gap-1.5 rounded-control px-2 text-caption font-semibold text-brand-ink hover:bg-brand-soft"
      >
        <LocateFixed aria-hidden className="size-4" strokeWidth={2} />
        {state === "busy" ? "Localizando…" : "Usar minha localização"}
      </button>
      {state === "denied" && (
        <p role="status" className="px-2 text-caption text-muted">
          Não deu para usar sua localização. Busque pelo bairro ou cidade.
        </p>
      )}
    </>
  );
}
