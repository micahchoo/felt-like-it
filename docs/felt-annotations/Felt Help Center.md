---
title: "Felt Help Center"
source: "https://help.felt.com/annotations/annotations"
author:
published: 2026-03-06
created: 2026-04-24
description: "Add helpful text, arrows, data, and callouts to maps for clearer communication with annotation tools."
tags:
  - "clippings"
---
<iframe src="https://cdn.iframe.ly/yNX0smP" allowfullscreen="" allow="accelerometer *; clipboard-write *; encrypted-media *; gyroscope *; picture-in-picture *; web-share *;"></iframe>

Annotations allow you to highlight important features, add context, and create a more engaging map experience. With annotations you can draw pins, lines, routes, areas, and circles. These drawn features can be exported as spatial data directly from the map. Other annotation tools like marker, text, notes, and links are designed to enhance your storytelling and guide viewers through your map's key points. All of Felt’s Annotations are located on the top [toolbar](https://help.felt.com/getting-started/tour-the-interface#toolbar) and can also be accessed via [shortcuts](https://help.felt.com/getting-started/keyboard-shortcuts).

## Annotation tools

Felt offers several [tools](https://help.felt.com/getting-started/tour-the-interface#tools) called annotations (formerly called "elements") to help you communicate your spatial narrative. To access the annotation tools, Editors and Contributors can click on the in the top toolbar, or from the button in the Field App. Annotations can be easily duplicated (`Cmd/Ctrl+D`), repositioned, rotated and [styled](https://help.felt.com/annotations/styling-and-grouping).

Want to use your Felt-created data somewhere else? Points, lines, routes, polygons, and circles can be exported as geojson files and brought into QGIS, OpenStreetMap or any of your tools of choice. See [Export as data](https://help.felt.com/annotations/annotations#export-as-data) to learn more.

### Pin

- Add a pin to the map to locate a place.
- Customize the pin style and add images and information fields in the details panel.
- Pins can also be created via Search (see [Navigation & Search](https://help.felt.com/getting-started/tour-the-interface#searching-for-places) for more details).

**Tip:** You can paste geographic coordinates directly on a Felt map and a pin will be placed at that location.

### Line

- Emphasize linear features by drawing lines on your map.
- Vertices can be added or moved after the line is created.
- If you wish to extend a line, click the last point and select ‘extend.’
- From the details panel, turn the option for **Distance** on to to **see the distance** of lines as you draw.
- Hold `**Shift**` to draw straight or perpendicular lines.

### Route

- Route will navigate to the shortest path between your first anchor and where you move your cursor.
- To draw routes on the map choose drive, cycle, walk or flight options.
- From the details panel, turn the option for **Distance** on to to **see the distance** as you draw.
- Add anchors for more control over your path.
- Hold `**Shift**` to draw a straight line.

### Polygon

- Emphasize areas by drawing polygons on your map.
- Vertices can be added or moved after the polygon is created.
- From the details panel, turn the option for **Area** on to to **see the area** of polygon features as you draw.

### Rectangle

- Click to draw the first corner, then click again to set one side of the rectangle, and then extend in one direction complete the shape
- Rectangles will always have 4 vertices
- They can be resized or rotated after creation while the aspect ratio (length to width ratio) remains locked
- Hold `**Shift**` after drawing the second corner to create a perfect square

### Circle

- After selecting the Circle tool, click on the center and drag outwards to a certain radius.
- The radius can be specified as a numeric value in meters, kilometers, feet or miles.

### Marker

Create free-form markings like arrows to highlight areas of interest.

### Highlighter

Add semi-transparent markings that allow the basemap to show through, perfect for subtle emphasis while maintaining visibility of underlying features.

### Text

Add labels and descriptions directly on your map. Adjust font style, size, color, and position to create clear, readable annotations.

### Note

Create text boxes to explain features or provide additional context. Notes are ideal for adding detailed information that wouldn't fit in a simple label.

### Link

Embed URLs like websites directly on your map either by selecting the link tool and entering the URL or by pasting the URL directly on your map. Links display with preview thumbnails by default.

### Video

Embed videos directly on your map, with preview thumbnails either by selecting the video tool and entering the URL or by pasting the URL directly on your map. YouTube links will display with full video previews.

**Tip:** You can drag and drop photos directly onto your Felt map. If the image contains embedded location metadata (EXIF), Felt will read it and prompt you to place the photo at its recorded location.

### Images

- Felt can overlay images and PDFs on a map
- Images uploaded to Felt are treated like Polygon annotations and sit on top of the layers
- With these images you can set **Opacity** and **On click** behavior
- There are two **On click** settings: `Do nothing` or `Show larger`

## Adding attributes

Annotations have names, descriptions, and images, as well as an unlimited number of attributes (pairs of names and values).

To add attributes:

- Select an annotation or group of annotations you want to add attributes to.
- In the details panel on the right side, click on the **Details** tab.
- Click "Add row" to create a new attribute.
- Enter a name for your attribute (e.g., "year") and then press Tab to move to the value field.
- Enter the value for your attribute (e.g., "1990").
- To add this attribute to multiple annotations at once:
	- Select a group of annotations
	- Click "Select group contents"
	- In the Details tab, look for the attribute you want to apply
	- Select "Add row to all selected annotations"
![](https://help.felt.com/~gitbook/image?url=https%3A%2F%2F217108486-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252FmRfGitkyjOEMvVsEyGWN%252Fuploads%252F4V1VdbQp1TNpNEEaO2hc%252Fimage.png%3Falt%3Dmedia%26token%3De9cfbf6d-8dab-4822-9e4c-07da05a01b82&width=768&dpr=3&quality=100&sign=809599&sv=2)

## Enabling measurements

You can enable measurements for routes, lines and polygons both during creation and also later in the annotations detail panel.

- Select an annotations or group of annotations and choose the option to show Area (for polygons) or Distance (for lines and routes)

## Convert to layers

Felt recommends using layers to manage your spatial datasets. To learn more about editing data layers, see [Editing layers](https://help.felt.com/layers/editing-layers).

You can convert pins, lines, polygons, and other annotations into layers to unlock all Felt's [layer](https://help.felt.com/layers/table-view) functionality. Transform your hand-drawn map annotations into structured data that can be used in your Felt map or exported to other GIS applications.

- Select the annotations(s) you want to export
- Right-click and go to `**Actions**` → `**Convert to layer**` to transform your annotations into a data layer
![](https://help.felt.com/~gitbook/image?url=https%3A%2F%2F217108486-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252FmRfGitkyjOEMvVsEyGWN%252Fuploads%252FBXcnUsOTadioglDYSumN%252FScreenshot%25202025-12-02%2520at%25203.51.40%25E2%2580%25AFPM.png%3Falt%3Dmedia%26token%3Ddd8666e0-ad9d-480f-87b9-ff65f2c54573&width=768&dpr=3&quality=100&sign=6b47e6ae&sv=2)

### Export as data

You can download individual annotations using the overflow (three-dot) menu or by using the right-click menu.

**Types of** annotations **that can be exported**

- ✅ Pins, lines, polygons, routes, circle, marker, highlighter and notes
- ❌ Images, videos, links and text

There are two ways to export your map annotations as GeoJSON:

- Go to `**Felt > File**` from the top-left menu
	- You can export all annotations with **Export all** annotations or only selected annotations with **Export selected**
- Alternatively, you can export selected annotations on the map by right-clicking and selecting the option **Export > To GeoJSON**
![](https://help.felt.com/~gitbook/image?url=https%3A%2F%2F217108486-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252FmRfGitkyjOEMvVsEyGWN%252Fuploads%252FcpuKe6gz6beILAu48ntO%252FScreenshot%25202025-11-13%2520at%25202.08.38%25E2%2580%25AFPM.png%3Falt%3Dmedia%26token%3D6b917cd6-a913-42fe-9814-d926d01c4a27&width=768&dpr=3&quality=100&sign=2d3f5f2&sv=2)

## Best practices

For most data-driven workflows [Editing layers](https://help.felt.com/layers/editing-layers) in Felt is the better choice and we recommend working with layers in Felt. Annotations work well for quick markup and very small datasets. Here's when to use each:

#### Layer editing is best for:

- Datasets with more than 100 features
- Using table view to see and edit all your data at once
- Advanced styling options (categorical symbology, graduated colors, zoom-based visibility, label control, etc.)
- Better map performance through tiling (especially important for large datasets)
- The ability to export and reuse your data across multiple maps
- Enterprise plans in Felt

#### Annotations are best for:

- Simple styling for a handful of features
- Lightweight additions that don't need structured data management
- Free and Team plans in Felt

You can [convert annotations to a data layer](https://help.felt.com/annotations/converting-annotations-layers#converting-annotations-to-layers) to get started with editable layers. Right-click your group of annotations and select **Actions** → **Convert to layer** to unlock full layer functionality.

Last updated