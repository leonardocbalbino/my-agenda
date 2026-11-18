"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui";

/** Botão de envio que se desabilita enquanto a Server Action roda. */
export function SubmitButton({
  children,
  pendingText,
  ...props
}: ButtonProps & { pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      aria-disabled={pending || props.disabled}
    >
      {pending ? pendingText : children}
    </Button>
  );
}
