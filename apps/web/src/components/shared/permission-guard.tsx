'use client';

import { createContext, useContext, useMemo } from 'react';

/**
 * PermissionGuard - reine UX-Hilfe.
 *
 * WICHTIG: Das Ausblenden eines Buttons ist KEINE Sicherheitsmassnahme. Jede
 * Aktion prüft die Berechtigung zusätzlich serverseitig (siehe
 * `src/server/action.ts`).
 */
interface PermissionContextValue {
  permissions: string[];
  has(permission: string): boolean;
}

const PermissionContext = createContext<PermissionContextValue>({
  permissions: [],
  has: () => false,
});

export function PermissionProvider({
  permissions,
  children,
}: {
  permissions: string[];
  children: React.ReactNode;
}): React.JSX.Element {
  const value = useMemo<PermissionContextValue>(() => {
    const owned = new Set(permissions);
    return {
      permissions,
      has: (permission: string) =>
        // Die Liste ist bereits aufgeloest: Vollzugriff und Wildcards stecken
        // darin, ausdrueckliche Ausnahmen sind herausgerechnet. Wildcards hier
        // nochmals selbst aufzuloesen hiesse, eine Ausnahme zu uebergehen -
        // das Element waere sichtbar und der Server wiese den Klick ab.
        owned.has(permission),
    };
  }, [permissions]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions(): PermissionContextValue {
  return useContext(PermissionContext);
}

export function PermissionGuard({
  permission,
  fallback = null,
  children,
}: {
  permission: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const { has } = usePermissions();
  return <>{has(permission) ? children : fallback}</>;
}
