"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export type InstitutionalRole = "student" | "teacher";

export interface InstitutionalNavItem {
  label: string;
  href: string;
  activePrefix?: string;
}

export const STUDENT_NAVIGATION: readonly InstitutionalNavItem[] = [
  { label: "Inicio", href: "/student" },
  { label: "Escanear", href: "/student/scan" },
  { label: "Mis asignaturas", href: "/student#asignaturas", activePrefix: "/student/classes" },
  { label: "Perfil", href: "/student/profile" },
];

export const TEACHER_NAVIGATION: readonly InstitutionalNavItem[] = [
  { label: "Inicio", href: "/teacher" },
  { label: "Asignaturas", href: "/teacher#asignaturas", activePrefix: "/teacher/classes" },
  { label: "Perfil", href: "/teacher/profile" },
];

export function isCurrentNavigationItem(pathname: string, item: InstitutionalNavItem): boolean {
  const path = item.href.split("#", 1)[0];
  if (item.activePrefix && pathname.startsWith(item.activePrefix)) return true;
  return pathname === path && !item.href.includes("#");
}

interface InstitutionalHeaderProps {
  context?: string;
  identity?: { name: string; email: string; avatarSrc?: string; href?: string };
  actions?: React.ReactNode;
  compact?: boolean;
  homeLink?: boolean;
  homeHref?: string;
  role?: InstitutionalRole;
}

export function InstitutionalHeader({
  context = "Sistema de Asistencia",
  identity,
  actions,
  compact = false,
  homeLink = true,
  homeHref,
  role,
}: InstitutionalHeaderProps) {
  const pathname = usePathname();
  const menuId = useId();
  const shellRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigation = role === "teacher" ? TEACHER_NAVIGATION : role === "student" ? STUDENT_NAVIGATION : [];
  const resolvedHomeHref = homeHref ?? (role === "teacher" ? "/teacher" : role === "student" ? "/student" : "/");

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !shellRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [menuOpen]);

  const brand = (
    <>
      <Image
        src="/brand/campus-attendance.svg"
        alt="Campus Attendance"
        width={360}
        height={96}
        priority
        className={`${compact ? "h-10" : "h-11"} w-auto shrink-0 sm:h-[52px]`}
      />
      <span className="hidden h-10 w-px bg-[var(--campus-border)] sm:block" aria-hidden="true" />
      <span className="hidden max-w-52 text-sm font-semibold text-[var(--campus-navy)] sm:block">
        {context}
      </span>
    </>
  );
  const identityContent = identity && (
    <>
      <span className="min-w-0 flex-1 text-right">
        <span className="block truncate text-sm font-semibold text-[var(--campus-navy)]">{identity.name}</span>
        <span className="block truncate text-xs text-[var(--campus-muted)]">{identity.email}</span>
      </span>
      {identity.avatarSrc && (
        <Image src={identity.avatarSrc} alt="Foto de perfil" width={40} height={40} className="size-10 shrink-0 rounded-full border border-[var(--campus-border)] bg-white object-cover" />
      )}
      <span className="sr-only">Abrir perfil de {identity.name}</span>
    </>
  );

  return (
    <header ref={shellRef} className="relative z-40 border-b-2 border-[var(--campus-blue-dark)] bg-white">
      <div className={`mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 ${compact ? "py-2.5" : "py-3"}`}>
        {homeLink ? (
          <Link href={resolvedHomeHref} className="flex min-w-0 items-center gap-4 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--campus-blue)]" aria-label="Campus Attendance, inicio">
            {brand}
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-4">{brand}</div>
        )}

        {navigation.length > 0 && (
          <nav aria-label="Navegación principal" className="hidden min-w-0 flex-1 justify-center lg:flex">
            <ul className="flex items-center gap-1">
              {navigation.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
            </ul>
          </nav>
        )}

        <div className="hidden min-w-0 items-center gap-3 lg:flex">
          {identity && (identity.href ? (
            <Link href={identity.href} className="flex min-w-0 max-w-64 items-center gap-2 rounded-[5px] p-1 hover:bg-[var(--campus-neutral-100)] focus-visible:outline-2 focus-visible:outline-[var(--campus-blue)]" aria-label={`Abrir perfil de ${identity.name}`}>
              {identityContent}
            </Link>
          ) : (
            <div className="flex min-w-0 max-w-64 items-center gap-2">{identityContent}</div>
          ))}
          {actions}
        </div>

        {navigation.length > 0 && (
          <button
            type="button"
            className="grid size-11 shrink-0 place-items-center rounded-[4px] border border-[var(--campus-border)] text-[var(--campus-navy)] hover:bg-[var(--campus-neutral-100)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--campus-blue)] lg:hidden"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" className="text-2xl leading-none">{menuOpen ? "×" : "☰"}</span>
          </button>
        )}
        {navigation.length === 0 && <div className="flex min-w-0 items-center gap-3">{identityContent}{actions}</div>}
      </div>

      <div className="bg-[var(--campus-blue-soft)] px-4 py-2 text-center text-xs font-semibold text-[var(--campus-blue-dark)] sm:hidden">
        {context}
      </div>

      {navigation.length > 0 && menuOpen && (
        <div id={menuId} className="absolute inset-x-0 top-full border-b border-[var(--campus-border)] bg-white p-4 shadow-[0_8px_18px_rgb(38_55_70_/_0.10)] lg:hidden">
          <nav aria-label="Navegación móvil">
            <ul className="grid gap-1">
              {navigation.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} mobile onNavigate={() => setMenuOpen(false)} />)}
            </ul>
          </nav>
          {(identity || actions) && (
            <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-[var(--campus-border)] pt-3">
              {identity && (identity.href ? (
                <Link
                  href={identity.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[4px] p-1 focus-visible:outline-2 focus-visible:outline-[var(--campus-blue)]"
                  aria-label={`Abrir perfil de ${identity.name}`}
                >
                  {identityContent}
                </Link>
              ) : <div className="flex min-w-0 flex-1 items-center gap-2">{identityContent}</div>)}
              {actions}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function NavigationLink({ item, pathname, mobile = false, onNavigate }: { item: InstitutionalNavItem; pathname: string; mobile?: boolean; onNavigate?: () => void }) {
  const current = isCurrentNavigationItem(pathname, item);
  return (
    <li>
      <Link
        href={item.href}
        aria-current={current ? "page" : undefined}
        onClick={onNavigate}
        className={`${mobile ? "flex min-h-11 items-center px-3" : "inline-flex min-h-11 items-center border-b-2 px-3"} rounded-[4px] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--campus-blue)] ${current ? mobile ? "bg-[var(--campus-blue-soft)] text-[var(--campus-blue-dark)]" : "border-[var(--campus-blue-dark)] text-[var(--campus-blue-dark)]" : mobile ? "text-[var(--campus-navy)] hover:bg-[var(--campus-neutral-100)]" : "border-transparent text-[var(--campus-navy)] hover:border-[var(--campus-blue-soft)] hover:text-[var(--campus-blue-dark)]"}`}
      >
        {item.label}
      </Link>
    </li>
  );
}

export function InstitutionalFooter() {
  return (
    <footer className="border-t border-[var(--campus-border)] bg-white">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-5 text-sm text-[var(--campus-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="font-semibold text-[var(--campus-navy)]">Campus Attendance · Sistema de Asistencia</p>
        <p>Proyecto universitario de código abierto</p>
      </div>
    </footer>
  );
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: readonly BreadcrumbItem[] }) {
  return (
    <nav aria-label="Ruta de navegación" className="text-sm text-[var(--campus-muted)]">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden="true">/</span>}
              {item.href && !current ? (
                <Link href={item.href} className="rounded-sm underline-offset-4 hover:text-[var(--campus-blue-dark)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--campus-blue)]">{item.label}</Link>
              ) : (
                <span aria-current={current ? "page" : undefined} className={current ? "font-semibold text-[var(--campus-navy)]" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
