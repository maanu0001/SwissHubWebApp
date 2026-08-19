import type { Metadata, Viewport } from 'next';
import { branding } from '@swisshub/config/client';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: `${branding.name} ${branding.productName}`,
    template: `%s | ${branding.name}`,
  },
  description: branding.description,
  robots: { index: false, follow: false },
  icons: { icon: branding.logo.mark },
};

export const viewport: Viewport = {
  themeColor: '#0f0f11',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="de-CH" className="dark">
      <body className="min-h-dvh font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
