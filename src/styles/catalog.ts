import { conceptualColorfield } from './records/conceptual_colorfield.ts';
import { extremeMinimalAbstraction } from './records/extreme_minimal_abstraction.ts';
import { freehandDoodle } from './records/freehand_doodle.ts';
import { luminousImpasto } from './records/luminous_impasto.ts';
import { memoryColorBlocks } from './records/memory_color_blocks.ts';
import { minimalWatercolor } from './records/minimal_watercolor.ts';
import { monetEditorialImpressionism } from './records/monet_editorial_impressionism.ts';
import { risographEditorial } from './records/risograph_editorial.ts';
import { singleLineSketch } from './records/single_line_sketch.ts';
import { tornPaperEditorialCollage } from './records/torn_paper_editorial_collage.ts';
import type { StyleDefinition } from './schema.ts';

export const BUILT_IN_STYLES = [
    minimalWatercolor,
    freehandDoodle,
    memoryColorBlocks,
    singleLineSketch,
    extremeMinimalAbstraction,
    conceptualColorfield,
    luminousImpasto,
    monetEditorialImpressionism,
    tornPaperEditorialCollage,
    risographEditorial,
] as const satisfies readonly StyleDefinition[];
