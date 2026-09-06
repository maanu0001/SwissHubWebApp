'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRightLeft, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  erstellePaketAction,
  legeUebertragungAnAction,
  listeZielGuildsAction,
} from '@/modules/migration/actions';

/**
 * Eine Übertragung beginnen.
 *
 * Zwei Wege in denselben Vorgang: die eigene Konfiguration nehmen, oder ein
 * Paket hochladen, das anderswo entstanden ist. Beide enden bei demselben
 * Lauf - die Zuordnung, der Probelauf und das Anwenden kennen den Unterschied
 * danach nicht mehr.
 */
export function NeueUebertragung({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [ziel, setZiel] = useState('');
  /**
   * Die Guilds, auf denen der Bot Mitglied ist.
   *
   * Eine Auswahl und kein Eingabefeld: wer eine ID abtippt, tippt sie falsch -
   * und erfährt es erst, wenn er nicht weiterkommt.
   */
  const [guilds, setGuilds] = useState<Array<{
    id: string;
    name: string;
    memberCount: number | null;
    istQuelle: boolean;
  }> | null>(null);
  const [paketJson, setPaketJson] = useState('');
  const [gleicheGuild, setGleicheGuild] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open || guilds !== null) {
      return;
    }
    void listeZielGuildsAction({ csrfToken }).then((antwort) => {
      setGuilds(antwort.ok ? antwort.data : []);
      if (!antwort.ok) {
        toast.error(antwort.error.message);
      }
    });
  }, [open, guilds, csrfToken]);

  const gewaehlt = guilds?.find((guild) => guild.id === ziel) ?? null;

  const exportieren = async (): Promise<void> => {
    const antwort = await erstellePaketAction({ csrfToken });
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    // Als Datei anbieten - das Paket ist genau das, was ein Import erwartet.
    const inhalt = JSON.stringify(antwort.data.paket, null, 2);
    const url = URL.createObjectURL(new Blob([inhalt], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `swisshub-konfiguration-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Export erstellt', { description: 'Ohne Zugangsdaten - siehe Beschreibung oben.' });
  };

  const anlegen = async (): Promise<void> => {
    setPending(true);
    try {
      const antwort = await legeUebertragungAnAction({
        csrfToken,
        targetGuildId: ziel,
        ...(paketJson.trim() ? { paketJson: paketJson.trim() } : {}),
        gleicheGuildErlaubt: gleicheGuild,
      });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      setOpen(false);
      router.push(`/migrate/${antwort.data.runId}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={() => void exportieren()}>
        <Download aria-hidden="true" />
        Export erstellen
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <ArrowRightLeft aria-hidden="true" />
            Neue Übertragung
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue Übertragung</DialogTitle>
            <DialogDescription>
              Es wird noch nichts geschrieben. Nach dem Anlegen folgen Zuordnung und Probelauf.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="migrate-ziel">Ziel-Guild</Label>
              <Select value={ziel} onValueChange={setZiel} disabled={guilds === null}>
                <SelectTrigger id="migrate-ziel">
                  <SelectValue placeholder={guilds === null ? 'Wird geladen …' : 'Zielserver wählen'} />
                </SelectTrigger>
                <SelectContent>
                  {(guilds ?? []).map((guild) => (
                    <SelectItem key={guild.id} value={guild.id}>
                      {guild.name}
                      {guild.istQuelle ? ' (diese Installation)' : ''}
                      {guild.memberCount !== null ? ` · ${guild.memberCount} Mitglieder` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {guilds !== null && guilds.length <= 1
                  ? 'Der Bot ist nur auf diesem Server. Lade ihn zuerst auf den Zielserver ein - danach erscheint er hier.'
                  : 'Nur Server, auf denen der Bot bereits Mitglied ist.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="migrate-paket">Paket (optional)</Label>
              <Textarea
                id="migrate-paket"
                value={paketJson}
                onChange={(event) => setPaketJson(event.target.value)}
                rows={4}
                placeholder="Leer lassen, um die Konfiguration dieser Installation zu nehmen."
              />
              <p className="text-xs text-muted-foreground">
                Ein Paket wird geprüft, bevor es angenommen wird: Fassung, Aufbau und Felder, die nach
                Zugangsdaten aussehen.
              </p>
            </div>

            {gewaehlt?.istQuelle ? (
              <label className="flex items-start gap-2 text-sm">
                <Switch
                  checked={gleicheGuild}
                  onCheckedChange={setGleicheGuild}
                  aria-label="Auf dieselbe Guild schreiben"
                />
                <span className="text-muted-foreground">
                  Ziel ist dieselbe Guild wie die Quelle. Nur bestätigen, wenn das Absicht ist.
                </span>
              </label>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button
              onClick={() => void anlegen()}
              loading={pending}
              disabled={ziel === '' || (gewaehlt?.istQuelle === true && !gleicheGuild)}
            >
              Anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
