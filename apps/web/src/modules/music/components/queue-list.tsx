'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, GripVertical, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { moveItemAction, removeItemAction } from '@/modules/music/actions';

export interface QueueEintrag {
  id: string;
  title: string;
  artist: string | null;
  durationSeconds: number;
  thumbnailUrl: string | null;
  requestedByUsername: string | null;
  unavailable: boolean;
}

const dauer = (s: number): string =>
  s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '–:––';

/**
 * Die Warteschlange.
 *
 * Verschoben wird ueber die stabile Element-ID, nicht ueber die Position -
 * zwischen Anzeige und Klick kann jemand anderes etwas entfernt haben, und
 * ein Index zeigte dann auf den falschen Titel.
 *
 * Am Zeiger per Ziehen, auf dem Telefon ueber Pfeile: Drag & Drop ist dort
 * eine Zumutung, wo dieselbe Geste die Seite scrollt.
 */
export function QueueList({
  sessionId,
  csrfToken,
  eintraege,
  darfVerwalten,
}: {
  sessionId: string;
  csrfToken: string;
  eintraege: QueueEintrag[];
  darfVerwalten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [gezogen, setGezogen] = useState<string | null>(null);
  const [ueber, setUeber] = useState<string | null>(null);
  const [, starteUebergang] = useTransition();

  async function verschiebe(queueItemId: string, zielIndex: number): Promise<void> {
    if (pending !== null) return;
    setPending(queueItemId);
    try {
      const antwort = await moveItemAction({ csrfToken, sessionId, queueItemId, targetIndex: zielIndex });
      if (antwort.ok) {
        starteUebergang(() => router.refresh());
      } else {
        toast.error(antwort.error.message);
      }
    } finally {
      setPending(null);
    }
  }

  async function entferne(queueItemId: string): Promise<void> {
    if (pending !== null) return;
    setPending(queueItemId);
    try {
      const antwort = await removeItemAction({ csrfToken, sessionId, queueItemId });
      if (antwort.ok) {
        starteUebergang(() => router.refresh());
      } else {
        toast.error(antwort.error.message);
      }
    } finally {
      setPending(null);
    }
  }

  if (eintraege.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
        Die Warteschlange ist leer.
      </p>
    );
  }

  return (
    <ol className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
      {eintraege.map((eintrag, index) => (
        <li
          key={eintrag.id}
          draggable={darfVerwalten}
          onDragStart={() => setGezogen(eintrag.id)}
          onDragOver={(e) => {
            e.preventDefault();
            setUeber(eintrag.id);
          }}
          onDragEnd={() => {
            setGezogen(null);
            setUeber(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setUeber(null);
            if (gezogen && gezogen !== eintrag.id) {
              void verschiebe(gezogen, index);
            }
            setGezogen(null);
          }}
          className={cn(
            'group flex items-center gap-3 rounded-xl border border-transparent p-2 transition-colors',
            'hover:border-border/70 hover:bg-card/60',
            gezogen === eintrag.id && 'opacity-40',
            ueber === eintrag.id && gezogen !== eintrag.id && 'border-primary/50 bg-primary/5',
            eintrag.unavailable && 'opacity-50',
          )}
        >
          {darfVerwalten ? (
            <GripVertical
              className="hidden size-4 shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing sm:block"
              aria-hidden="true"
            />
          ) : null}

          <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
            {index + 1}
          </span>

          {eintrag.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- fremde CDN-Adresse, kein Loader
            <img
              src={eintrag.thumbnailUrl}
              alt=""
              width={40}
              height={40}
              loading="lazy"
              className="size-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="size-10 shrink-0 rounded-lg bg-border/60" aria-hidden="true" />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{eintrag.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {eintrag.artist ? `${eintrag.artist} · ` : ''}
              {dauer(eintrag.durationSeconds)}
              {eintrag.requestedByUsername ? ` · @${eintrag.requestedByUsername}` : ''}
              {eintrag.unavailable ? ' · nicht verfügbar' : ''}
            </p>
          </div>

          {darfVerwalten ? (
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {/* Auf dem Telefon dauerhaft sichtbar - dort gibt es kein Hover. */}
              <button
                type="button"
                onClick={() => void verschiebe(eintrag.id, Math.max(0, index - 1))}
                disabled={index === 0 || pending !== null}
                aria-label={`"${eintrag.title}" nach oben`}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-border/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 sm:opacity-100"
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void verschiebe(eintrag.id, Math.min(eintraege.length - 1, index + 1))}
                disabled={index === eintraege.length - 1 || pending !== null}
                aria-label={`"${eintrag.title}" nach unten`}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-border/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void entferne(eintrag.id)}
                disabled={pending !== null}
                aria-label={`"${eintrag.title}" entfernen`}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
              >
                {pending === eintrag.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <X className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
