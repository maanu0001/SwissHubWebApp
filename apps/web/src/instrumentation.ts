/**
 * Wird von Next.js einmalig beim Serverstart ausgefuehrt.
 *
 * Die eigentliche Startlogik liegt in `instrumentation.node.ts` und wird nur
 * in der Node.js-Laufzeit geladen - die Edge-Runtime (Middleware) darf weder
 * Datenbank noch Node-Krypto einbinden.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node');
  }
}
