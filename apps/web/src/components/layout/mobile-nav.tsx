'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { BrandMark } from '@/components/shared/brand-mark';
import { SidebarNav, type NavigationEntry } from './sidebar-nav';

/** Navigation als Drawer/Dialog auf kleinen Bildschirmen. */
export function MobileNav({ items }: { items: NavigationEntry[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Navigation oeffnen">
          <Menu aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-dvh max-w-xs translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 sm:rounded-none">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="space-y-6">
          <BrandMark />
          <SidebarNav items={items} onNavigate={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
