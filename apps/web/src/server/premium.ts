import 'server-only';
import { can } from '@swisshub/auth';
import { premium } from '@swisshub/modules';
import type { AuthContext } from '@swisshub/auth';
import type { PremiumSection } from '@/modules/premium/sections';

/**
 * Unterseiten des Premium-Moduls.
 *
 * Einmal zentral definiert, damit alle Seiten dieselbe Bereichsnavigation
 * zeigen. "Mein Abo" steht bewusst zuoberst: es betrifft jedes Mitglied,
 * die übrigen Bereiche nur die Verwaltung.
 */
export function premiumSections(context: AuthContext): PremiumSection[] {
  const p = premium.PREMIUM_PERMISSIONS;
  const sections: PremiumSection[] = [
    { href: '/premium/me', label: 'Mein Abo', icon: 'me' },
    // Die Angebote sind der Weg zum Abo und gehoeren damit zur
    // Mitgliedersicht. Die Seite gibt es bereits - sie ist der oeffentliche
    // Shop mit dem bestehenden Kaufablauf. Eine zweite Angebotsseite im
    // geschuetzten Bereich waere dieselbe Liste ein zweites Mal, und beim
    // naechsten neuen Angebot pflegte jemand nur eine davon.
    { href: '/premium', label: 'Angebote', icon: 'products' },
  ];

  if (can(context, p.view)) {
    sections.push(
      { href: '/premium/uebersicht', label: 'Übersicht', icon: 'overview' },
      { href: '/premium/abos', label: 'Abonnements', icon: 'subscriptions' },
    );
  }
  if (can(context, p.productsManage)) {
    sections.push({ href: '/premium/produkte', label: 'Angebote', icon: 'products' });
  }
  if (can(context, p.paymentsView)) {
    sections.push({ href: '/premium/zahlungen', label: 'Zahlungen', icon: 'payments' });
  }
  if (can(context, p.view)) {
    sections.push({ href: '/premium/stuebli', label: 'Stübli', icon: 'stuebli' });
  }
  if (can(context, p.settings)) {
    sections.push({ href: '/modules/premium', label: 'Einstellungen', icon: 'settings' });
  }
  return sections;
}
