'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RoleBadge } from '@/components/shared/role-badge';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import { deleteManagedRoleAction, upsertManagedRoleAction } from '@/modules/settings/actions';

export interface PermissionOption {
  key: string;
  label: string;
  description: string;
  module: string;
  critical?: boolean;
}

export interface ManagedRoleView {
  discordRoleId: string;
  label: string;
  isProtected: boolean;
  keepOnJail: boolean;
  moderationLevel: number;
  permissions: string[];
  discordName: string | null;
  discordColor: number;
  existsOnDiscord: boolean;
}

interface RoleEditorProps {
  csrfToken: string;
  managedRoles: ManagedRoleView[];
  discordRoles: Array<{ id: string; name: string; color: number }>;
  permissions: PermissionOption[];
  canEdit: boolean;
}

const EMPTY: ManagedRoleView = {
  discordRoleId: '',
  label: '',
  isProtected: false,
  keepOnJail: false,
  moderationLevel: 0,
  permissions: [],
  discordName: null,
  discordColor: 0,
  existsOnDiscord: true,
};

/**
 * Zuordnung Discord-Rolle -> Permissions.
 *
 * Die Business-Logik fragt nie nach Role-IDs, sondern nach Permissions - hier
 * wird diese Zuordnung zentral gepflegt.
 */
export function RoleEditor({
  csrfToken,
  managedRoles,
  discordRoles,
  permissions,
  canEdit,
}: RoleEditorProps): React.JSX.Element {
  const router = useRouter();
  const [editing, setEditing] = useState<ManagedRoleView | null>(null);
  const [deleting, setDeleting] = useState<ManagedRoleView | null>(null);
  const [pending, setPending] = useState(false);

  const grouped = permissions.reduce<Record<string, PermissionOption[]>>((accumulator, permission) => {
    (accumulator[permission.module] ??= []).push(permission);
    return accumulator;
  }, {});

  async function save(role: ManagedRoleView): Promise<void> {
    if (pending) {
      return;
    }
    setPending(true);
    const response = await upsertManagedRoleAction({
      csrfToken,
      discordRoleId: role.discordRoleId,
      label: role.label || role.discordName || 'Rolle',
      isProtected: role.isProtected,
      keepOnJail: role.keepOnJail,
      moderationLevel: role.moderationLevel,
      permissions: role.permissions,
    });
    setPending(false);

    if (response.ok) {
      toast.success('Rollenkonfiguration gespeichert.');
      setEditing(null);
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  async function remove(role: ManagedRoleView): Promise<void> {
    const response = await deleteManagedRoleAction({ csrfToken, discordRoleId: role.discordRoleId });
    if (response.ok) {
      toast.success('Rolle entfernt.');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  const available = discordRoles.filter(
    (role) => !managedRoles.some((managed) => managed.discordRoleId === role.id),
  );

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => setEditing({ ...EMPTY })}
            disabled={available.length === 0}
            title={available.length === 0 ? 'Alle Rollen sind bereits konfiguriert' : undefined}
          >
            <Plus aria-hidden="true" />
            Rolle hinzufügen
          </Button>
        </div>
      ) : null}

      {managedRoles.length === 0 ? (
        <EmptyState
          title="Keine Rollen konfiguriert"
          description="Ordne einer Discord-Rolle Berechtigungen zu, damit dein Team die WebApp nutzen kann."
        />
      ) : (
        <div className="rounded-lg border border-border/80">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rolle</TableHead>
                <TableHead>Berechtigungen</TableHead>
                <TableHead>Stufe</TableHead>
                <TableHead>Schutz</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Aktionen</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managedRoles.map((role) => (
                <TableRow key={role.discordRoleId}>
                  <TableCell>
                    <div className="space-y-1">
                      <RoleBadge name={role.discordName ?? role.label} color={role.discordColor} />
                      <p className="font-mono text-[0.7rem] text-muted-foreground">{role.discordRoleId}</p>
                      {!role.existsOnDiscord ? (
                        <Badge variant="destructive">Auf Discord nicht gefunden</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {role.permissions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Keine</span>
                      ) : (
                        role.permissions.map((permission) => (
                          <Badge key={permission} variant="outline">
                            {permission}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{role.moderationLevel}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {role.isProtected ? <Badge variant="warning">Geschützt</Badge> : null}
                      {role.keepOnJail ? <Badge variant="secondary">Bleibt im Jail</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing({ ...role })}
                          aria-label="Rolle bearbeiten"
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(role)}
                          aria-label="Rolle entfernen"
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => (open ? undefined : setEditing(null))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto scrollbar-slim sm:max-w-2xl">
          {editing ? (
            <>
              <DialogHeader>
                <DialogTitle>Rollenkonfiguration</DialogTitle>
                <DialogDescription>
                  Berechtigungen, Moderationsstufe und Schutzstatus einer Discord-Rolle.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                {editing.discordRoleId === '' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="role-select">Discord-Rolle</Label>
                    <Select
                      value={editing.discordRoleId}
                      onValueChange={(value) => {
                        const role = discordRoles.find((entry) => entry.id === value);
                        setEditing({
                          ...editing,
                          discordRoleId: value,
                          label: role?.name ?? '',
                          discordName: role?.name ?? null,
                          discordColor: role?.color ?? 0,
                        });
                      }}
                    >
                      <SelectTrigger id="role-select">
                        <SelectValue placeholder="Rolle wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {available.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="rounded-md border border-border px-3 py-2">
                    <RoleBadge name={editing.discordName ?? editing.label} color={editing.discordColor} />
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{editing.discordRoleId}</p>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="role-label">Bezeichnung</Label>
                    <Input
                      id="role-label"
                      value={editing.label}
                      onChange={(event) => setEditing({ ...editing, label: event.target.value })}
                      maxLength={64}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="role-level">Moderationsstufe</Label>
                    <Input
                      id="role-level"
                      type="number"
                      min={0}
                      max={1000}
                      value={editing.moderationLevel}
                      onChange={(event) =>
                        setEditing({ ...editing, moderationLevel: Number(event.target.value) || 0 })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Höhere Stufen können nicht von niedrigeren moderiert werden.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
                    <div>
                      <Label htmlFor="role-protected">Geschützte Rolle</Label>
                      <p className="text-xs text-muted-foreground">Träger können nicht moderiert werden.</p>
                    </div>
                    <Switch
                      id="role-protected"
                      checked={editing.isProtected}
                      onCheckedChange={(checked) => setEditing({ ...editing, isProtected: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
                    <div>
                      <Label htmlFor="role-keep">Im Jail behalten</Label>
                      <p className="text-xs text-muted-foreground">z.B. Booster-Rollen.</p>
                    </div>
                    <Switch
                      id="role-keep"
                      checked={editing.keepOnJail}
                      onCheckedChange={(checked) => setEditing({ ...editing, keepOnJail: checked })}
                    />
                  </div>
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Berechtigungen</legend>
                  {Object.entries(grouped).map(([module, entries]) => (
                    <div key={module} className="rounded-md border border-border p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {module}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {entries.map((permission) => {
                          const checked = editing.permissions.includes(permission.key);
                          return (
                            <label
                              key={permission.key}
                              className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-sm hover:bg-accent"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                                checked={checked}
                                onChange={(event) =>
                                  setEditing({
                                    ...editing,
                                    permissions: event.target.checked
                                      ? [...editing.permissions, permission.key]
                                      : editing.permissions.filter((key) => key !== permission.key),
                                  })
                                }
                              />
                              <span>
                                <span className="font-medium">{permission.label}</span>
                                {permission.critical ? (
                                  <Badge variant="warning" className="ml-2">
                                    kritisch
                                  </Badge>
                                ) : null}
                                <span className="block text-xs text-muted-foreground">{permission.key}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </fieldset>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
                  Abbrechen
                </Button>
                <Button
                  onClick={() => void save(editing)}
                  loading={pending}
                  disabled={editing.discordRoleId === ''}
                >
                  Speichern
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        destructive
        title="Rollenkonfiguration entfernen?"
        confirmLabel="Entfernen"
        description={
          <p>
            Die Berechtigungen der Rolle <strong>{deleting?.label}</strong> werden entfernt. Mitglieder mit
            dieser Rolle verlieren sofort die zugehörigen Zugriffe.
          </p>
        }
        onConfirm={async () => {
          if (deleting) {
            await remove(deleting);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
