'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RoleBadge } from '@/components/shared/role-badge';
import { grantMemberRoleAction, revokeMemberRoleAction } from '@/modules/members/actions';

/**
 * Rollen eines Mitglieds vergeben und entziehen.
 *
 * Was hier nicht anklickbar ist, ist es aus einem Grund - und der steht
 * daneben. Eine Rolle stillschweigend wegzulassen liesse den Verwalter raten,
 * ob sie fehlt oder ob er sie nicht darf.
 *
 * Die Sperren selbst liegen im Dienst: diese Liste kommt bereits mit dem
 * Urteil vom Server, und jede Aenderung wird dort erneut geprüft.
 */
export interface RollenEintrag {
  id: string;
  name: string;
  color: number;
  vergeben: boolean;
  verwaltbar: boolean;
  grund: string | null;
}

export function RoleManager({
  discordId,
  csrfToken,
  rollen,
}: {
  discordId: string;
  csrfToken: string;
  rollen: RollenEintrag[];
}): React.JSX.Element {
  const router = useRouter();
  const [suche, setSuche] = useState('');
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLowerCase();
    if (begriff === '') {
      return rollen;
    }
    return rollen.filter((rolle) => rolle.name.toLowerCase().includes(begriff));
  }, [rollen, suche]);

  const vergeben = gefiltert.filter((rolle) => rolle.vergeben);
  const offen = gefiltert.filter((rolle) => !rolle.vergeben);

  async function aendern(rolle: RollenEintrag): Promise<void> {
    setLaeuft(rolle.id);
    const antwort = rolle.vergeben
      ? await revokeMemberRoleAction({ csrfToken, discordId, roleId: rolle.id })
      : await grantMemberRoleAction({ csrfToken, discordId, roleId: rolle.id });
    if (antwort.ok) {
      toast.success(rolle.vergeben ? `«${rolle.name}» entzogen.` : `«${rolle.name}» vergeben.`);
      router.refresh();
    } else {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(null);
  }

  function zeile(rolle: RollenEintrag): React.JSX.Element {
    return (
      <li key={rolle.id} className="flex items-center justify-between gap-3 py-1.5">
        <RoleBadge name={rolle.name} color={rolle.color} />
        {rolle.verwaltbar ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={laeuft === rolle.id}
            onClick={() => void aendern(rolle)}
          >
            {rolle.vergeben ? (
              <>
                <Minus className="size-4" aria-hidden="true" />
                Entziehen
              </>
            ) : (
              <>
                <Plus className="size-4" aria-hidden="true" />
                Vergeben
              </>
            )}
          </Button>
        ) : (
          <span className="max-w-64 text-right text-xs text-muted-foreground">{rolle.grund}</span>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      <Input
        value={suche}
        onChange={(ereignis) => setSuche(ereignis.target.value)}
        placeholder="Rolle suchen …"
        aria-label="Rolle suchen"
        className="h-9 max-w-72"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Vergeben</h3>
          {vergeben.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Rollen.</p>
          ) : (
            <ul className="divide-y divide-border">{vergeben.map(zeile)}</ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Verfügbar</h3>
          {offen.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine weiteren Rollen.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto scrollbar-slim">
              {offen.map(zeile)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
