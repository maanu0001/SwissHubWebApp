/**
 * Die Auswahl der Schnellnavigation - ohne React.
 *
 * Getrennt von der Komponente, weil hier die einzige Aussage steht, auf die
 * sich jemand verlaesst: **die Palette kennt nur, was die Seitenleiste zeigt.**
 * Das soll sich ohne Browser pruefen lassen.
 */

/**
 * Die Form, in der die Seitenleiste ihre Abschnitte liefert.
 *
 * Strukturell beschrieben statt aus der Komponente importiert: diese Datei
 * soll ohne React uebersetzbar und pruefbar bleiben. `NavigationGroup` aus
 * `sidebar-nav` passt darauf - der Test rechnet beide Listen gegeneinander,
 * und genau das ist die Zusicherung, auf die es ankommt.
 */
export interface PaletteGruppe {
  label: string | null;
  items: ReadonlyArray<{ href: string; label: string; icon: string }>;
}

export interface PaletteEintrag {
  href: string;
  label: string;
  icon: string;
  /** Der Abschnitt, aus dem der Eintrag stammt - als Herkunftsangabe. */
  gruppe: string | null;
}

/**
 * Die Eintraege der Seitenleiste als flache Liste.
 *
 * Sie ist bereits nach Berechtigungen gefiltert - deshalb steht hier keine
 * zweite Pruefung. Die schlimmere Bauart waere die naheliegende: alle
 * Bereiche laden und beim Tippen filtern. Dann stuende die vollstaendige
 * Modulliste im ausgelieferten Bundle jedes Mitglieds.
 */
export function ausGruppen(groups: readonly PaletteGruppe[]): PaletteEintrag[] {
  return groups.flatMap((gruppe) =>
    gruppe.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      gruppe: gruppe.label,
    })),
  );
}

/**
 * Passt der getippte Text auf diesen Eintrag?
 *
 * Bewusst einfach: Teilstring, ohne Gross-/Kleinschreibung, ueber
 * Beschriftung, Adresse und Abschnitt. Eine unscharfe Suche faende bei drei
 * Buchstaben zu viel, und die Frage lautet hier nicht «was koennte gemeint
 * sein», sondern «wo ist der Bereich, dessen Namen ich kenne».
 */
export function passt(eintrag: PaletteEintrag, suche: string): boolean {
  const gesucht = suche.trim().toLowerCase();
  if (gesucht === '') {
    return true;
  }
  return (
    eintrag.label.toLowerCase().includes(gesucht) ||
    eintrag.href.toLowerCase().includes(gesucht) ||
    (eintrag.gruppe?.toLowerCase().includes(gesucht) ?? false)
  );
}
