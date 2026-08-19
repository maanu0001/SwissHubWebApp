'use client';

import { Toaster as SonnerToaster } from 'sonner';

/** Globale Toast-Ausgabe im SwissHub Look. */
export function Toaster(): React.JSX.Element {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'border-border bg-card text-foreground shadow-card',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}
