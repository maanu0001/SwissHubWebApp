'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RoleSelect } from '@/modules/configuration/components/role-select';
import type { RoleOption } from '@/modules/configuration/components/discord-option-types';
import {
  deleteMilestoneAction,
  reconcileMilestonesAction,
  upsertMilestoneAction,
} from '@/modules/level/actions';

/**
 * Level-Rollen verwalten.
 *
 * Ersetzt `MILESTONE_ROLES="5:ROLEID,10:ROLEID"` aus der alten `.env`. Ein
 * Level trägt genau eine Rolle; wer das Level erreicht, bekommt sie, wer
 * darunter fällt, verliert sie wieder.
 */
export interface MilestoneView {
  level: number;
  roleId: string;
  enabled: boolean;
  /** Existiert die Rolle noch und kann der Bot sie vergeben? */
  roleName: string | null;
  manageable: boolean;
}

export function MilestoneEditor({
  csrfToken,
  milestones,
  roles,
  canManage,
}: {
  csrfToken: string;
  milestones: MilestoneView[];
  roles: RoleOption[];
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [levelValue, setLevelValue] = useState('5');
  const [roleId, setRoleId] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const add = async (): Promise<void> => {
    const parsed = Number.parseInt(levelValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      toast.error('Bitte ein gültiges Level angeben.');
      return;
    }
    if (!roleId) {
      toast.error('Bitte eine Rolle auswählen.');
      return;
    }

    setPending(true);
    const response = await upsertMilestoneAction({ csrfToken, level: parsed, roleId, enabled: true });
    setPending(false);

    if (!response.ok) {
      toast.error(response.error.message);
      return;
    }
    toast.success(`Level ${parsed} vergibt jetzt die gewählte Rolle.`);
    setRoleId(undefined);
    router.refresh();
  };

  const remove = async (target: number): Promise<void> => {
    setPending(true);
    const response = await deleteMilestoneAction({ csrfToken, level: target });
    setPending(false);

    if (!response.ok) {
      toast.error(response.error.message);
      return;
    }
    toast.success(`Level ${target} vergibt keine Rolle mehr.`);
    router.refresh();
  };

  const reconcile = async (): Promise<void> => {
    setPending(true);
    const response = await reconcileMilestonesAction({ csrfToken, limit: 2000 });
    setPending(false);

    if (!response.ok) {
      toast.error(response.error.message);
      return;
    }
    const { processed, rolesAdded, rolesRemoved, failed } = response.data;
    toast.success(
      `${processed} Mitglieder geprüft: ${rolesAdded} Rollen vergeben, ${rolesRemoved} entzogen` +
        (failed > 0 ? `, ${failed} fehlgeschlagen.` : '.'),
    );
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card">
        {milestones.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            Es sind keine Level-Rollen eingerichtet. Ohne sie vergibt der Bot beim Aufstieg keine Rolle.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {milestones.map((entry) => (
              <li key={entry.level} className="flex items-center gap-3 px-4 py-3">
                <Badge variant="secondary" className="shrink-0">
                  Level {entry.level}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {entry.roleName ?? <span className="text-destructive">Rolle gelöscht</span>}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{entry.roleId}</p>
                </div>
                {entry.roleName && !entry.manageable ? (
                  <span
                    className="flex items-center gap-1 text-xs text-warning"
                    title="Der Bot steht in der Rollenhierarchie unter dieser Rolle und kann sie nicht vergeben."
                  >
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                    Nicht vergebbar
                  </span>
                ) : null}
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => void remove(entry.level)}
                    aria-label={`Level ${entry.level} entfernen`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card/60 p-4">
          <div className="w-28 space-y-1.5">
            <Label htmlFor="milestone-level">Level</Label>
            <Input
              id="milestone-level"
              inputMode="numeric"
              value={levelValue}
              onChange={(event) => setLevelValue(event.target.value)}
            />
          </div>
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="milestone-role">Rolle</Label>
            <RoleSelect
              id="milestone-role"
              value={roleId}
              roles={roles}
              onChange={setRoleId}
              requireManageable
              placeholder="Rolle auswählen"
            />
          </div>
          <Button disabled={pending} onClick={() => void add()}>
            <Plus aria-hidden="true" />
            Hinzufügen
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => void reconcile()}>
            <RefreshCw aria-hidden="true" />
            Alle abgleichen
          </Button>
        </div>
      ) : null}
    </div>
  );
}
