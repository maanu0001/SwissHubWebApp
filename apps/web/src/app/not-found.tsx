import type { Metadata } from 'next';
import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Seite nicht gefunden' };

export default function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Card className="w-full max-w-lg text-center">
        <CardHeader className="items-center gap-3">
          <span className="rounded-full bg-muted p-3 text-muted-foreground">
            <FileQuestion className="size-6" aria-hidden="true" />
          </span>
          <CardTitle className="text-xl">Seite nicht gefunden</CardTitle>
          <CardDescription>Die angeforderte Seite existiert nicht oder wurde verschoben.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard" className={cn(buttonVariants({ variant: 'default' }))}>
            Zurück zum Dashboard
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
