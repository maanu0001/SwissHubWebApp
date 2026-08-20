/**
 * Datenformen, die die generische Einstellungsoberfläche vom Server erhält.
 * Bewusst schlank: nur was zur Darstellung nötig ist - keine Berechtigungsbits,
 * keine Mitgliederlisten.
 */
export interface RoleOption {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  deleted: boolean;
  /** Kann der Bot diese Rolle vergeben oder entziehen? */
  manageable: boolean;
}

export interface ChannelOption {
  id: string;
  name: string;
  kind: string | null;
  parentName: string | null;
  deleted: boolean;
}

/** Farbwert von Discord (0 = keine Farbe) in eine CSS-Farbe umwandeln. */
export function roleColor(color: number): string | undefined {
  return color === 0 ? undefined : `#${color.toString(16).padStart(6, '0')}`;
}
