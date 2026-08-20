'use client';

import { AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ChannelOption } from './discord-option-types';

const NONE = '__none__';

/** Channel-Auswahl mit Kategorie als Hinweis (statt einer Channel-ID). */
export function ChannelSelect({
  id,
  value,
  channels,
  onChange,
  disabled,
  placeholder = 'Kein Channel',
}: {
  id: string;
  value: string | undefined;
  channels: ChannelOption[];
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
}): React.JSX.Element {
  const selected = channels.find((channel) => channel.id === value);
  const missing = value !== undefined && value !== '' && !selected;

  return (
    <div className="space-y-1.5">
      <Select
        value={value && value !== '' ? value : NONE}
        onValueChange={(next) => onChange(next === NONE ? undefined : next)}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{placeholder}</SelectItem>
          {channels.map((channel) => (
            <SelectItem key={channel.id} value={channel.id}>
              <span className="flex items-center gap-2">
                #{channel.name}
                {channel.parentName ? (
                  <span className="text-xs text-muted-foreground">{channel.parentName}</span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {missing ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Der gespeicherte Channel existiert auf Discord nicht mehr.
        </p>
      ) : null}
    </div>
  );
}
