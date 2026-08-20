import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { CardBannerUpload } from '@/modules/level/components/card-banner-upload';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Levelkarte' };
export const dynamic = 'force-dynamic';

/**
 * Hintergrundbilder der Levelkarte.
 *
 * Die Vorschau entsteht aus demselben Bauplan wie die Karte auf Discord -
 * dort wird dasselbe SVG nur zusätzlich zu PNG gerastert. Was hier steht,
 * steht damit auch im Chat.
 */
export default async function LevelCardPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.settingsView);
  const csrfToken = csrfTokenFor(context);
  const settings = await level.readLevelSettings();
  const canManage = can(context, level.LEVEL_PERMISSIONS.settingsManage);

  // Die Version im Pfad sorgt dafür, dass nach einem Austausch nicht das alte
  // Bild aus dem Browser-Cache erscheint.
  const bannerSrc = (slot: 'normal' | 'prestige', fileName: string): string | null =>
    fileName ? `/api/level/card-banner/${slot}?v=${fileName.slice(-12)}` : null;

  const normalSrc = bannerSrc('normal', settings.cardBannerPath) ?? settings.cardBannerUrl ?? '';
  const prestigeSrc =
    bannerSrc('prestige', settings.cardPrestigeBannerPath) ?? settings.cardPrestigeBannerUrl ?? normalSrc;

  const previews = [
    {
      key: 'normal',
      title: 'Normale Karte',
      xp: 12_580,
      src: normalSrc,
    },
    {
      key: 'prestige',
      title: `Höchstlevel (${level.MAX_LEVEL})`,
      xp: settings.maxLevelTotalXp,
      src: prestigeSrc,
    },
  ];

  return (
    <>
      <PageHeader
        title="Levelkarte"
        description="Hintergrundbilder für /level - eines für die normale Karte, eines für das Höchstlevel."
      />
      <LevelSectionNav sections={levelSections(context)} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CardBannerUpload
          csrfToken={csrfToken}
          slot="normal"
          label="Hintergrund der Levelkarte"
          hint="Gilt für alle Level bis zum Höchstlevel."
          recommended={level.CARD_BANNER_SIZE.normal}
          current={bannerSrc('normal', settings.cardBannerPath)}
          canManage={canManage}
        />
        <CardBannerUpload
          csrfToken={csrfToken}
          slot="prestige"
          label={`Hintergrund im Höchstlevel (${level.MAX_LEVEL})`}
          hint="Ohne eigenes Bild wird der normale Hintergrund verwendet."
          recommended={level.CARD_BANNER_SIZE.prestige}
          current={bannerSrc('prestige', settings.cardPrestigeBannerPath)}
          canManage={canManage}
        />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Vorschau</h3>
        <div className="space-y-4">
          {previews.map((preview) => (
            <figure key={preview.key} className="space-y-2">
              <figcaption className="text-xs text-muted-foreground">{preview.title}</figcaption>
              <div
                className="overflow-x-auto rounded-xl border border-border [&_svg]:h-auto [&_svg]:w-full"
                dangerouslySetInnerHTML={{
                  __html: level.renderLevelCardSvg({
                    displayName: context.user.displayName ?? context.user.username,
                    xp: preview.xp,
                    rank: 1,
                    accentColor: settings.accentColor,
                    bannerSrc: preview.src || null,
                    maxLevelTotalXp: settings.maxLevelTotalXp,
                  }),
                }}
              />
            </figure>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Der Avatar fehlt in der Vorschau - auf Discord steht dort das Bild der jeweiligen Person.
        </p>
      </section>
    </>
  );
}
