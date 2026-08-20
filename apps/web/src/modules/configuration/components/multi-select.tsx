'use client';

import { useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  id: string;
  label: string;
  hint?: string;
  color?: string;
  disabled?: boolean;
}

/**
 * Mehrfachauswahl mit Suche.
 *
 * Bewusst als einfache, durchsuchbare Liste statt eines Popovers: bei vielen
 * Rollen bleibt so sichtbar, was ausgewählt ist, ohne dass etwas zugeklappt
 * wird.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  disabled,
  emptyLabel = 'Keine Einträge vorhanden.',
  searchPlaceholder = 'Suchen …',
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  emptyLabel?: string;
  searchPlaceholder?: string;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? options.filter((option) => option.label.toLowerCase().includes(normalized))
    : options;

  const toggle = (id: string): void => {
    if (disabled) {
      return;
    }
    onChange(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);
  };

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const option = options.find((entry) => entry.id === id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs disabled:opacity-60"
              >
                {option?.color ? (
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: option.color }}
                    aria-hidden="true"
                  />
                ) : null}
                {option?.label ?? id}
                <X className="size-3 opacity-70" aria-hidden="true" />
                <span className="sr-only">entfernen</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {options.length > 8 ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            disabled={disabled}
          />
        </div>
      ) : null}

      <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          visible.map((option) => {
            const active = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggle(option.id)}
                disabled={disabled || (option.disabled && !active)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  active ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/50',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                  aria-hidden="true"
                >
                  {active ? <Check className="size-3" /> : null}
                </span>
                {option.color ? (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">{option.label}</span>
                {option.hint ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
