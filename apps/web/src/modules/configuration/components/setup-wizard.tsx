'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowRight, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { completeSetupAction, connectGuildAction } from '@/modules/configuration/actions';
import { cn } from '@/lib/utils';
import type { SetupStepView } from './setup-progress';

export interface BotGuildOption {
  id: string;
  name: string;
  memberCount: number | null;
}

/**
 * Einrichtungsassistent.
 *
 * Führt vom leeren System bis zum einsatzbereiten Dashboard: Server verbinden,
 * abgleichen, Berechtigungen vergeben, fertig. Alle Schritte prüfen ihren
 * Zustand serverseitig - der Assistent zeigt also den echten Fortschritt und
 * keine abgehakte Checkliste.
 */
export function SetupWizard({
  csrfToken,
  guilds,
  connectedGuildId,
  steps,
  completeness,
  setupComplete,
}: {
  csrfToken: string;
  guilds: BotGuildOption[];
  connectedGuildId: string | null;
  steps: SetupStepView[];
  completeness: number;
  setupComplete: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [guildId, setGuildId] = useState(connectedGuildId ?? guilds[0]?.id ?? '');
  const [pending, setPending] = useState(false);

  const permissionsStep = steps.find((step) => step.id === 'permissions');
  const syncStep = steps.find((step) => step.id === 'sync');

  async function connect(): Promise<void> {
    if (!guildId || pending) {
      return;
    }
    setPending(true);
    const response = await connectGuildAction({ csrfToken, guildId });
    setPending(false);

    if (response.ok) {
      toast.success(`Verbunden mit ${response.data.name ?? 'dem Server'}.`);
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  async function finish(): Promise<void> {
    setPending(true);
    const response = await completeSetupAction({ csrfToken });
    setPending(false);

    if (response.ok) {
      toast.success('Einrichtung abgeschlossen.');
      router.push('/dashboard');
    } else {
      toast.error(response.error.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Fortschritt</span>
          <span className="text-2xl font-semibold tabular-nums">{completeness}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              completeness === 100 ? 'bg-success' : 'bg-primary',
            )}
            style={{ width: `${completeness}%` }}
          />
        </div>
      </div>

      <Step index={1} title="Discord-Server verbinden" done={connectedGuildId !== null}>
        {guilds.length === 0 ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Der Bot ist auf keinem Server. Bitte ihn zuerst auf deinen Discord-Server einladen und diese
              Seite neu laden.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="setup-guild">Server</Label>
              <Select value={guildId} onValueChange={setGuildId} disabled={pending}>
                <SelectTrigger id="setup-guild">
                  <SelectValue placeholder="Server wählen" />
                </SelectTrigger>
                <SelectContent>
                  {guilds.map((guild) => (
                    <SelectItem key={guild.id} value={guild.id}>
                      {guild.name}
                      {guild.memberCount !== null ? ` · ${guild.memberCount} Mitglieder` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Nur Server, auf denen der Bot bereits Mitglied ist.
              </p>
            </div>
            <Button type="button" onClick={() => void connect()} loading={pending} disabled={!guildId}>
              {connectedGuildId ? 'Server wechseln' : 'Server verbinden'}
            </Button>
          </div>
        )}
      </Step>

      <Step index={2} title="Rollen und Channels abgleichen" done={syncStep?.done ?? false}>
        <p className="text-sm text-muted-foreground">
          Beim Verbinden wird automatisch abgeglichen. Der Bot wiederholt das beim Start, bei Änderungen auf
          Discord und regelmässig.
        </p>
        <Link
          href="/system/discord"
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          Zum Discord-Sync
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </Step>

      <Step index={3} title="Berechtigungen vergeben" done={permissionsStep?.done ?? false}>
        <p className="text-sm text-muted-foreground">
          Lege fest, welche Discord-Rolle das Dashboard benutzen darf. Ohne diesen Schritt hat ausser dem
          Notzugang niemand Zugriff.
        </p>
        <Link
          href="/server/permissions"
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          Berechtigungen festlegen
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </Step>

      <Step
        index={4}
        title="Module einrichten"
        done={steps.find((step) => step.id === 'modules')?.done ?? false}
      >
        <p className="text-sm text-muted-foreground">
          Wähle für jedes aktivierte Modul die passenden Rollen und Channels - zum Beispiel die Jail-Rolle.
        </p>
        <Link
          href="/modules"
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          Zu den Modulen
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </Step>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          type="button"
          onClick={() => void finish()}
          loading={pending}
          disabled={connectedGuildId === null || setupComplete || !(permissionsStep?.done ?? false)}
        >
          {setupComplete ? 'Einrichtung bereits abgeschlossen' : 'Einrichtung abschliessen'}
        </Button>
        {!setupComplete && !(permissionsStep?.done ?? false) ? (
          <span className="text-xs text-warning">
            Erst nach Schritt 3 möglich - sonst hätte nach dem Abschluss niemand mehr Zugriff.
          </span>
        ) : null}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Zum Dashboard
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className={cn(
        'rounded-xl border px-4 py-4',
        done ? 'border-success/40 bg-success/5' : 'border-border bg-card',
      )}
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
            done ? 'border-success bg-success/20 text-success' : 'border-border text-muted-foreground',
          )}
        >
          {done ? <Check className="size-3.5" aria-hidden="true" /> : index}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
