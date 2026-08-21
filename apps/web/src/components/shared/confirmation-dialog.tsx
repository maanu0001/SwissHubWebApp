'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm(): Promise<void> | void;
  /**
   * Zusätzliche Felder im Dialog - etwa ein Pflichtgrund.
   *
   * Wirft `onConfirm`, bleibt der Dialog offen und die Eingabe erhalten;
   * sonst müsste man nach einer abgewiesenen Eingabe von vorne beginnen.
   */
  children?: React.ReactNode;
}

/**
 * Bestätigungsdialog für destruktive Discord-Aktionen.
 * Der Bestätigungsbutton bleibt während der Ausführung deaktiviert
 * (Schutz gegen Doppelklick).
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  destructive = false,
  onConfirm,
  children,
}: ConfirmationDialogProps): React.JSX.Element {
  const [pending, setPending] = useState(false);

  async function handleConfirm(): Promise<void> {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Bewusst geschluckt: die aufrufende Stelle hat den Grund bereits
      // gemeldet. Der Dialog bleibt offen, damit die Eingabe erhalten bleibt
      // und sich der Fehler beheben lässt.
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive ? <AlertTriangle className="size-5 text-warning" aria-hidden="true" /> : null}
            {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
          </DialogDescription>
        </DialogHeader>
        {children ? <div className="space-y-3 py-2">{children}</div> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void handleConfirm()}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
