"use client";

import {
  CalendarDays,
  Hourglass,
  LineChart,
  Monitor,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const ICONS: Record<string, LucideIcon> = {
  agenda: CalendarDays,
  clientes: Users,
  servicos: Hourglass,
  equipe: UserRound,
  financeiro: LineChart,
  pagina: Monitor,
  config: Settings,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

export function PanelNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Painel">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active =
            item.href === "/painel" ? pathname === "/painel" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-control px-3 text-body font-medium whitespace-nowrap text-white/80 hover:bg-white/10 hover:text-white",
                  active && "bg-white/12 text-white",
                )}
              >
                <Icon aria-hidden className="size-5" strokeWidth={2} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
