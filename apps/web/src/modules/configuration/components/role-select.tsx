'use client';

import { AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { roleColor, type RoleOption } from './discord-option-types';

const NONE = '__none__';

/**
 * Rollenauswahl statt ID-Eingabe.
 *
 * Rollen, die der Bot nicht vergeben kann, bleiben sichtbar, sind aber
 * deaktiviert und begründet - so ist erkennbar, warum eine Rolle nicht
 * verwendbar ist, statt dass sie kommentarlos fehlt.
 */
export function RoleSelect({
  id,
  value,
  roles,
  onChange,
  disabled,
  requireManageable,
  placeholder = 'Keine Rolle',
}: {
  id: string;
  value: string | undefined;
  roles: RoleOption[];
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  requireManageable?: boolean;
  placeholder?: string;
}): React.JSX.Element {
  const selected = roles.find((role) => role.id === value);
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
          {roles.map((role) => (
            <SelectItem
              key={role.id}
              value={role.id}
              disabled={requireManageable && !role.manageable && role.id !== value}
            >
              <span className="flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full border border-border"
                  style={{ backgroundColor: roleColor(role.color) ?? 'transparent' }}
                  aria-hidden="true"
                />
                {role.name}
                {requireManageable && !role.manageable ? (
                  <span className="text-xs text-muted-foreground">
                    {role.managed ? '(von Discord verwaltet)' : '(über der Bot-Rolle)'}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {missing ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Die gespeicherte Rolle existiert auf Discord nicht mehr.
        </p>
      ) : null}
      {selected?.deleted ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Diese Rolle wurde auf Discord gelöscht.
        </p>
      ) : null}
    </div>
  );
}
