# Annotations

Add geographic annotations to maps with text, images, links, and more. Annotations can be pinned to a point, attached to a region, or applied to the whole map.

## Quick Reference

| Anchor Type | Description | Map Display |
|-------------|-------------|-------------|
| Pin (Point) | Placed at a specific coordinate | Amber circle on map |
| Region (Polygon) | Drawn area on the map | Blue semi-transparent polygon |
| Feature | Attached to a specific feature in a layer | Inherits feature location |
| Map-level (Viewport) | No spatial anchor | Listed in panel only |

| Content Type | Description |
|-------------|-------------|
| Text | Plain text note (up to 5,000 characters) |
| Emoji | Single emoji with optional label |
| GIF | Animated GIF via URL |
| Image | Upload a file or paste a URL; EXIF GPS auto-fills coordinates |
| Link | URL with optional title and description |
| IIIF | IIIF Presentation API manifest with NavPlace support |

## Creating an Annotation

1. Open the **Annotations** panel (toolbar icon)
2. Click **+ Add**
3. Select the **content type** and fill in the fields
4. Select the **anchor type:**
   - **Pin** — set coordinates manually, or they default to the map center. For images, EXIF GPS data auto-fills the coordinates.
   - **Region** — click "Draw region on map", then draw a polygon on the map. The panel shows vertex count when complete.
   - **Map-level** — no spatial placement needed.
5. Click **Save annotation**

## Image Annotations

Image annotations support two input paths:
- **Upload** — select a local JPEG, PNG, WebP, or GIF (max 10 MB). An instant preview appears before upload.
- **URL** — paste a publicly accessible image URL.

If the uploaded image has EXIF GPS data, the coordinates auto-fill and a green "GPS from EXIF" badge appears.

## Region Annotations

Region annotations anchor to a drawn polygon area on the map:
1. Select "Region (Polygon)" as the anchor type
2. Click "Draw region on map" — this activates the polygon drawing tool
3. Click on the map to place vertices; double-click to close the polygon
4. The annotation panel shows "Region drawn (N vertices)"
5. Click "Redraw region" to start over, or fill in content and save

Region annotations render as a blue semi-transparent polygon on the map. Click the polygon to see the annotation popup.

## Threading

Annotations support one level of threaded replies:
- Click **Reply** on any root annotation to add a text reply
- Click **Replies** to expand/collapse the thread
- Replies inherit the parent annotation's anchor

## IIIF Annotations

IIIF annotations link to a Presentation API manifest (v2 or v3). After saving, click "Fetch NavPlace" to extract geographic features from the manifest's NavPlace extension (if present).

## Clicking Annotations on the Map

- **Point annotations** appear as amber circles. Click to see the content popup.
- **Region annotations** appear as blue polygons. Click to see the content popup.
- **Map-level annotations** have no map marker — they're listed in the panel only.
