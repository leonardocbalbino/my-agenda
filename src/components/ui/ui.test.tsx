import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { cents } from "@/lib/money";
import { BOOKING_STATUSES } from "@/modules/booking/status";
import { Button, Chip, EstablishmentCard, SlotButton, StatusBadge } from ".";

/** Compara o textContent de um <p> trocando NBSP (usado em preços e distâncias) por espaço. */
const byText = (expected: string) => (_: string, el: Element | null) =>
  el?.tagName === "P" && el.textContent?.replace(/ /g, " ") === expected;

describe("Button", () => {
  it("é type=button por padrão (não submete form sem querer)", () => {
    render(<Button>Salvar</Button>);
    expect(screen.getByRole("button", { name: "Salvar" })).toHaveAttribute("type", "button");
  });

  it("botão só com ícone é encontrado pelo aria-label", () => {
    render(
      <Button size="icon" aria-label="Compartilhar">
        <svg aria-hidden />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Compartilhar" })).toBeInTheDocument();
  });

  it("variante action usa o laranja de ação", () => {
    render(<Button variant="action">Agendar horário</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-action", "text-on-action");
  });
});

describe("Chip", () => {
  it("expõe estado via aria-pressed", () => {
    render(
      <>
        <Chip selected>Barbearia</Chip>
        <Chip>Estética</Chip>
      </>,
    );
    expect(screen.getByRole("button", { name: "Barbearia" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Estética" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("SlotButton", () => {
  it("livre e selecionado são clicáveis e anunciam aria-pressed", async () => {
    const onClick = vi.fn();
    render(
      <>
        <SlotButton time="09:00" state="free" onClick={onClick} />
        <SlotButton time="09:30" state="selected" />
      </>,
    );
    const free = screen.getByRole("button", { name: "09:00" });
    expect(free).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "09:30" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(free);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ocupado fica disabled, riscado e é anunciado como indisponível", async () => {
    const onClick = vi.fn();
    render(<SlotButton time="10:00" state="taken" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "10:00, indisponível" });
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-pressed");
    expect(within(btn).getByText("10:00")).toHaveClass("line-through");
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("linha da arena mostra preço, ou 'Reservado' quando ocupada", () => {
    render(
      <>
        <SlotButton layout="row" time="20:00 – 21:00" price="R$ 220" state="free" />
        <SlotButton layout="row" time="21:00 – 22:00" price="R$ 220" state="taken" />
      </>,
    );
    expect(screen.getByRole("button", { name: /20:00 – 21:00\s*R\$ 220/ })).toBeEnabled();
    const taken = screen.getByRole("button", { name: /21:00 – 22:00\s*Reservado/ });
    expect(taken).toBeDisabled();
    expect(within(taken).queryByText("R$ 220")).not.toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it.each(BOOKING_STATUSES)("%s tem rótulo em português e classe própria", (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const el = container.firstElementChild!;
    expect(el.textContent).not.toBe("");
    expect(el.className).toMatch(/bg-status-/);
  });

  it("rótulos", () => {
    render(<StatusBadge status="PENDING_PAYMENT" />);
    expect(screen.getByText("Aguardando pagamento")).toBeInTheDocument();
  });
});

describe("EstablishmentCard", () => {
  const base = {
    name: "Barbearia Navalha",
    href: "/navalha",
    nicheLabel: "Barbearia",
    rating: 4.9,
    area: "Pinheiros",
    distanceMeters: 1200,
    price: { kind: "from" as const, amount: cents(4500) },
  };

  it("mostra meta formatada e no máximo 3 horários como links para a confirmação", () => {
    render(
      <EstablishmentCard
        {...base}
        slots={["18:00", "18:30", "19:30", "20:00"].map((t) => ({ label: t, href: `/c/${t}` }))}
      />,
    );
    expect(screen.getByRole("heading", { name: "Barbearia Navalha" })).toBeInTheDocument();
    expect(screen.getByText(byText("Pinheiros · 1,2 km · a partir de R$ 45"))).toBeInTheDocument();
    expect(screen.getByText(/4,9/)).toBeInTheDocument();

    const list = screen.getByRole("list", { name: /Próximos horários livres/ });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAccessibleName("Agendar 18:00 em Barbearia Navalha");
    expect(links[0]).toHaveAttribute("href", "/c/18:00");
  });

  it("preço por hora para quadras", () => {
    render(
      <EstablishmentCard {...base} price={{ kind: "perHour", amount: cents(18000) }} slots={[]} />,
    );
    expect(screen.getByText(byText("Pinheiros · 1,2 km · R$ 180/h"))).toBeInTheDocument();
    expect(screen.getByText("Sem horários livres hoje")).toBeInTheDocument();
  });
});
