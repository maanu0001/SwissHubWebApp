import 'server-only';
import { cache } from 'react';
import {
  listActions,
  listConditions,
  listEventDefinitions,
  listTemplates,
  listTriggers,
  type AutomationField,
} from '@swisshub/automation';

/**
 * Die Bausteine der Automation Engine, wie sie der Browser braucht.
 *
 * Die Registries leben im Server: sie enthalten Funktionen (`execute`,
 * `matches`, `evaluate`) und Zod-Schemata, und beides lässt sich weder
 * serialisieren noch gehört es in den Browser. Was hier entsteht, ist die
 * **Beschreibung** - Namen, Felder, Gruppen -, und die genügt dem Builder
 * vollständig.
 *
 * Der Builder kann damit für jedes Modul dasselbe Formular bauen, ohne ein
 * einziges Modul zu kennen. Ein neues Modul erscheint im Builder, sobald es
 * seine Trigger und Aktionen anmeldet - ohne Änderung an einer Datei hier.
 */

export interface BausteinAnsicht {
  id: string;
  label: string;
  description: string;
  group?: string;
  icon?: string;
  fields: AutomationField[];
  /** Nur bei Aktionen: die zusätzlich nötige Berechtigung. */
  requiredPermission?: string;
  /** Nur bei Aktionen: hält den Lauf an und wartet auf einen Menschen. */
  requiresApproval?: boolean;
}

export interface EreignisAnsicht {
  type: string;
  label: string;
  description: string;
  module: string;
  variablen: Array<{ path: string; label: string; type: string }>;
}

export interface VorlageAnsicht {
  id: string;
  name: string;
  description: string;
  gruppe: string;
  icon?: string;
  auszufuellen: Array<{ pfad: string; label: string }>;
}

export interface AutomationBausteine {
  trigger: BausteinAnsicht[];
  bedingungen: BausteinAnsicht[];
  aktionen: BausteinAnsicht[];
  ereignisse: EreignisAnsicht[];
  vorlagen: VorlageAnsicht[];
}

export const ladeBausteine = cache(async (): Promise<AutomationBausteine> => {
  return {
    trigger: listTriggers().map((eintrag) => ({
      id: eintrag.id,
      label: eintrag.label,
      description: eintrag.description,
      ...(eintrag.icon ? { icon: eintrag.icon } : {}),
      fields: eintrag.fields,
    })),
    bedingungen: listConditions().map((eintrag) => ({
      id: eintrag.id,
      label: eintrag.label,
      description: eintrag.description,
      group: eintrag.group,
      fields: eintrag.fields,
    })),
    aktionen: listActions().map((eintrag) => ({
      id: eintrag.id,
      label: eintrag.label,
      description: eintrag.description,
      group: eintrag.group,
      ...(eintrag.icon ? { icon: eintrag.icon } : {}),
      fields: eintrag.fields,
      ...(eintrag.requiredPermission ? { requiredPermission: eintrag.requiredPermission } : {}),
      ...(eintrag.requiresApproval ? { requiresApproval: true } : {}),
    })),
    ereignisse: listEventDefinitions().map((eintrag) => ({
      type: eintrag.type,
      label: eintrag.label,
      description: eintrag.description,
      module: eintrag.module,
      variablen: (eintrag.variables ?? []).map((variable) => ({
        path: variable.path,
        label: variable.label,
        type: variable.type,
      })),
    })),
    vorlagen: listTemplates().map((eintrag) => ({
      id: eintrag.id,
      name: eintrag.name,
      description: eintrag.description,
      gruppe: eintrag.gruppe,
      ...(eintrag.icon ? { icon: eintrag.icon } : {}),
      auszufuellen: eintrag.auszufuellen ?? [],
    })),
  };
});
