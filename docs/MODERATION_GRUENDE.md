# Moderationsgründe

Wie eine Massnahme zu ihrem Grund kommt — und warum es dafür genau eine Liste
gibt.

---

## 1. Das Problem

Vorher gab es die Gründe zweimal. Das Jail-Modul führte eine im Dashboard
pflegbare Liste; das Moderation Center hatte für Bann, Kick und Timeout gar
keine und verlangte, den Grund jedes Mal neu zu tippen.

Das Ergebnis war absehbar: derselbe Sachverhalt stand als «Spam», «spam»,
«Spamming» und «spammt seit Tagen» in der Akte. Keine Auswertung darüber war
je etwas wert, und wer eine Akte las, musste raten, ob zwei Einträge dasselbe
meinten.

---

## 2. Eine Liste

`packages/modules/src/moderation/reasons.ts` ist die einzige Quelle. Sie
gehört der Moderation, weil Jail inzwischen eine Massnahme darin ist — zwei
Listen für dieselbe Frage wären genau der Zustand, aus dem wir kommen.

```ts
interface ModerationReasonTemplate {
  id: string;
  label: string;
  reasonText: string;
  applicableActions: readonly ModerationAction[];
  sortOrder: number;
}
```

Jede Maske, die einen Grund erfragt, ruft `reasonTemplatesFor(action, settings)`
auf. Es gibt keinen zweiten Weg.

---

## 3. Was eine Vorlage nicht ist

**Keine Vorschrift.** Sie füllt das Feld, und danach lässt sich der Text
ändern, ergänzen oder ganz ersetzen. In die Akte kommt, was am Ende dasteht —
nicht die Vorlage.

**Keine Regel.** Aus «Bot» folgt keine Sonderbehandlung irgendwo im System.
Es ist ein Text, und ein Text bleibt es. Ein Test hält fest, dass der
Moderationsdienst keine Vorlage beim Namen kennt.

**Keine Berechtigung.** Wer eine Massnahme nicht ergreifen darf, sieht ihre
Vorlagen ebenso wenig — die Maske zeigt nur, was jemand tun kann.

---

## 4. Die Vorgaben

| Kennung                    | Text                     | Angeboten bei    |
| -------------------------- | ------------------------ | ---------------- |
| `spam`                     | Spam                     | allen            |
| `beleidigung`              | Beleidigung              | allen            |
| `provokation`              | Provokation              | allen            |
| `regelverstoss`            | Regelverstoss            | allen            |
| `unangemessenes-verhalten` | Unangemessenes Verhalten | allen            |
| `voice-verhalten`          | Voice-Verhalten          | allen            |
| `werbung`                  | Werbung                  | allen            |
| `unter-16`                 | Unter 16                 | Bann, Kick, Jail |
| `bot`                      | Bot                      | Bann, Kick, Jail |

Die ersten sieben stammen aus dem Jail-Modul und stehen unverändert da — ein
Server, der sie kennt, soll sie nicht verlieren.

«Unter 16» und «Bot» sind eng gefasst: sie beschreiben, wer jemand ist, nicht
was er getan hat. Als Notiz ergäben sie keinen Satz, und einen Timeout gegen
einen Bot setzt niemand — man entfernt ihn.

---

## 5. Konfiguration

**Moderation → Einstellungen** (`/modules/moderation`):

- **Eigene Gründe** — eine Zeile je Grund. Sie gelten für jede Massnahme: wer
  einen eigenen Grund einträgt, weiss selbst, wann er ihn braucht, und eine
  Zuordnung pro Massnahme wäre eine Pflege, die niemand leistet.
- **Vorgaben ausblenden** — je Zeile eine Kennung aus der Tabelle oben.
  Ausblenden statt löschen: die Vorgaben stehen im Code, und ein Server, der
  «Voice-Verhalten» nicht braucht, soll deswegen nicht die ganze Liste
  abschreiben müssen.

Was schon Vorgabe ist, kommt nicht doppelt zurück — auch nicht in anderer
Schreibweise. Zwei Knöpfe «Spam» und «spam» nebeneinander wären genau die
Uneinheitlichkeit, gegen die es die Liste gibt.

Ein eigener Berechtigungsschlüssel fürs Pflegen existiert nicht: wer die
Moduleinstellungen ändern darf, ändert auch diese.

---

## 6. Die alte Jail-Liste

Der Schlüssel `reasonPresets` bleibt im Jail-Schema, damit bestehende Einträge
nicht verlorengehen. Er wird nicht mehr gelesen, und das Feld erscheint nicht
mehr in den Jail-Einstellungen — ein Feld, das man ausfüllen kann und das
nichts bewirkt, wäre schlimmer als keines.

Die Migration `moderation_gruende_zusammenfuehren` hat übernommen, was ein
Server dort selbst eingetragen hatte. Übernommen wird nur, was nicht ohnehin
Vorgabe ist; ein zweiter Lauf schreibt nichts.

---

## 7. Audit

Im Audit steht der **tatsächlich verwendete** Grund, so wie er abgeschickt
wurde. Die Vorlage selbst wird nicht vermerkt: sie hat das Feld gefüllt und
ist damit fertig, und was danach getippt wurde, ist die Wahrheit über den
Vorgang.
