import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Ein sehr kleiner Markdown-Darsteller.
 *
 * Bewusst ohne Bibliothek und bewusst ohne `dangerouslySetInnerHTML`: Regeln
 * und Beschreibungen werden von der Turnierleitung geschrieben, landen aber
 * auf einer öffentlichen Seite. Was hier entsteht, sind React-Elemente - es
 * gibt keinen Weg, über den fremdes HTML in die Seite käme.
 *
 * Unterstützt wird, was in einem Regelwerk vorkommt: Überschriften,
 * Absätze, Listen, Zitate, Trennlinien, Codeblöcke sowie fett, kursiv, Code
 * und Verweise im Fliesstext. Alles andere bleibt schlicht Text - lieber ein
 * ungerendertes Sternchen als eine halbe Auszeichnungssprache.
 */
export function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('space-y-3 text-sm leading-relaxed', className)}>
      {bloecke(text).map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

type Block =
  | { art: 'heading'; ebene: 2 | 3 | 4; text: string }
  | { art: 'paragraph'; text: string }
  | { art: 'list'; nummeriert: boolean; punkte: string[] }
  | { art: 'quote'; text: string }
  | { art: 'code'; text: string }
  | { art: 'rule' };

/** Den Text in Blöcke zerlegen. Zeilenweise, ohne Rückgriffe. */
function bloecke(text: string): Block[] {
  const zeilen = text.replace(/\r\n/gu, '\n').split('\n');
  const ergebnis: Block[] = [];
  let absatz: string[] = [];

  function absatzAbschliessen(): void {
    if (absatz.length > 0) {
      ergebnis.push({ art: 'paragraph', text: absatz.join(' ') });
      absatz = [];
    }
  }

  for (let i = 0; i < zeilen.length; i += 1) {
    const zeile = zeilen[i] ?? '';

    if (zeile.trim() === '') {
      absatzAbschliessen();
      continue;
    }

    // Codeblock: alles bis zur schliessenden Zeile bleibt wörtlich.
    if (zeile.trimStart().startsWith('```')) {
      absatzAbschliessen();
      const inhalt: string[] = [];
      i += 1;
      while (i < zeilen.length && !(zeilen[i] ?? '').trimStart().startsWith('```')) {
        inhalt.push(zeilen[i] ?? '');
        i += 1;
      }
      ergebnis.push({ art: 'code', text: inhalt.join('\n') });
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/u.test(zeile)) {
      absatzAbschliessen();
      ergebnis.push({ art: 'rule' });
      continue;
    }

    const ueberschrift = /^(#{1,6})\s+(.*)$/u.exec(zeile);
    if (ueberschrift) {
      absatzAbschliessen();
      // Die Seite hat schon eine H1; alles darunter beginnt bei H2, damit die
      // Gliederung nicht springt.
      const tiefe = (ueberschrift[1] ?? '#').length;
      ergebnis.push({
        art: 'heading',
        ebene: tiefe <= 1 ? 2 : tiefe === 2 ? 3 : 4,
        text: ueberschrift[2] ?? '',
      });
      continue;
    }

    const punkt = /^\s*([-*+]|\d+[.)])\s+(.*)$/u.exec(zeile);
    if (punkt) {
      absatzAbschliessen();
      const nummeriert = !/^[-*+]$/u.test(punkt[1] ?? '');
      const letzter = ergebnis[ergebnis.length - 1];
      if (letzter && letzter.art === 'list' && letzter.nummeriert === nummeriert) {
        letzter.punkte.push(punkt[2] ?? '');
      } else {
        ergebnis.push({ art: 'list', nummeriert, punkte: [punkt[2] ?? ''] });
      }
      continue;
    }

    const zitat = /^\s*>\s?(.*)$/u.exec(zeile);
    if (zitat) {
      absatzAbschliessen();
      const letzter = ergebnis[ergebnis.length - 1];
      if (letzter && letzter.art === 'quote') {
        letzter.text = `${letzter.text} ${zitat[1] ?? ''}`;
      } else {
        ergebnis.push({ art: 'quote', text: zitat[1] ?? '' });
      }
      continue;
    }

    absatz.push(zeile.trim());
  }

  absatzAbschliessen();
  return ergebnis;
}

function Block({ block }: { block: Block }): React.JSX.Element {
  switch (block.art) {
    case 'heading': {
      const gemeinsam = 'font-semibold text-foreground';
      if (block.ebene === 2) {
        return <h2 className={cn(gemeinsam, 'pt-2 text-lg')}>{inline(block.text)}</h2>;
      }
      if (block.ebene === 3) {
        return <h3 className={cn(gemeinsam, 'pt-1 text-base')}>{inline(block.text)}</h3>;
      }
      return <h4 className={cn(gemeinsam, 'text-sm')}>{inline(block.text)}</h4>;
    }
    case 'list':
      return block.nummeriert ? (
        <ol className="list-decimal space-y-1 pl-5">
          {block.punkte.map((punkt, index) => (
            <li key={index}>{inline(punkt)}</li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5">
          {block.punkte.map((punkt, index) => (
            <li key={index}>{inline(punkt)}</li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">
          {inline(block.text)}
        </blockquote>
      );
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-lg border border-border bg-card/60 p-3 text-xs">
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr className="border-border" />;
    default:
      return <p>{inline(block.text)}</p>;
  }
}

/**
 * Fett, kursiv, Code und Verweise im Fliesstext.
 *
 * Der reguläre Ausdruck findet die Auszeichnungen, das Ergebnis sind aber
 * React-Elemente - der Text dazwischen wird nie als Markup gelesen.
 */
function inline(text: string): React.ReactNode[] {
  const MUSTER =
    /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/gu;

  const teile: React.ReactNode[] = [];
  let zuletzt = 0;
  let treffer: RegExpExecArray | null;

  while ((treffer = MUSTER.exec(text)) !== null) {
    if (treffer.index > zuletzt) {
      teile.push(text.slice(zuletzt, treffer.index));
    }
    teile.push(<Auszeichnung key={treffer.index} roh={treffer[0]} />);
    zuletzt = treffer.index + treffer[0].length;
  }

  if (zuletzt < text.length) {
    teile.push(text.slice(zuletzt));
  }
  return teile;
}

function Auszeichnung({ roh }: { roh: string }): React.JSX.Element {
  if (roh.startsWith('**') || roh.startsWith('__')) {
    return <strong className="font-semibold">{roh.slice(2, -2)}</strong>;
  }
  if (roh.startsWith('`')) {
    return <code className="rounded bg-card/70 px-1 py-0.5 text-[0.85em]">{roh.slice(1, -1)}</code>;
  }
  if (roh.startsWith('[')) {
    const treffer = /^\[([^\]]+)\]\(([^)\s]+)\)$/u.exec(roh);
    // Nur `http`, `https` und seiteninterne Ziele. `javascript:` als Verweis
    // wäre genau die Lücke, die dieser Darsteller nicht haben soll.
    const ziel = treffer?.[2] ?? '';
    const erlaubt = /^(https?:\/\/|\/)/iu.test(ziel);
    if (!treffer || !erlaubt) {
      return <span>{roh}</span>;
    }
    return ziel.startsWith('/') ? (
      <Link href={ziel} className="text-primary underline underline-offset-2">
        {treffer[1]}
      </Link>
    ) : (
      <a
        href={ziel}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline underline-offset-2"
      >
        {treffer[1]}
      </a>
    );
  }
  return <em className="italic">{roh.slice(1, -1)}</em>;
}
