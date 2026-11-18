import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge precisa conhecer a escala tipográfica e os raios customizados.
 * Sem isso, `text-body` seria tratado como cor e `cn("text-body", "text-ink")`
 * descartaria um dos dois.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "heading", "body-lg", "body", "caption"],
      radius: ["card", "control", "pill"],
      shadow: ["float"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
