'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { BrandMark } from '@/components/shared/brand-mark';
import { SidebarNav, type NavigationGroup } from './sidebar-nav';

/** Navigation als Drawer auf kleinen Bildschirmen. */
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
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Navigation öffnen">
          <Menu aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-dvh max-w-xs translate-x-0 translate-y-0 overflow-y-auto rounded-none border-y-0 border-l-0 bg-sidebar scrollbar-slim sm:rounded-none">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="space-y-6">
          <BrandMark logoUrl={logoUrl} />
          <SidebarNav groups={groups} onNavigate={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
