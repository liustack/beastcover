import { conceptualColorfield } from './records/conceptual_colorfield.ts';
import { luminousImpasto } from './records/luminous_impasto.ts';
import { risographEditorial } from './records/risograph_editorial.ts';
import { tornPaperEditorialCollage } from './records/torn_paper_editorial_collage.ts';
import type { StyleDefinition } from './schema.ts';

export const BUILT_IN_STYLES = [
    risographEditorial,
    luminousImpasto,
    tornPaperEditorialCollage,
    conceptualColorfield,
] as const satisfies readonly StyleDefinition[];
