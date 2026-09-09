'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Ban, Check, Eye, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { explainPermission, type PermissionExplanation } from '@swisshub/permissions/engine';
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
  /** Ausdruecklich erteilte Berechtigungen. */
  permissions: string[];
  /** Ausdrueckliche Ausnahmen - sie schlagen Vollzugriff und Wildcards. */
  deniedPermissions: string[];
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
 *
 * Jede Zeile hat genau einen von vier Zustaenden, und jeder davon nennt seinen
 * Grund: einzeln erteilt, durch Vollzugriff oder eine Wildcard eingeschlossen,
 * ausdruecklich verweigert, oder gar nicht erteilt. Ein Haekchen ohne
 * erkennbare Herkunft waere schlimmer als keines - man wuesste nicht, ob ein
 * Klick etwas aendert.
 *
 * Der Klick richtet sich danach, was gerade gilt: was eingeschlossen ist, wird
 * zur Ausnahme; was Ausnahme ist, wird wieder eingeschlossen. Beurteilt wird
 * das von derselben Funktion wie im Server - eine zweite Regel im Browser
 * liefe irgendwann auseinander, und dann zeigte die Oberflaeche etwas anderes
 * an, als tatsaechlich gilt.
 */
export function PermissionMatrix({
  csrfToken,
  roles,
  managed,
  abweichungen,
  permissions,
  presets,
  moduleLabels,
  canEdit,
}: {
  csrfToken: string;
  roles: RoleOption[];
  managed: ManagedRoleState[];
  /**
   * Rollen, deren Rechte hinter ihrer Vorlage zurueckliegen.
   *
   * Serverseitig berechnet, weil die Vorlagen dort aufgeloest werden - der
   * Browser kennt die Registry nicht.
   */
  abweichungen: Record<string, { presetLabel: string; fehlend: string[] }>;
  permissions: PermissionView[];
  presets: PresetView[];
  moduleLabels: Record<string, string>;
  canEdit: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(managed[0]?.discordRoleId ?? null);
  // Die Abweichung der gerade gewaehlten Rolle - sie steht neben der
  // Vorlagenauswahl, also genau dort, wo man sie beheben kann.
  const abweichung = selectedRoleId ? (abweichungen[selectedRoleId] ?? null) : null;
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
        deniedPermissions: [],
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
    // «Modul sehen» steht in jeder Gruppe zuoberst. Alphabetisch landete es
    // irgendwo in der Mitte, und es ist die Berechtigung, ohne die keine
    // andere dieser Gruppe jemandem etwas nuetzt.
    return [...map.entries()].map(
      ([module, entries]) =>
        [
          module,
          [...entries].sort((a, b) => {
            const aSehen = a.key.endsWith('.module.view');
            const bSehen = b.key.endsWith('.module.view');
            return aSehen === bSehen ? 0 : aSehen ? -1 : 1;
          }),
        ] as [string, PermissionView[]],
    );
  }, [permissions, query]);

  const hasFullAccess = draft?.permissions.includes(ADMIN_FULL) ?? false;

  /**
   * Wie jede einzelne Berechtigung nach dem Speichern zustande kaeme.
   *
   * `isOwner` ist hier bewusst `false`: bewertet wird eine Rolle, nicht eine
   * Person. Der System-Owner haengt nicht an dieser Rolle, und ein Haekchen,
   * das nur deshalb gruen waere, weil gerade der Owner zuschaut, wuerde die
   * Konfiguration falsch darstellen.
   */
  const erklaerungen = useMemo(() => {
    const granted = new Set(draft?.permissions ?? []);
    const denied = new Set(draft?.deniedPermissions ?? []);
    const map = new Map<string, PermissionExplanation>();
    for (const permission of permissions) {
      map.set(permission.key, explainPermission({ isOwner: false, granted, denied }, permission.key));
    }
    return map;
  }, [draft, permissions]);

  /** Was die Rolle nach dem Speichern effektiv darf (Wildcards aufgelöst). */
  const effective = useMemo(
    () =>
      permissions
        .map((permission) => permission.key)
        .filter((key) => erklaerungen.get(key)?.allowed ?? false),
    [permissions, erklaerungen],
  );

  /** Berechtigungen, die trotz Vollzugriff oder Wildcard gesperrt sind. */
  const ausnahmen = useMemo(
    () =>
      permissions
        .map((permission) => permission.key)
        .filter((key) => erklaerungen.get(key)?.source === 'EXPLICIT_DENY'),
    [permissions, erklaerungen],
  );

  /**
   * Ein Klick fuehrt den Zustand weiter - abhaengig davon, woher er kommt.
   *
   * Eingeschlossene Berechtigung -> Ausnahme. Ausnahme -> wieder
   * eingeschlossen. Einzeln erteilte -> zurueckgenommen. Nicht erteilte ->
   * erteilt. Das ist der einzige Weg, mit dem sich unter Vollzugriff
   * ueberhaupt etwas abwaehlen laesst: ohne Ausnahme haette das Haekchen
   * keinerlei Wirkung, und genau das war der Zustand vorher.
   */
  const toggle = (key: string): void => {
    if (!draft || !canEdit) {
      return;
    }
    const ohneAusnahme = draft.deniedPermissions.filter((entry) => entry !== key);
    const ohneErlaubnis = draft.permissions.filter((entry) => entry !== key);

    switch (erklaerungen.get(key)?.source) {
      case 'EXPLICIT_DENY':
        setDraft({ ...draft, deniedPermissions: ohneAusnahme });
        return;
      case 'EXPLICIT_ALLOW':
        setDraft({ ...draft, permissions: ohneErlaubnis });
        return;
      case 'FULL_ACCESS':
      case 'WILDCARD':
        setDraft({ ...draft, permissions: ohneErlaubnis, deniedPermissions: [...ohneAusnahme, key] });
        return;
      default:
        setDraft({ ...draft, permissions: [...ohneErlaubnis, key], deniedPermissions: ohneAusnahme });
    }
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
      // Eine Vorlage beschreibt den ganzen Stand der Rolle. Alte Ausnahmen
      // stehen nicht darin und werden deshalb auch nicht mitgeschleppt -
      // serverseitig raeumt die Aktion sie ebenfalls weg.
      setDraft({ ...draft, permissions: response.data.permissions, deniedPermissions: [] });
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
          <SelectContent emptyHint="Noch keine Rollen synchronisiert - unter System → Discord-Sync abgleichen.">
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
                        {entry.permissions.includes(ADMIN_FULL)
                          ? entry.deniedPermissions.length > 0
                            ? `alle − ${entry.deniedPermissions.length}`
                            : 'alle'
                          : entry.permissions.length}
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
              {/*
                Eine Vorlage wird genau einmal angewendet - danach stehen die
                Rechte in der Datenbank und ändern sich nie wieder von selbst.
                Wird die Vorlage später ergänzt, erreicht das diese Rolle nie,
                und niemand sieht es. Genau so ist der Vote Jail für Premium
                liegengeblieben.
              */}
              {abweichung ? (
                <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Diese Rolle stammt aus der Vorlage «{abweichung.presetLabel}». Die Vorlage hat inzwischen{' '}
                    {abweichung.fehlend.length}{' '}
                    {abweichung.fehlend.length === 1 ? 'Berechtigung' : 'Berechtigungen'} mehr:{' '}
                    <span className="font-mono">{abweichung.fehlend.join(', ')}</span>. Erneutes Anwenden
                    trägt sie nach.
                  </span>
                </p>
              ) : null}
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
                Diese Rolle besitzt <strong>Vollzugriff</strong> - jede Berechtigung ist eingeschlossen. Ein
                Klick auf eine eingeschlossene Berechtigung macht daraus eine{' '}
                <strong>ausdrückliche Ausnahme</strong>; alles andere bleibt erlaubt.
                {ausnahmen.length > 0
                  ? ` Aktuell ${ausnahmen.length === 1 ? 'ist 1 Ausnahme' : `sind ${ausnahmen.length} Ausnahmen`} gesetzt.`
                  : ''}
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
                    const erklaerung =
                      erklaerungen.get(permission.key) ??
                      ({
                        permission: permission.key,
                        allowed: false,
                        source: 'NOT_GRANTED',
                        reason: 'Dieser Rolle nicht zugewiesen.',
                      } satisfies PermissionExplanation);
                    const explizit = erklaerung.source === 'EXPLICIT_ALLOW';
                    const verweigert = erklaerung.source === 'EXPLICIT_DENY';
                    const eingeschlossen =
                      erklaerung.source === 'FULL_ACCESS' || erklaerung.source === 'WILDCARD';
                    return (
                      <li key={permission.key}>
                        <button
                          type="button"
                          onClick={() => toggle(permission.key)}
                          disabled={!canEdit}
                          aria-pressed={erklaerung.allowed}
                          title={erklaerung.reason}
                          className={cn(
                            'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-70',
                            explizit
                              ? 'border-primary/50 bg-primary/10'
                              : verweigert
                                ? 'border-destructive/50 bg-destructive/10'
                                : 'border-border hover:bg-muted/40',
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                              explizit
                                ? 'border-primary bg-primary text-primary-foreground'
                                : verweigert
                                  ? 'border-destructive bg-destructive/20 text-destructive'
                                  : eingeschlossen
                                    ? 'border-primary/40 bg-primary/20'
                                    : 'border-input',
                            )}
                            aria-hidden="true"
                          >
                            {verweigert ? (
                              <Ban className="size-3" />
                            ) : erklaerung.allowed ? (
                              <Check className="size-3" />
                            ) : null}
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5 font-medium">
                              <span className={cn(verweigert && 'line-through decoration-destructive/60')}>
                                {permission.label}
                              </span>
                              {permission.critical ? <Badge variant="warning">kritisch</Badge> : null}
                              {verweigert ? <Badge variant="destructive">Ausnahme</Badge> : null}
                              {erklaerung.source === 'FULL_ACCESS' ? (
                                <Badge variant="outline">durch Vollzugriff</Badge>
                              ) : null}
                              {erklaerung.source === 'WILDCARD' ? (
                                <Badge variant="outline">durch {permission.key.split('.')[0]}.*</Badge>
                              ) : null}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {permission.description}
                            </span>
                            {/*
                              Die Begruendung steht an jeder Zeile, nicht nur
                              an den auffaelligen. Sonst bliebe offen, ob ein
                              leeres Kaestchen «nie erteilt» oder «erteilt und
                              wieder gesperrt» heisst - und das ist beim
                              Debuggen genau die Frage.
                            */}
                            <span
                              className={cn(
                                'mt-0.5 block text-xs',
                                verweigert ? 'text-destructive' : 'text-muted-foreground/80',
                              )}
                            >
                              {erklaerung.reason}
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
              Vorschau: {effective.length} von {permissions.length} Berechtigung(en) nach dem Speichern
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {effective.length === 0
                ? 'Diese Rolle hätte keinerlei Zugriff auf das Dashboard.'
                : effective.join(', ')}
            </p>
            {ausnahmen.length > 0 ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                <Ban className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Ausdrücklich verweigert ({ausnahmen.length}):{' '}
                  <span className="font-mono">{ausnahmen.join(', ')}</span>
                </span>
              </p>
            ) : null}
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
