'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { BrandMark } from '@/components/shared/brand-mark';
import { SidebarNav, type NavigationGroup } from './sidebar-nav';

/**
 * Navigation als Drawer auf kleinen Bildschirmen.
 *
 * Nicht die schmalere Seitenleiste, sondern dieselbe Navigation mit
 * Fingermassen: hoehere Eintraege, mehr Luft zwischen den Abschnitten, und
 * die Marke oben mit Abstand statt buendig am Rand. Die Eintraege selbst -
 * Reihenfolge, Gruppen, Sichtbarkeit - sind dieselben; eine zweite Liste
 * waere eine, die irgendwann etwas anderes zeigt als die erste.
 */
export function MobileNav({
  groups,
  logoUrl,
}: {
  groups: NavigationGroup[];
  logoUrl?: string | null;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 lg:hidden" aria-label="Navigation öffnen">
          <Menu aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-dvh w-[19rem] max-w-[85vw] translate-x-0 translate-y-0 overflow-y-auto rounded-none border-y-0 border-l-0 bg-sidebar p-5 scrollbar-slim sm:rounded-none">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="space-y-7 pb-6">
          <BrandMark logoUrl={logoUrl} />
          <SidebarNav groups={groups} touch onNavigate={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
