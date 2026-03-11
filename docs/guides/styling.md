# Styling Layers

Control how features appear on the map. Each layer has its own style.

## Quick Reference

| Style Type | Use When | Example |
|------------|----------|---------|
| Simple | All features one color | "Show all parks in green" |
| Categorical | Color by a text attribute | "Color countries by continent" |
| Choropleth | Color by a numeric attribute | "Shade counties by population density" |
| Heatmap | Show density of point clusters | "Visualize earthquake frequency" |

## Opening the Style Panel

Click the paint-brush icon on any layer in the layer panel, or double-click the layer name.

## Simple

All features share one color. Configure:
- **Color** — fill color
- **Opacity** — 0-100%
- **Highlight color** — color when a feature is selected/hovered

## Categorical

Color features by a text attribute. Each unique value gets its own color.

1. Set style type to **Categorical**
2. Select the **attribute** to categorize by
3. Colors are auto-assigned; click any swatch to change it
4. Toggle **Show other** to show/hide features with values not in the category list

## Choropleth

Color features by a numeric attribute using a color ramp.

1. Set style type to **Choropleth** (or Numeric)
2. Select the **numeric attribute**
3. Choose a **color ramp** (ColorBrewer presets)
4. Set **number of classes** (2-9)
5. Choose **classification method:**
   - **Quantile** — equal number of features per class
   - **Equal interval** — equal value range per class

## Heatmap

Density visualization for point layers only. Shows where points cluster.

1. Set style type to **Heatmap**
2. Configure:
   - **Weight attribute** — optional numeric property to weight points (default: uniform)
   - **Radius** — kernel size in pixels (1-200)
   - **Intensity** — brightness multiplier (0.1-5)

Heatmaps use deck.gl and render on a separate canvas overlay.

## Labels

Available for all style types:
- **Label attribute** — which property to display as text on the map
- **Visibility** — show/hide labels
- **Zoom range** — min/max zoom for label display
- **Font size, color, halo** — text styling

## Popup Configuration

Control what appears when a user clicks a feature:
- **Title attribute** — which property to show as the popup title
- **Visible attributes** — check/uncheck which columns appear
- **Column labels** — custom display names for properties (also used in the data table)

## Sandwiched Mode

For polygon and mixed layers: places the fill layer below basemap labels so road names and place labels remain visible on top of colored polygons. Toggle with the **Sandwiched** checkbox.
