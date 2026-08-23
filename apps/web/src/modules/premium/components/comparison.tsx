import { Check, Minus } from 'lucide-react';

/**
 * Produktvergleich.
 *
 * Auf schmalen Bildschirmen keine gequetschte Tabelle: dort steht je Angebot
 * eine Liste. Erst ab `sm` erscheint die Gegenüberstellung als Tabelle.
 */
const MERKMALE = [
  { label: 'Premium-Rolle', premium: true, stuebli: false, bundle: true },
  { label: 'Premium-Stübli-Rolle', premium: false, stuebli: true, bundle: true },
  { label: 'Eigenes Voice-Stübli', premium: false, stuebli: true, bundle: true },
  { label: 'Rechte im eigenen Kanal', premium: false, stuebli: true, bundle: true },
  { label: 'Premium-Vorteile', premium: true, stuebli: false, bundle: true },
] as const;

const SPALTEN = [
  { key: 'premium', label: 'Premium' },
  { key: 'stuebli', label: 'Stübli' },
  { key: 'bundle', label: 'Bundle' },
] as const;

function Zeichen({ ja }: { ja: boolean }): React.JSX.Element {
  return ja ? (
    <>
      <Check className="mx-auto size-4 text-primary-bright" aria-hidden="true" />
      <span className="sr-only">enthalten</span>
    </>
  ) : (
    <>
      <Minus className="mx-auto size-4 text-muted-foreground/60" aria-hidden="true" />
      <span className="sr-only">nicht enthalten</span>
    </>
  );
}

export function ProductComparison(): React.JSX.Element {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Angebote im Vergleich</h2>

      {/* Ab sm als Tabelle. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Vergleich der Premium-Angebote</caption>
          <thead>
            <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <th scope="col" className="px-5 py-3 font-semibold">
                Merkmal
              </th>
              {SPALTEN.map((spalte) => (
                <th key={spalte.key} scope="col" className="px-5 py-3 text-center font-semibold">
                  {spalte.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MERKMALE.map((merkmal) => (
              <tr key={merkmal.label} className="border-b border-border/40 last:border-0">
                <th scope="row" className="px-5 py-3 text-left font-normal">
                  {merkmal.label}
                </th>
                <td className="px-5 py-3 text-center">
                  <Zeichen ja={merkmal.premium} />
                </td>
                <td className="px-5 py-3 text-center">
                  <Zeichen ja={merkmal.stuebli} />
                </td>
                <td className="px-5 py-3 text-center">
                  <Zeichen ja={merkmal.bundle} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Auf dem Handy je Angebot eine Liste. */}
      <div className="space-y-3 sm:hidden">
        {SPALTEN.map((spalte) => (
          <div key={spalte.key} className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 font-semibold">{spalte.label}</p>
            <ul className="space-y-1.5 text-sm">
              {MERKMALE.map((merkmal) => (
                <li key={merkmal.label} className="flex items-center gap-2">
                  {merkmal[spalte.key] ? (
                    <Check className="size-4 shrink-0 text-primary-bright" aria-hidden="true" />
                  ) : (
                    <Minus className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  )}
                  <span className={merkmal[spalte.key] ? '' : 'text-muted-foreground'}>
                    {merkmal.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
