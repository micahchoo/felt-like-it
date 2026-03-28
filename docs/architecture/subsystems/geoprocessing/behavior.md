# Geoprocessing Subsystem — Behavior (Zoom Level 8)

> Flow traces through the geoprocessing subsystem: PostGIS operations, spatial joins, measurement, error handling, and activity logging.

**Cross-references:** [components](components.md) | [data-pipeline behavior](../data-pipeline/behavior.md) | [map-editor behavior](../map-editor/behavior.md)

---

## 1. Buffer Operation Flow (Representative of All 10 PostGIS Ops)

All geoprocessing operations follow the same mutation pipeline. Buffer is traced as the representative example.

```
User clicks "Analysis" tab in SidePanel
  → MapEditor.svelte:514 sets activeSection='analysis'
  → analysisTab defaults to 'process' (line 171)
  → GeoprocessingPanel.svelte renders

User selects Buffer operation
  → Selects source layer (dropdown from `layers` prop)
  → Enters buffer distance (meters)
  → Enters output layer name
  → Clicks "Run"

GeoprocessingPanel.svelte
  → geoprocessingMutation.mutate({
      mapId,
      op: { type: 'buffer', sourceLayerId, distance },
      outputLayerName
    })
  → tRPC: geoprocessing.run.mutate(input)

Server: geoprocessingRouter.run (protectedProcedure)
  → Validates input via GeoprocessingOpSchema (Zod discriminated union)
  → Calls requireMapAccess(userId, mapId, 'editor')
  → Dispatches to runGeoprocessing(db, mapId, op, outputLayerName, userId)

runGeoprocessing() — apps/web/src/lib/server/geo/geoprocessing.ts
  → Switch on op.type
  → Buffer case: raw SQL
    INSERT INTO features (layer_id, geometry, properties)
    SELECT $newLayerId, ST_Buffer(geometry::geography, $distance)::geometry, properties
    FROM features WHERE layer_id = $sourceLayerId
  → Creates new layer row first (INSERT INTO layers)
  → Logs map_event: action='geoprocessing.completed',
    metadata={ operation: 'buffer', outputLayerName }

Response returns to client
  → onSuccess: queryClient.invalidateQueries(queryKeys.layers.list({ mapId }))
  → onlayercreated?.() callback fires
  → LayerPanel re-renders with new layer visible
  → Toast: success message
```

**Key observation:** All 10 operations (7 unary/binary + 3 aggregation) follow the identical mutation→SQL→new-layer→invalidate pipeline. The only variation is the SQL template per operation type.

---

## 2. Spatial Join Flow

```
User selects "Point in Polygon" or "Nearest Neighbor"
  → GeoprocessingPanel shows source + target layer dropdowns
  → For aggregation (count/sum/avg): also shows property field dropdown

tRPC mutation → runGeoprocessing()
  → Point-in-Polygon:
    LEFT JOIN ... ST_Within(p.geometry, poly.geometry)
    DISTINCT ON (p.id)  — each point matched to one polygon
  → Nearest Neighbor:
    CROSS JOIN LATERAL ... ORDER BY a.geometry <-> b.geometry LIMIT 1
    (Uses PostGIS KNN index operator)
  → Aggregation:
    LEFT JOIN + ST_Within + GROUP BY polygon
    COUNT/SUM/AVG over point properties

Result: new layer with joined/aggregated data
  → Same invalidation + toast flow as Buffer
```

**Left Join semantics:** All spatial joins use LEFT JOIN so polygons with no matching points still appear in output (with NULL/0 values). This prevents silent data loss.

---

## 3. Measurement Flow

Measurement is distinct from geoprocessing — it runs client-side via `geo-engine` package, not through PostGIS.

```
User clicks "Measure & Tools" section in SidePanel
  → MapEditor.svelte:727 sets activeSection='analysis', analysisTab='measure'
  → measureActive = $derived(activeSection === 'analysis' && analysisTab === 'measure' && !designMode)
    (MapEditor.svelte:179)

measureActive → DrawingToolbar activates measurement mode
  → Interaction state machine: transitionTo('pendingMeasurement')
  → Terra Draw enters line/polygon drawing mode

User draws on map (line for distance, polygon for area)
  → Terra Draw fires onfinish event with GeoJSON geometry
  → Geometry passed to geo-engine/measurement.ts

geo-engine/measurement.ts (packages/geo-engine/src/measurement.ts)
  → Uses @turf/length, @turf/area, @turf/distance
  → Returns { distance?, area?, perimeter? } in metric units
  → Results are EPHEMERAL — not persisted to database

MeasurementPanel.svelte renders results
  → Displays distance (km/m), area (km²/m²), perimeter
  → Results cleared when user starts new measurement or exits mode

User exits measurement:
  → activeSection changes or analysisTab changes
  → measureActive becomes false
  → Interaction state machine: transitionTo('idle')
  → Terra Draw drawing cleared
```

**Key distinction:** Geoprocessing creates persistent new layers. Measurement is ephemeral read-only display.

---

## 4. Error Handling

```
Validation errors (client-side):
  → GeoprocessingOpSchema (Zod) rejects invalid input before mutation fires
  → Missing required fields: form validation prevents submission

Server errors:
  → requireMapAccess: 403 if user lacks editor role
  → PostGIS SQL errors (invalid geometry, empty source layer):
    → tRPC error propagates to client
    → createMutation onError → toast with error message
  → No explicit timeout on PostGIS operations (relies on DB statement_timeout if set)

Empty results:
  → Operations that produce empty layers succeed silently
  → New layer is created with 0 features
  → No warning to user about empty output (potential UX gap)
```

---

## 5. Activity Feed Integration

```
After successful geoprocessing:
  → runGeoprocessing() inserts map_event row:
    {
      mapId, userId,
      action: 'geoprocessing.completed',
      metadata: { operation: op.type, outputLayerName }
    }
  → Fire-and-forget (no await on insert — non-blocking)

ActivityFeed.svelte (apps/web/src/lib/components/map/ActivityFeed.svelte)
  → Filters: 'geoprocessing.completed' grouped under 'imports' category (line 35)
  → Display: "Ran {operation} → \"{outputLayerName}\"" (line 151-154)
  → Icon: plus-in-circle SVG (line 124)
```

---

## 6. Performance Characteristics

| Aspect | Current State | Risk |
|--------|--------------|------|
| Execution model | Synchronous tRPC mutation (no BullMQ) | Large datasets block the web process |
| Timeout | No explicit timeout | Long-running ST_Buffer on 10K+ features could hang |
| Batching | Single SQL per operation | Efficient — PostGIS handles set operations natively |
| Result size | Unbounded | New layer could be larger than source (e.g., buffer expands geometry) |
| Concurrency | No locking | Two users running ops on same layer simultaneously is safe (read-only source) |

---

## Seed Proposals

```json
{"finding": "No timeout on geoprocessing SQL operations", "file": "apps/web/src/lib/server/geo/geoprocessing.ts", "severity": "medium", "seed_type": "task", "reason": "Large dataset buffer could hang web process indefinitely"}
{"finding": "Empty geoprocessing results create silent empty layers", "file": "apps/web/src/lib/server/geo/geoprocessing.ts", "severity": "low", "seed_type": "task", "reason": "User gets no feedback when operation produces no features"}
{"finding": "geoprocessing.completed grouped under 'imports' filter in ActivityFeed", "file": "apps/web/src/lib/components/map/ActivityFeed.svelte", "line": 35, "severity": "low", "seed_type": "task", "reason": "Misleading categorization — geoprocessing is not an import"}
```
