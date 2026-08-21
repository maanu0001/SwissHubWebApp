'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updateCoreSettingsAction } from '@/modules/settings/actions';

interface CoreSettingsFormProps {
  csrfToken: string;
  channels: Array<{ id: string; name: string }>;
  settings: {
    moderationLogChannelId?: string;
    timezone: string;
    showDiscordIds: boolean;
    memberSearchLimit: number;
  };
  disabled?: boolean;
}

const NONE = 'none';

export function CoreSettingsForm({
  csrfToken,
  channels,
  settings,
  disabled = false,
}: CoreSettingsFormProps): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [logChannel, setLogChannel] = useState(settings.moderationLogChannelId ?? NONE);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [showDiscordIds, setShowDiscordIds] = useState(settings.showDiscordIds);
  const [searchLimit, setSearchLimit] = useState(String(settings.memberSearchLimit));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || disabled) {
      return;
    }
    setPending(true);
    const response = await updateCoreSettingsAction({
      csrfToken,
      moderationLogChannelId: logChannel === NONE ? '' : logChannel,
      timezone,
      showDiscordIds,
      memberSearchLimit: Number(searchLimit),
    });
    setPending(false);

    if (response.ok) {
      toast.success('Einstellungen gespeichert.');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="core-log-channel">Moderations-Log Channel</Label>
          <Select value={logChannel} onValueChange={setLogChannel} disabled={disabled}>
            <SelectTrigger id="core-log-channel">
              <SelectValue placeholder="Kein Channel" />
            </SelectTrigger>
            <SelectContent emptyHint="Noch keine Channels synchronisiert - unter System → Discord-Sync abgleichen.">
              <SelectItem value={NONE}>Kein Channel</SelectItem>
              {channels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Standardziel für Moderations-Embeds, sofern ein Modul nichts anderes definiert.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="core-timezone">Zeitzone</Label>
          <Input
            id="core-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">IANA-Zeitzone, Standard: Europe/Zurich.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="core-search-limit">Maximale Suchtreffer</Label>
          <Input
            id="core-search-limit"
            type="number"
            min={5}
            max={100}
            value={searchLimit}
            onChange={(event) => setSearchLimit(event.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
          <div>
            <Label htmlFor="core-show-ids">Discord IDs anzeigen</Label>
            <p className="text-xs text-muted-foreground">Blendet IDs in Listen und Karten ein.</p>
          </div>
          <Switch
            id="core-show-ids"
            checked={showDiscordIds}
            onCheckedChange={setShowDiscordIds}
            disabled={disabled}
          />
        </div>
      </div>

      <Button type="submit" loading={pending} disabled={disabled}>
        Speichern
      </Button>
    </form>
  );
}
