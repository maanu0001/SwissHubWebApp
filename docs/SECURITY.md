# Sicherheitsarchitektur

Die WebApp ist eine echte Moderationsoberflaeche fuer einen oeffentlichen Discord-Server.
Leitsatz: **Ein manipuliertes HTTP-Request darf niemals eine Aktion ermoeglichen, die der
angemeldete Benutzer ueber die normale Oberflaeche nicht ausfuehren duerfte.**

Angewandte Prinzipien: Zero Trust gegenueber Client-Requests, Least Privilege, Defense in Depth,
Secure by Default, Fail Closed, serverseitige Autorisierung, Auditierbarkeit, Idempotenz.

---

## 1. Authentifizierung

**Discord OAuth2 Authorization Code Flow mit PKCE** (`packages/auth/src/oauth.ts`, Bibliothek: `arctic`).

| Massnahme             | Umsetzung                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| CSRF im OAuth-Flow    | zufaelliger `state`, gespeichert in einem httpOnly-Cookie, Vergleich konstant (`safeEqual`)                                    |
| Code Injection        | PKCE (`code_verifier`/`S256`), Verifier ebenfalls httpOnly und nur 10 Minuten gueltig                                          |
| Minimale Scopes       | ausschliesslich `identify`                                                                                                     |
| Keine Benutzer-Tokens | der Access Token wird nur serverseitig fuer `GET /users/@me` benutzt und danach sofort widerrufen; er wird **nie** gespeichert |
| Guild-Pruefung        | Mitgliedschaft und Rollen liest der Bot mit seinem eigenen Token direkt bei Discord                                            |
| Gesperrte Konten      | `User.isBlocked` beendet Sessions und verhindert den Login                                                                     |

### Sessions (`packages/auth/src/session.ts`)

- 256 Bit Zufallstoken im Cookie; in der Datenbank liegt nur der **HMAC-SHA256** des Tokens.
- Cookie-Flags: `httpOnly`, `sameSite=lax`, `secure` in Production, `path=/`.
- **Absolutes Ablaufdatum** (`SESSION_ABSOLUTE_TTL_HOURS`, Standard 7 Tage) und
  **Inaktivitaets-Ablauf** (`SESSION_IDLE_TTL_MINUTES`, Standard 12 h).
- **Session Rotation**: das Token wird spaetestens alle 30 Minuten erneuert; beim Login entsteht
  immer eine neue Session (Schutz gegen Session Fixation).
- Logout widerruft die Session serverseitig (`revokedAt`) - ein gestohlenes Cookie wird dadurch wertlos.
- Abgelaufene Sessions raeumt ein Bot-Job periodisch weg.
- Im Browser liegen **keine** Tokens in `localStorage`/`sessionStorage`.

---

## 2. Autorisierung

### Permission Engine (`packages/permissions`)

Die Business-Logik fragt nie nach Discord-Role-IDs, sondern nach Permissions
(`jail.create`, `members.view`, `settings.edit`, ...). Die Zuordnung Rolle -> Permission liegt
zentral in der Datenbank (`ManagedRole` / `RolePermission`) und ist im UI konfigurierbar.

- `admin.full` schliesst alle Permissions ein.
- Wildcards pro Modul (`jail.*`) werden unterstuetzt.
- Ohne passende Zuordnung gibt es **keine** Berechtigung (Fail Closed).
- Der optionale `SWISSHUB_OWNER_DISCORD_ID` erhaelt Zugriff auf systemkritische Funktionen -
  die Schutzregeln der Moderation Policy gelten trotzdem weiter.

### Serverseitige Kette (`apps/web/src/server/action.ts`)

Jede Server Action durchlaeuft: **Session -> Guild-Mitgliedschaft -> CSRF -> Rate Limit ->
Validierung -> Permission -> Moderation Policy -> Ausfuehrung -> Audit**.

Das Ausblenden eines Buttons ist ausdruecklich **keine** Sicherheitsmassnahme:
`<PermissionGuard>` im Frontend dient nur der Benutzerfuehrung.

### Moderation Policy (`packages/permissions/src/moderation-policy.ts`)

Vor jeder Aktion gegen ein Mitglied wird geprueft:

1. keine Selbstmoderation,
2. keine Moderation von Bots,
3. kein Zugriff auf den Discord Guild Owner,
4. keine Moderation geschuetzter Rollen (`ManagedRole.isProtected`),
5. Ziel muss unterhalb der Bot-Rolle liegen (sonst `BOT_ROLE_TOO_LOW`),
6. Ziel muss unterhalb der Discord-Rolle des Moderators liegen,
7. Ziel darf keine gleich hohe oder hoehere Moderationsstufe besitzen.

### Aktualitaet der Rollen

Sicherheitskritische Aktionen laufen mit `freshness: 'critical'`: Rollendaten duerfen dann
maximal `ROLE_CRITICAL_TTL_SECONDS` (Standard 30 s) alt sein, sonst werden sie direkt bei Discord
geladen. Ist Discord nicht erreichbar, gilt der Benutzer als nicht berechtigt.

---

## 3. Discord-Anbindung

- Bot Token, Client Secret und `AUTH_SECRET` stehen ausschliesslich in Environment Variables.
  Sie sind weder in der Datenbank noch in der WebUI aenderbar und tauchen in keinem Log auf.
- Der Bot benoetigt **keine** Administratorrechte (siehe README, Abschnitt 6).
- Rollenaenderungen laufen ueber einen einzigen atomaren `PATCH` je Mitglied; erst bei Fehlern
  wird auf Einzelaktionen zurueckgefallen. Das schont Rate Limits und vermeidet Zwischenzustaende.
- Rate Limits von Discord werden respektiert (`429` inkl. `retry_after`, globales Limit,
  Serialisierung pro Bucket, begrenzte Wiederholungen mit Backoff).
- Discord-Fehler werden auf verstaendliche Meldungen gemappt (`mapDiscordError`); technische
  Details (Codes, Routen, Payloads) landen ausschliesslich im Server-Log.

---

## 4. Web-Sicherheit

| Bereich                | Umsetzung                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSRF                   | Server Actions pruefen Origin (Next.js) **und** einen sessiongebundenen HMAC-Token (Double Submit). Logout laeuft nur per POST mit Token.                                                       |
| XSS                    | Kein `dangerouslySetInnerHTML`; Discord-Inhalte (Namen, Gruende, Rollennamen) werden ausschliesslich als Text gerendert. CSP mit Nonce und `strict-dynamic` statt `unsafe-inline` fuer Skripte. |
| SQL Injection          | ausschliesslich Prisma mit parametrisierten Queries; keine String-Konkatenation.                                                                                                                |
| Injection nach Discord | Freitexte werden bereinigt (`sanitizeText`) und fuer Embeds escaped (`escapeDiscordMarkdown`, `@everyone`/`@here` entschaerft, `allowed_mentions: []`).                                         |
| Clickjacking           | `X-Frame-Options: DENY` und `frame-ancestors 'none'`.                                                                                                                                           |
| Security Header        | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS in Production.                                                                                          |
| Input Validation       | jede Eingabe wird serverseitig mit Zod geprueft (IDs, Dauer, Grund, Pagination, Filter, Einstellungen).                                                                                         |
| Fehlerausgabe          | keine Stack Traces im Browser; Server Actions liefern nur `code` + sichere Meldung.                                                                                                             |

---

## 5. Rate Limiting

Serverseitig und datenbankgestuetzt (`RateLimitCounter`, Fixed Window) - dadurch wirksam auch bei
mehreren Instanzen und ueber Prozessneustarts hinweg.

| Bucket                       | Limit       |
| ---------------------------- | ----------- |
| Login (pro IP-Hash)          | 10 / 10 min |
| OAuth Callback (pro IP-Hash) | 20 / 10 min |
| Mitgliedersuche              | 40 / min    |
| Jail erstellen               | 10 / 5 min  |
| Jail freilassen              | 20 / 5 min  |
| Einstellungen schreiben      | 30 / 5 min  |
| Reconciliation               | 5 / 15 min  |

---

## 6. Idempotenz und Race Conditions

- Jede kritische Aktion traegt einen **Idempotency Key** (UUID, im UI beim Oeffnen des
  Bestaetigungsdialogs erzeugt). Ein zweiter Request mit demselben Schluessel liefert das
  Ergebnis des ersten statt einer zweiten Discord-Aktion.
- `JailEntry.activeKey` ist `UNIQUE` und traegt die Discord-ID, solange der Jail aktiv ist -
  zwei gleichzeitig aktive Jails sind dadurch auf Datenbankebene unmoeglich.
- Freilassungen werden per `updateMany` mit Filter atomar beansprucht.
- Transaktionen kommen dort zum Einsatz, wo mehrere Tabellen konsistent geaendert werden
  (Rollen/Permissions, Audit Log).

---

## 7. Audit Log

- Jede sicherheitsrelevante Aktion wird protokolliert (Login, Logout, Berechtigung verweigert,
  Jail erstellt/beendet/fehlgeschlagen, Einstellungen, Module, Reconciliation).
- **Manipulationsschutz durch Hash-Chain**: jeder Eintrag enthaelt `previousHash` und einen
  SHA-256 `hash` ueber seinen kanonischen Inhalt. Nachtraegliche Aenderungen brechen die Kette;
  `verifyAuditChain()` erkennt das und die Audit-Seite zeigt den Status an.
- Die Reihenfolge wird per `pg_advisory_xact_lock` serialisiert.
- Ueber die Oberflaeche gibt es **keine** Moeglichkeit, Audit-Eintraege zu aendern oder zu loeschen.
- Gespeichert werden nur notwendige Daten: Zeit, Aktion, Modul, Akteur, Ziel, Erfolg, Fehlercode,
  Metadaten, **pseudonymisierte** IP (HMAC, gekuerzt) und User-Agent.

---

## 8. Sicherheitsereignisse

`SecurityEvent` erfasst auffaellige Vorgaenge: ungueltige Sessions, CSRF-Fehler,
OAuth-`state`-Mismatch, verweigerte Berechtigungen, Policy-Verstoesse, ungueltige Eingaben,
Rate-Limit-Ueberschreitungen, Zugriffe von Nicht-Mitgliedern.

Bewusst ohne automatische Sperre: eine selbstlernende Blockade koennte legitime Administratoren
dauerhaft aussperren. Die Ereignisse dienen der Beobachtung und Nachverfolgung.

---

## 9. Logging

- Log Levels `debug`, `info`, `warn`, `error`; JSON in Production.
- **Redaction auf zwei Ebenen**: nach Schluesselnamen (`token`, `secret`, `cookie`,
  `authorization`, `session`, `code_verifier`, ...) und nach Werten (die konkreten Werte von
  `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`, `AUTH_SECRET`, `DATABASE_URL` werden aus jedem
  String entfernt, ebenso `Bot`/`Bearer`-Header-Muster).
- Es werden niemals Cookies, Authorization-Header oder OAuth-Tokens geloggt.

---

## 10. Secrets

| Secret                                  | Ort         | Ueber UI aenderbar          |
| --------------------------------------- | ----------- | --------------------------- |
| `DISCORD_BOT_TOKEN`                     | Environment | nein                        |
| `DISCORD_CLIENT_SECRET`                 | Environment | nein                        |
| `AUTH_SECRET`                           | Environment | nein                        |
| `DATABASE_URL`                          | Environment | nein                        |
| Jail-Rolle, Channels, Rollenzuordnungen | Datenbank   | ja (mit Permission + Audit) |

`.env` ist per `.gitignore` ausgeschlossen; `.env.example` enthaelt ausschliesslich Platzhalter.
Beim Start validiert Zod die Konfiguration - fehlende oder unsichere Werte (z.B. `http://` in
Production, aktivierter Mock-Modus in Production) verhindern den Start.

---

## 11. Entwicklungsmodus

`DEV_MOCK_DISCORD=true` ersetzt saemtliche Discord-Aufrufe durch deterministische Mock-Daten.
Der Modus ist doppelt abgesichert: die ENV-Validierung lehnt ihn in Production ab, und
`discordMocksEnabled()` prueft zusaetzlich `NODE_ENV !== 'production'`.

---

## 12. Bekannte Annahmen und Grenzen

1. **Vertrauenswuerdiger Betreiber**: Wer Zugriff auf Datenbank oder Server hat, kann Daten
   veraendern. Die Hash-Chain macht Manipulationen am Audit Log erkennbar, verhindert sie aber nicht.
2. **Discord als Autoritaet**: Rollen und Mitgliedschaften kommen von Discord. Wer dort Rollen
   vergeben kann, steuert damit auch die Berechtigungen in dieser WebApp.
3. **Rollen-Cache**: zwischen zwei Abrufen (max. 30 s bei kritischen Aktionen) kann eine
   Rollenaenderung noch nicht sichtbar sein. Der Bot invalidiert den Cache zusaetzlich bei
   `GuildMemberUpdate`.
4. **Rate Limits pro Fenster**: Fixed Window erlaubt an der Fenstergrenze kurzzeitig bis zu
   doppelt so viele Anfragen wie das nominale Limit.
5. **Discord und Datenbank sind nicht transaktional koppelbar**: Teilzustaende werden ueber
   `PENDING/EXECUTING/COMPLETED/PARTIAL/FAILED` sichtbar gemacht und per Reconciliation korrigiert.
6. **Kein Multi-Tenant**: die Anwendung ist bewusst auf genau eine Guild ausgelegt.
7. **HTTPS erforderlich**: sichere Cookies setzen eine TLS-Terminierung voraus; hinter einem
   Reverse Proxy muss `TRUST_PROXY=true` gesetzt sein, damit IP-basierte Limits greifen.

---

## 13. Checkliste vor dem Deployment

- [ ] `AUTH_SECRET` frisch erzeugt (>= 32 Zeichen) und nur auf dem Server hinterlegt
- [ ] `NEXT_PUBLIC_APP_URL` auf die HTTPS-Domain gesetzt, Redirect URI im Developer Portal identisch
- [ ] `DEV_MOCK_DISCORD` entfernt oder `false`
- [ ] Bot-Rolle oberhalb aller zu verwaltenden Rollen, Administrator-Rollen oberhalb des Bots
- [ ] Administrator-Rollen als `geschuetzt` markiert, Moderationsstufen vergeben
- [ ] Jail-Rolle konfiguriert und unterhalb der Bot-Rolle
- [ ] Moderations-Log-Channel gesetzt und fuer den Bot beschreibbar
- [ ] `npm run check` und `npm run build` laufen fehlerfrei
- [ ] Datenbank-Backups eingerichtet (`pg_dump` genuegt - kein Zustand nur im Arbeitsspeicher)
