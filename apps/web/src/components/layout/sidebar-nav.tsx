'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { NavIcon } from './nav-icon';
import { cn } from '@/lib/utils';

export interface NavigationEntry {
  href: string;
  label: string;
  icon: string;
  moduleId: string;
  group: string;
  /** Statisches Label rechts im Eintrag, z.B. `NEU`. */
  badge?: string;
  /** Zahl rechts im Eintrag - derzeit nur die offenen Tickets. */
  count?: number;
}

export interface NavigationGroup {
  id: string;
  label: string | null;
  /** Darf dieser Abschnitt zugeklappt werden? */
  collapsible?: boolean;
  items: NavigationEntry[];
}

/**
 * Wo der zugeklappte Zustand liegt.
 *
 * Im Browser und nicht in der Datenbank: es ist eine Gewohnheit an diesem
 * Geraet, keine Eigenschaft der Person. Ein Feld dafuer waere eine
 * Datenbankmigration fuer eine Anzeigevorliebe.
 */
const SPEICHER = 'swisshub:sidebar:zu';

/**
 * Welche Abschnitte zugeklappt sind.
 *
 * Bewusst «zu» und nicht «offen»: die Vorgabe ist offen, und was gespeichert
 * wird, ist die Abweichung davon. Ein neuer Abschnitt ist damit sichtbar,
 * ohne dass jemand ihn erst aufklappen muss.
 */
function useZugeklappt(): [ReadonlySet<string>, (id: string) => void] {
  const [zu, setZu] = useState<ReadonlySet<string>>(() => new Set());

  // Erst nach dem ersten Rendern lesen: der Server kennt den Speicher des
  // Browsers nicht, und ein Unterschied zwischen beiden waere ein
  // Hydrationsfehler.
  useEffect(() => {
    try {
      const roh = window.localStorage.getItem(SPEICHER);
      if (roh) {
        const gelesen: unknown = JSON.parse(roh);
        if (Array.isArray(gelesen)) {
          setZu(new Set(gelesen.filter((eintrag): eintrag is string => typeof eintrag === 'string')));
        }
      }
    } catch {
      // Privater Modus, gesperrter Speicher, kaputter Eintrag: dann bleibt
      // alles offen. Das ist der brauchbare Zustand, nicht der Fehlerfall.
    }
  }, []);

  const umschalten = useCallback((id: string) => {
    setZu((bisher) => {
      const naechster = new Set(bisher);
      if (naechster.has(id)) {
        naechster.delete(id);
      } else {
        naechster.add(id);
      }
      try {
        window.localStorage.setItem(SPEICHER, JSON.stringify([...naechster]));
      } catch {
        // Nicht speichern zu koennen ist kein Grund, nicht zuzuklappen.
      }
      return naechster;
    });
  }, []);

  return [zu, umschalten];
}

/**
 * Das Label rechts im Navigationseintrag.
 *
 * Eine Zahl hat hier nur Platz, wenn sie vor dem Klick etwas beantwortet -
 * bei den Tickets: wartet dort Arbeit? Am Jail-Eintrag stand einmal die
 * Anzahl aller Strafen; die beantwortete keine solche Frage und liess die
 * Navigation bei jedem Seitenaufruf wackeln. Sie steht weiterhin im Modul,
 * wo sie hingehoert.
 *
 * Bei null erscheint nichts - eine Null neben einem Eintrag ist eine leere
 * Huelse, die man trotzdem jedes Mal liest.
 */
function ItemBadge({ entry }: { entry: NavigationEntry }): React.JSX.Element | null {
  if (typeof entry.count === 'number' && entry.count > 0) {
    return (
      <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-md bg-primary px-1.5 text-[0.7rem] font-semibold text-primary-foreground shadow-[0_0_12px_-2px_hsl(var(--primary-bright))]">
        {entry.count > 99 ? '99+' : entry.count}
      </span>
    );
  }
  if (entry.badge) {
    const highlight = entry.badge.toLowerCase() === 'neu';
    return (
      <span
        className={cn(
          'ml-auto rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide',
          highlight
            ? 'bg-primary/20 text-primary-bright ring-1 ring-primary/40'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {entry.badge}
      </span>
    );
  }
  return null;
}

/** Navigationsliste der Seitenleiste, gruppiert nach Bereichen. */
export function SidebarNav({
  groups,
  collapsed = false,
  onNavigate,
  /**
   * Fingerbedienung statt Mauszeiger.
   *
   * Auf dem Telefon wird nicht gezielt, sondern getippt: dieselben Eintraege
   * bekommen mehr Hoehe und mehr Abstand. Die Reihenfolge, die Gruppen und
   * die Sichtbarkeit bleiben identisch - es ist dieselbe Navigation, nur mit
   * groesseren Zielen. Eine eigene mobile Liste waere eine zweite, die
   * irgendwann etwas anderes zeigt.
   */
  touch = false,
}: {
  groups: NavigationGroup[];
  collapsed?: boolean;
  onNavigate?: () => void;
  touch?: boolean;
}): React.JSX.Element {
  const pathname = usePathname();

  /**
   * Genau ein Eintrag ist aktiv - der mit dem längsten passenden Pfad.
   *
   * Ohne diese Regel würde `/settings/branding` auch `/settings` markieren und
   * `/communication/history` zusätzlich `/communication`; die Seitenleiste
   * zeigte dann zwei aktive Punkte gleichzeitig.
   */
  const activeHref = useMemo(() => {
    const matches = groups
      .flatMap((group) => group.items)
      .map((item) => item.href)
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length);
    return matches[0] ?? null;
  }, [groups, pathname]);

  const [zugeklappt, umschalten] = useZugeklappt();

  return (
    <nav aria-label="Hauptnavigation" className={cn('flex flex-col', touch ? 'gap-6' : 'gap-5')}>
      {groups.map((group) => {
        /*
         * Der Abschnitt der aktuellen Seite bleibt offen.
         *
         * Sonst waere die Seitenleiste an genau der Stelle zu, an der man
         * gerade arbeitet - man saehe nicht mehr, wo man ist, und muesste
         * jedes Mal aufklappen, um sich zu orientieren.
         */
        const enthaeltAktiven = group.items.some((item) => item.href === activeHref);
        const kannZu = (group.collapsible ?? false) && !collapsed && group.label !== null;
        const offen = !kannZu || !zugeklappt.has(group.id) || enthaeltAktiven;
        const listenId = `sidebar-gruppe-${group.id}`;

        return (
          <div key={group.id} className="flex flex-col gap-1">
            {group.label && !collapsed ? (
              kannZu ? (
                <button
                  type="button"
                  onClick={() => umschalten(group.id)}
                  aria-expanded={offen}
                  aria-controls={listenId}
                  className="group/kopf flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-left text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate">{group.label}</span>
                  {/*
                    Immer sichtbar, nur leise.

                    Zuerst erschien der Pfeil erst beim Darueberfahren - auf
                    einem Telefon also nie, und dort haette niemand erfahren,
                    dass sich Abschnitte zuklappen lassen. Eine Bedienung, die
                    man nur mit der Maus findet, ist auf dem halben
                    Geraetepark keine.
                  */}
                  <ChevronDown
                    className={cn(
                      'size-3 shrink-0 text-muted-foreground/40 transition-transform',
                      !offen && '-rotate-90',
                    )}
                    aria-hidden="true"
                  />
                  {/*
                    Die Zahl erscheint nur am zugeklappten Abschnitt. Offen
                    steht sie neben dem, was man ohnehin sieht - zugeklappt
                    sagt sie, wie viel dahinter liegt.
                  */}
                  {!offen ? (
                    <span className="ml-auto text-[0.65rem] tabular-nums text-muted-foreground/50">
                      {group.items.length}
                    </span>
                  ) : null}
                </button>
              ) : (
                <p className="px-3 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                  {group.label}
                </p>
              )
            ) : null}

            <div id={listenId} className={cn('flex flex-col gap-0.5', !offen && 'hidden')}>
              {group.items.map((item) => {
                const active = item.href === activeHref;

                return (
                  <Link
                    key={`${item.moduleId}-${item.href}`}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      // Ruhiger Grundzustand: kein Rahmen, kein Hintergrund.
                      // Ein Eintrag, der schon im Ruhezustand eine Flaeche
                      // hat, macht eine Liste aus 32 Kacheln.
                      'group relative flex items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                      // 44px ist die kleinste Flaeche, die ein Daumen sicher
                      // trifft - darunter tippt man daneben.
                      touch ? 'min-h-11 py-2.5 text-[0.95rem]' : 'py-2',
                      collapsed && 'justify-center px-2',
                      active
                        ? 'bg-primary/10 font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    {/*
                      Der aktive Eintrag traegt einen Balken statt eines
                      Leuchtrahmens. Er ist an derselben Stelle wie in jedem
                      anderen Abschnitt - das Auge findet ihn beim
                      Ueberfliegen, ohne dass die Flaeche leuchten muss.
                    */}
                    {active ? (
                      <span
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary-bright"
                        aria-hidden="true"
                      />
                    ) : null}
                    <NavIcon
                      name={item.icon}
                      className={cn(
                        'size-[1.05rem] shrink-0 transition-colors',
                        active
                          ? 'text-primary-bright'
                          : 'text-muted-foreground/70 group-hover:text-foreground',
                      )}
                    />
                    {collapsed ? null : (
                      <>
                        <span className="truncate">{item.label}</span>
                        <ItemBadge entry={item} />
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
