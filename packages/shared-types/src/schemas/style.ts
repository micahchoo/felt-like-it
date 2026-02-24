import { z } from 'zod';

export const LegendEntrySchema = z.object({
  label: z.string(),
  color: z.string(),
  value: z.union([z.string(), z.number()]).optional(),
});

/** Metadata about which data attribute drives the visualization. */
export const StyleConfigSchema = z.object({
  /** Feature property used as a map label (FSL: labelAttribute). */
  labelAttribute: z.string().optional(),
  /** Feature property used for categorical coloring (FSL: categoricalAttribute). */
  categoricalAttribute: z.string().optional(),
  /** Feature property used for numeric/graduated coloring (FSL: numericAttribute). */
  numericAttribute: z.string().optional(),
  /**
   * Ordered unique category values detected from data (FSL: categories).
   * Used to build legend and populate the category editor UI.
   */
  categories: z.array(z.string()).optional(),
  /**
   * Numeric breakpoints for graduated/numeric styles (FSL: steps).
   * Each entry is [threshold, color] — the step expression stops.
   */
  steps: z.array(z.tuple([z.number(), z.string()])).optional(),
  /**
   * When false, features whose categorical value is not in the explicit
   * categories list are hidden (FSL: showOther: false).
   * Defaults to true (show all features; unmatched use fallback color).
   */
  showOther: z.boolean().optional(),
});

/** Label rendering settings (FSL-compatible label block). */
export const StyleLabelSchema = z.object({
  visible: z.boolean().optional(),
  minZoom: z.number().min(0).max(22).optional(),
  maxZoom: z.number().min(0).max(22).optional(),
  color: z.string().optional(),
  haloColor: z.string().optional(),
  fontSize: z.number().optional(),
});

export const LayerStyleSchema = z.object({
  /** FSL schema version (e.g. "2.3"). Optional — set when saving FSL-compatible styles. */
  version: z.string().optional(),
  /**
   * Visualization type — mirrors the Felt Style Language:
   *   simple     → all features share one style
   *   categorical → color-by a string attribute
   *   numeric    → graduated color/size by a numeric attribute (formerly "graduated")
   *   graduated  → alias for numeric (deprecated — use "numeric")
   */
  type: z.enum(['simple', 'categorical', 'numeric', 'graduated']).default('simple'),
  /** Which data attributes drive the visualization (FSL config block). */
  config: StyleConfigSchema.optional(),
  /** Label display settings (FSL label block). */
  label: StyleLabelSchema.optional(),
  /**
   * When false, clicks on this layer's features are suppressed — popups and
   * selection will not fire. Defaults to true (layer is clickable).
   * FSL: paint.isClickable
   */
  isClickable: z.boolean().optional(),
  /**
   * CSS color applied to the selected feature as a MapLibre 'case' expression
   * on the primary color paint property (fill-color / line-color / circle-color).
   * When a feature is clicked, its color switches to this value.
   * FSL: highlightColor
   */
  highlightColor: z.string().optional(),
  /**
   * When true, FillLayer sublayers for this layer are inserted before the first
   * basemap symbol layer (e.g. road labels, city names), so polygon fills render
   * underneath basemap labels ("sandwiched" between fill and label layers).
   * No effect on Line or Circle sublayers.
   * FSL: isSandwiched
   */
  isSandwiched: z.boolean().optional(),
  /**
   * Per-column display metadata (FSL: attributes block).
   * Keys are feature property names; values control how the column is
   * displayed in the DataTable, feature popup, and legend.
   */
  attributes: z
    .record(
      z.string(),
      z.object({
        /** Override column header in DataTable and popup. */
        displayName: z.string().optional(),
        /** Number formatting options for numeric values. */
        format: z
          .object({
            /** Decimal places to show (e.g. 2 → "1,234.56"). */
            mantissa: z.number().int().min(0).max(10).optional(),
            /** Thousands separator (e.g. true → "1,234"). */
            thousandSeparated: z.boolean().optional(),
          })
          .optional(),
      })
    )
    .optional(),
  /**
   * Popup display settings (FSL: popup block).
   * Controls which properties are shown in the feature click popup.
   */
  popup: z
    .object({
      /** Feature property to use as the popup title. */
      titleAttribute: z.string().optional(),
      /**
       * Ordered list of property keys to show in the popup body.
       * When set, only these keys are shown (in order).
       * When omitted, all properties are shown.
       */
      keyAttributes: z.array(z.string()).optional(),
    })
    .optional(),
  /**
   * FSL filter expressions applied to all sublayers of this layer.
   * Each filter is an infix tuple: [identifier, operator, operand]
   * Operators: lt, gt, le, ge, eq, ne, cn (contains), in, ni (not-in), and, or
   * Compound operators: and/or take arrays of sub-filters as operands.
   * Converted to MapLibre filter expressions at render time by fslFiltersToMapLibre().
   */
  filters: z.array(z.unknown()).optional(),
  // MapLibre GL paint properties (typed loosely — validated by MapLibre at runtime)
  paint: z.record(z.string(), z.unknown()),
  layout: z.record(z.string(), z.unknown()).optional(),
  legend: z.array(LegendEntrySchema).optional(),
  colorField: z.string().optional(),
  colorRamp: z.array(z.string()).optional(),
});
