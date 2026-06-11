import { template as tank } from './tank';
import { template as mech } from './mech';
import { template as flyer } from './flyer';
import { template as naval } from './naval';
import { template as walker } from './walker';
import { template as artillery } from './artillery';
import { template as scout } from './scout';
import { template as defenseStructure } from './defense-structure';
import { template as carrier } from './carrier';
import type { TemplateDef } from './types';

export type { TemplateDef };

export const TEMPLATES: readonly TemplateDef[] = [
  tank,
  mech,
  flyer,
  naval,
  walker,
  artillery,
  scout,
  defenseStructure,
  carrier,
] as const;

export { tank, mech, flyer, naval, walker, artillery, scout, defenseStructure, carrier };
