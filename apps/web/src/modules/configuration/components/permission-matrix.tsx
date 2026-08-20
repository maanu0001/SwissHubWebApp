'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, Eye, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  applyPermissionPresetAction,
  removeManagedRoleAction,
  setRolePermissionsAction,
} from '@/modules/configuration/actions';
import { cn } from '@/lib/utils';
import { roleColor, type RoleOption } from './discord-option-types';

export interface PermissionView {
  key: string;
  label: string;
  description: string;
  module: string;
  critical?: boolean;
}

export interface PresetView {
  id: string;
  label: string;
  description: string;
  critical?: boolean;
}

export interface ManagedRoleState {
  discordRoleId: string;
  label: string;
  permissions: string[];
  isProtected: boolean;
  keepOnJail: boolean;
  moderationLevel: number;
}

const ADMIN_FULL = 'admin.full';

/**
 * Berechtigungsmatrix.
 *
 * Links die Discord-Rollen, rechts was sie im Dashboard dürfen. Vorlagen
 * beschleunigen die häufigen Fälle, die Vorschau zeigt vor dem Speichern, was
 * die Rolle danach tatsächlich darf - inklusive der Wildcards.
 */
export function PermissionMatrix({
  csrfToken,
  roles,
  managed,
  permissions,
  presets,
  moduleLabels,
  canEdit,
}: {
  csrfToken: string;
  roles: RoleOption[];
  managed: ManagedRoleState[];
  permissions: PermissionView[];
  presets: PresetView[];
  moduleLabels: Record<string, string>;
  canEdit: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(managed[0]?.discordRoleId ?? null);
  const [draft, setDraft] = useState<ManagedRoleState | null>(managed[0] ?? null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const selectRole = (roleId: string): void => {
    const existing = managed.find((entry) => entry.discordRoleId === roleId);
    const discordRole = roles.find((entry) => entry.id === roleId);
    setSelectedRoleId(roleId);
    setDraft(
      existing ?? {
        discordRoleId: roleId,
        label: discordRole?.name ?? roleId,
        permissions: [],
        isProtected: false,
        keepOnJail: false,
        moderationLevel: 0,
      },
    );
    setQuery('');
  };

  const grouped = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? permissions.filter(
          (permission) =>
            permission.label.toLowerCase().includes(normalized) ||
            permission.key.toLowerCase().includes(normalized) ||
            permission.description.toLowerCase().includes(normalized),
        )
      : permissions;

    const map = new Map<string, PermissionView[]>();
    for (const permission of filtered) {
      map.set(permission.module, [...(map.get(permission.module) ?? []), permission]);
    }
    return [...map.entries()];
  }, [permissions, query]);

  const hasFullAccess = draft?.permissions.includes(ADMIN_FULL) ?? false;

  /** Was die Rolle nach dem Speichern effektiv darf (Wildcards aufgelöst). */
  const effective = useMemo(() => {
    if (!draft) {
      return [];
    }
    if (hasFullAccess) {
      return permissions.map((permission) => permission.key);
    }
    const wildcards = draft.permissions
      .filter((permission) => permission.endsWith('.*'))
      .map((permission) => permission.slice(0, -2));
    return permissions
      .map((permission) => permission.key)
      .filter((key) => draft.permissions.includes(key) || wildcards.includes(key.split('.')[0] ?? ''));
  }, [draft, hasFullAccess, permissions]);

  const toggle = (key: string): void => {
    if (!draft || !canEdit) {
      return;
    }
    setDraft({
      ...draft,
      permissions: draft.permissions.includes(key)
        ? draft.permissions.filter((entry) => entry !== key)
        : [...draft.permissions, key],
    });
  };

  async function save(): Promise<void> {
    if (!draft || pending) {
      return;
    }
    setPending(true);
    const response = await setRolePermissionsAction({ csrfToken, ...draft });
    setPending(false);

    if (response.ok) {
      toast.success('Berechtigungen gespeichert.');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  async function applyPreset(presetId: string): Promise<void> {
    if (!draft || pending) {
      return;
    }
    setPending(true);
    const response = await applyPermissionPresetAction({
      csrfToken,
      discordRoleId: draft.discordRoleId,
      label: draft.label,
      presetId,
    });
    setPending(false);

    if (response.ok) {
      setDraft({ ...draft, permissions: response.data.permissions });
      toast.success('Vorlage angewendet.');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  async function remove(): Promise<void> {
    if (!draft) {
      return;
    }
    setPending(true);
    const response = await removeManagedRoleAction({ csrfToken, discordRoleId: draft.discordRoleId });
    setPending(false);

    if (response.ok) {
      toast.success('Rolle entfernt.');
      setDraft(null);
      setSelectedRoleId(null);
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="space-y-2">
        <Label htmlFor="permission-role">Discord-Rolle</Label>
        <Select value={selectedRoleId ?? ''} onValueChange={selectRole}>
          <SelectTrigger id="permission-role">
            <SelectValue placeholder="Rolle wählen" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full border border-border"
                    style={{ backgroundColor: roleColor(role.color) ?? 'transparent' }}
                    aria-hidden="true"
                  />
                  {role.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="space-y-1 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bereits konfiguriert
          </p>
          {managed.length === 0 ? (
            <p className="text-xs text-muted-foreground">Noch keine Rolle konfiguriert.</p>
          ) : (
            <ul className="space-y-1">
              {managed.map((entry) => {
                const role = roles.find((item) => item.id === entry.discordRoleId);
                return (
                  <li key={entry.discordRoleId}>
                    <button
                      type="button"
                      onClick={() => selectRole(entry.discordRoleId)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        selectedRoleId === entry.discordRoleId ? 'bg-primary/15' : 'hover:bg-muted/50',
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full border border-border"
                        style={{ backgroundColor: roleColor(role?.color ?? 0) ?? 'transparent' }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{role?.name ?? entry.label}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {entry.permissions.includes(ADMIN_FULL) ? 'alle' : entry.permissions.length}
                      </span>
                    </button>
                    {!role ? (
                      <p className="px-2 text-xs text-destructive">Rolle existiert auf Discord nicht mehr.</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {!draft ? (
        <p className="text-sm text-muted-foreground">
          Bitte links eine Discord-Rolle wählen, um ihre Berechtigungen festzulegen.
        </p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-label">Bezeichnung im Dashboard</Label>
              <Input
                id="role-label"
                value={draft.label}
                maxLength={64}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-preset">Vorlage anwenden</Label>
              <Select
                value=""
                onValueChange={(value) => void applyPreset(value)}
                disabled={!canEdit || pending}
              >
                <SelectTrigger id="role-preset">
                  <SelectValue placeholder="Vorlage wählen …" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                      {preset.critical ? ' (kritisch)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Vorlagen werden sofort gespeichert und ersetzen die bisherige Auswahl.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <div>
                <Label htmlFor="role-protected">Geschützte Rolle</Label>
                <p className="text-xs text-muted-foreground">
                  Mitglieder mit dieser Rolle sind vor Moderation geschützt.
                </p>
              </div>
              <Switch
                id="role-protected"
                checked={draft.isProtected}
                onCheckedChange={(checked) => setDraft({ ...draft, isProtected: checked })}
                disabled={!canEdit}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <div>
                <Label htmlFor="role-keep">Beim Jail behalten</Label>
                <p className="text-xs text-muted-foreground">Rolle bleibt während eines Jails erhalten.</p>
              </div>
              <Switch
                id="role-keep"
                checked={draft.keepOnJail}
                onCheckedChange={(checked) => setDraft({ ...draft, keepOnJail: checked })}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-level">Moderationsstufe</Label>
              <Input
                id="role-level"
                type="number"
                min={0}
                max={1000}
                value={draft.moderationLevel}
                onChange={(event) => setDraft({ ...draft, moderationLevel: Number(event.target.value) || 0 })}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">Höhere Stufe darf niedrigere moderieren.</p>
            </div>
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Berechtigung suchen …"
              className="pl-8"
            />
          </div>

          {hasFullAccess ? (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Diese Rolle besitzt <strong>Vollzugriff</strong>. Einzelne Häkchen wirken sich dadurch nicht
                mehr aus - jede Berechtigung ist eingeschlossen.
              </span>
            </p>
          ) : null}

          <div className="space-y-5">
            {grouped.map(([module, entries]) => (
              <section key={module} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {moduleLabels[module] ?? module}
                </h4>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {entries.map((permission) => {
                    const checked = draft.permissions.includes(permission.key);
                    const implied = !checked && effective.includes(permission.key);
                    return (
                      <li key={permission.key}>
                        <button
                          type="button"
                          onClick={() => toggle(permission.key)}
                          disabled={!canEdit}
                          className={cn(
                            'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-70',
                            checked ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-muted/40',
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                              checked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : implied
                                  ? 'border-primary/40 bg-primary/20'
                                  : 'border-input',
                            )}
                            aria-hidden="true"
                          >
                            {checked || implied ? <Check className="size-3" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5 font-medium">
                              {permission.label}
                              {permission.critical ? <Badge variant="warning">kritisch</Badge> : null}
                              {implied ? <Badge variant="outline">durch Vollzugriff</Badge> : null}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {permission.description}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {grouped.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Berechtigung passt zur Suche.</p>
            ) : null}
          </div>

          <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Eye className="size-3.5" aria-hidden="true" />
              Vorschau: {effective.length} Berechtigung(en) nach dem Speichern
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {effective.length === 0
                ? 'Diese Rolle hätte keinerlei Zugriff auf das Dashboard.'
                : effective.join(', ')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="button" onClick={() => void save()} loading={pending} disabled={!canEdit}>
              Speichern
            </Button>
            {managed.some((entry) => entry.discordRoleId === draft.discordRoleId) ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!canEdit || pending}
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Entfernen
                </Button>
                <ConfirmationDialog
                  open={confirmRemove}
                  onOpenChange={setConfirmRemove}
                  title="Rolle aus der Verwaltung entfernen?"
                  description="Die Rolle verliert damit sämtliche Dashboard-Berechtigungen. Auf Discord ändert sich nichts."
                  confirmLabel="Entfernen"
                  destructive
                  onConfirm={remove}
                />
              </>
            ) : null}
            {!canEdit ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Zum Ändern wird „Berechtigungen verwalten“ benötigt.
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
