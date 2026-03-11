# Maps & Layers

Create maps, import spatial data, draw features, run spatial analysis, and export results.

## Quick Reference

| Action | How |
|--------|-----|
| Create a map | Dashboard → type a name → click + |
| Clone a map | Dashboard → map menu → Clone |
| Create from template | Dashboard → Templates tab → click a template |
| Import data | Toolbar → Import → drag file or browse |
| Draw features | Left toolbar → select point/line/polygon tool → click map |
| Open data table | Toolbar → Table |
| Filter features | Toolbar → Filter icon (opens filter panel above data table) |
| Measure | Toolbar → Measure icon → draw line or polygon |
| Geoprocess | Toolbar → Geoprocessing icon → select operation |
| Export | Toolbar → Export → select format |
| Save viewport | Toolbar → Save viewport icon |
| Change basemap | Bottom-left → Basemap picker |

## Creating Maps

From the dashboard, type a map name in the input field and click the + button. The map opens in the editor with a default OSM basemap.

**Clone:** Duplicates a map with all its layers and features. Open the map menu on the dashboard and select Clone.

**Templates:** Pre-built maps available to all users. Switch to the Templates tab on the dashboard to create a new map from a template.

## Importing Data

Click **Import** in the toolbar to open the import dialog. Drag a file or click to browse.

| Format | Extensions | Notes |
|--------|-----------|-------|
| GeoJSON | `.geojson`, `.json`, `.geojsonl` | Standard GeoJSON or newline-delimited |
| CSV | `.csv` | Requires latitude/longitude columns, or address column for geocoding |
| Shapefile | `.zip` | Must be a zip containing `.shp`, `.shx`, `.dbf` |
| KML | `.kml` | Google Earth format |
| GPX | `.gpx` | GPS track/waypoint format |
| GeoPackage | `.gpkg` | OGC GeoPackage |

**CSV geocoding:** If your CSV has an address column but no lat/lng, the import pipeline geocodes addresses using Nominatim. The server must have `NOMINATIM_URL` configured for bulk imports (OSM Nominatim limits to 1 req/s).

The layer name defaults to the filename. You can change it before importing.

## Drawing Features

The left toolbar provides drawing tools:

| Tool | Icon | Action |
|------|------|--------|
| Select | Arrow | Click features to select; drag to move |
| Point | Circle | Click to place a point |
| Line | Line | Click to add vertices; double-click to finish |
| Polygon | Pentagon | Click to add vertices; double-click to close |

Drawn features are saved to the active layer. **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z) works for drawn features.

You must have an active layer selected in the layer panel before drawing.

## Data Table

Click **Table** in the toolbar to open the data table for the active layer.

- **Search:** Type in the search box to filter across all attributes
- **Sort:** Click any column header to sort ascending/descending
- **Click a row** to select that feature and zoom the map to it
- **Feature count** shows filtered vs. total (e.g. "12 of 340 features")

Column display names can be customized in the Style Panel.

## Attribute Filters

Click the filter icon in the toolbar to open the filter panel. Add per-attribute filters (equals, contains, greater than, etc.) to narrow which features display on the map and in the data table. Filters are ephemeral — they reset when you leave the map.

## Feature Popups

Click any feature on the map to see its attributes in a popup. Configure which attributes appear and their display names in the Style Panel (Popup section).

## Measurement

Click the **Measure** icon in the toolbar to enter measurement mode.

- **Distance:** Draw a line; see length in m/km/ft/mi with vertex count
- **Area:** Draw a polygon; see area in m²/km²/ft²/mi² and perimeter

Switch units with the dropdown. Click Clear to exit measurement mode. Measurements are not saved — they're for quick reference.

## Geoprocessing

Click the **Geoprocessing** icon in the toolbar. Select an operation and configure inputs.

| Operation | Input | Output |
|-----------|-------|--------|
| **Buffer** | One layer + distance (km) | Polygon layer with buffered geometries |
| **Clip** | Source layer + clip mask layer | Source features trimmed to mask boundary |
| **Intersect** | Layer A + Layer B | Features where A and B overlap |
| **Union** | One layer | All features merged into one geometry |
| **Dissolve** | One layer + optional field | Merge features; group by field value if specified |
| **Convex Hull** | One layer | Smallest convex polygon containing all features |
| **Centroid** | One layer | Point layer with center of each feature |
| **Point in Polygon** | Points layer + polygons layer | Spatial join: each point gets polygon attributes |
| **Nearest Neighbor** | Layer A + Layer B | Each feature in A gets nearest feature from B |
| **Aggregate** | Points + polygons + optional numeric field | Count/sum/avg of points within each polygon |

Each operation creates a new layer with the result.

## Exporting Data

Click **Export** in the toolbar. Select a layer and format:

| Format | Output |
|--------|--------|
| GeoJSON | `.geojson` file |
| Shapefile | `.shp.zip` archive |
| GeoPackage | `.gpkg` file |
| PDF | Map image with layer title |
| PNG | High-resolution (2x) map screenshot |

PNG and PDF capture the current map view including visible layers and the legend.

## Saving Viewport

Click the save viewport icon in the toolbar to save the current map center, zoom, bearing, and pitch as the default view. This is what other users see when they open the map.

## Basemap

Click **Basemap** at the bottom-left to switch between available basemaps (OpenStreetMap, satellite, etc.).
