'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatDuration } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updateJailSettingsAction } from '@/modules/settings/actions';

interface JailSettingsFormProps {
  csrfToken: string;
  roles: Array<{ id: string; name: string; position: number }>;
  channels: Array<{ id: string; name: string }>;
  botHighestPosition: number;
  settings: {
    jailRoleId?: string;
    jailChannelId?: string;
    moderationLogChannelId?: string;
    maxDurationSeconds: number;
    postModerationLog: boolean;
    notifyInJailChannel: boolean;
    keepRoleIds: string[];
  };
  disabled?: boolean;
}

const NONE = 'none';

const MAX_DURATION_OPTIONS = [
  { label: '1 Tag', seconds: 24 * 60 * 60 },
  { label: '3 Tage', seconds: 3 * 24 * 60 * 60 },
  { label: '7 Tage', seconds: 7 * 24 * 60 * 60 },
  { label: '14 Tage', seconds: 14 * 24 * 60 * 60 },
  { label: '30 Tage', seconds: 30 * 24 * 60 * 60 },
  { label: '90 Tage', seconds: 90 * 24 * 60 * 60 },
];

export function JailSettingsForm({
  csrfToken,
  roles,
  channels,
  botHighestPosition,
  settings,
  disabled = false,
}: JailSettingsFormProps): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [jailRoleId, setJailRoleId] = useState(settings.jailRoleId ?? NONE);
  const [jailChannelId, setJailChannelId] = useState(settings.jailChannelId ?? NONE);
  const [logChannelId, setLogChannelId] = useState(settings.moderationLogChannelId ?? NONE);
  const [maxDuration, setMaxDuration] = useState(String(settings.maxDurationSeconds));
  const [postLog, setPostLog] = useState(settings.postModerationLog);
  const [notifyJail, setNotifyJail] = useState(settings.notifyInJailChannel);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || disabled) {
      return;
    }
    setPending(true);
    const response = await updateJailSettingsAction({
      csrfToken,
      jailRoleId: jailRoleId === NONE ? '' : jailRoleId,
      jailChannelId: jailChannelId === NONE ? '' : jailChannelId,
      moderationLogChannelId: logChannelId === NONE ? '' : logChannelId,
      maxDurationSeconds: Number(maxDuration),
      postModerationLog: postLog,
      notifyInJailChannel: notifyJail,
      keepRoleIds: settings.keepRoleIds,
    });
    setPending(false);

    if (response.ok) {
      toast.success('Jail-Einstellungen gespeichert.');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="jail-role">Jail-Rolle</Label>
          <Select value={jailRoleId} onValueChange={setJailRoleId} disabled={disabled}>
            <SelectTrigger id="jail-role">
              <SelectValue placeholder="Keine Rolle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Keine Rolle</SelectItem>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id} disabled={role.position >= botHighestPosition}>
                  {role.name}
                  {role.position >= botHighestPosition ? ' (ueber der Bot-Rolle)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Muss unterhalb der Bot-Rolle liegen, damit der Bot sie vergeben kann.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="jail-max-duration">Maximale Jail-Dauer</Label>
          <Select value={maxDuration} onValueChange={setMaxDuration} disabled={disabled}>
            <SelectTrigger id="jail-max-duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MAX_DURATION_OPTIONS.map((option) => (
                <SelectItem key={option.seconds} value={String(option.seconds)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Aktuell: {formatDuration(Number(maxDuration) * 1000)}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="jail-channel">Jail-Channel</Label>
          <Select value={jailChannelId} onValueChange={setJailChannelId} disabled={disabled}>
            <SelectTrigger id="jail-channel">
              <SelectValue placeholder="Kein Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Kein Channel</SelectItem>
              {channels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="jail-log-channel">Moderations-Log (Jail)</Label>
          <Select value={logChannelId} onValueChange={setLogChannelId} disabled={disabled}>
            <SelectTrigger id="jail-log-channel">
              <SelectValue placeholder="Kerneinstellung verwenden" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Kerneinstellung verwenden</SelectItem>
              {channels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
          <div>
            <Label htmlFor="jail-post-log">Moderations-Log posten</Label>
            <p className="text-xs text-muted-foreground">Embed bei Jail und Freilassung.</p>
          </div>
          <Switch id="jail-post-log" checked={postLog} onCheckedChange={setPostLog} disabled={disabled} />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
          <div>
            <Label htmlFor="jail-notify">Hinweis im Jail-Channel</Label>
            <p className="text-xs text-muted-foreground">Information fuer das betroffene Mitglied.</p>
          </div>
          <Switch id="jail-notify" checked={notifyJail} onCheckedChange={setNotifyJail} disabled={disabled} />
        </div>
      </div>

      <Button type="submit" loading={pending} disabled={disabled}>
        Speichern
      </Button>
    </form>
  );
}
