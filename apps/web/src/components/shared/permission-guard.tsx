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
        owned.has(permission) || owned.has('admin.full') || owned.has(`${permission.split('.')[0]}.*`),
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
