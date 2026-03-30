// @ts-nocheck — test file; Geometry type mismatches are noise
// @vitest-environment node
/**
 * Stress tests for the three drawing/annotation linkage flows in MapEditor.
 *
 * These tests extract the state-machine logic from MapEditor.svelte and verify
 * mode exclusivity, abandon flows, rapid switching, flow completion, and
 * adversarial sequences. No DOM or Svelte runtime needed — pure state logic.
 *
 * The state machine uses a discriminated union (InteractionState) instead of
 * individual boolean/nullable variables. This validates the union model
 * preserves all behavioral contracts before applying to MapEditor.svelte.
 */
import { describe, it, expect, beforeEach } from 'vitest';
// SelectedFeature and PickedFeatureRef are imported from the store — single source of truth.
// InteractionState is redeclared locally with a simplified pendingMeasurement shape
// (measurement: PendingMeasurementAnnotation) so this pure-logic test suite can run
// without the geojson/anchor/content detail that only matters at the UI boundary.
import type { SelectedFeature, PickedFeatureRef } from '$lib/stores/map-editor-state.svelte.js';

// ── Extracted state machine ─────────────────────────────────────────────────
// Mirrors the state variables, effects, and handlers from MapEditor.svelte,
// rewritten to use a discriminated union for interaction state.

type SectionId = 'annotations' | 'analysis' | 'activity';
type AnalysisTab = 'measure' | 'process';
type ToolId = 'select' | 'polygon' | 'line' | 'point';

interface Geometry {
	type: string;
	coordinates: unknown;
}

// SelectedFeature and PickedFeatureRef re-exported from $lib/stores/interaction-modes.svelte.ts
// ActiveFeature is a test-local alias for SelectedFeature (same shape).
type ActiveFeature = SelectedFeature;
type PickedFeature = PickedFeatureRef;

interface MeasurementResult {
	type: string;
	value: number;
	unit: string;
}

interface PendingMeasurementAnnotation {
	geometry: Geometry;
	result: MeasurementResult;
}

// Local InteractionState: pendingMeasurement uses a simplified shape for pure-logic tests.
// The store's InteractionState uses anchor/content — structurally compatible at the type level.
type InteractionState =
	| { type: 'idle' }
	| { type: 'featureSelected'; feature: ActiveFeature }
	| { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
	| { type: 'pickFeature'; picked?: PickedFeature }
	| { type: 'pendingMeasurement'; measurement: PendingMeasurementAnnotation };

/** Minimal reproduction of MapEditor interaction-mode state machine. */
function createInteractionModes() {
	// ── State ──
	let interactionState: InteractionState = { type: 'idle' };
	let designMode = false;
	let activeSection: SectionId | null = 'annotations';
	let analysisTab: AnalysisTab = 'process';
	let activeTool: ToolId = 'select';
	let measureResult: MeasurementResult | null = null;

	// ── Derived ──
	function getMeasureActive() {
		return activeSection === 'analysis' && analysisTab === 'measure' && !designMode;
	}

	// ── Centralized transition (mirrors MapEditor.transitionTo) ──
	function transitionTo(next: InteractionState) {
		const prev = interactionState;
		interactionState = next;

		switch (next.type) {
			case 'drawRegion':
				activeTool = 'polygon';
				break;
			case 'pickFeature':
				activeTool = 'select';
				break;
			case 'idle':
				if (prev.type === 'drawRegion' || prev.type === 'pickFeature' || prev.type === 'pendingMeasurement') {
					activeTool = 'select';
				}
				break;
		}
	}

	// ── Core cleanup ──
	function resetInteraction() {
		transitionTo({ type: 'idle' });
	}

	// ── Effects (simulated as imperative calls) ──

	/** Simulates $effect for activeSection change (line 258) */
	function effectActiveSectionChange() {
		if (activeSection !== 'annotations') {
			if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature' || interactionState.type === 'pendingMeasurement') {
				transitionTo({ type: 'idle' });
			}
		}
	}

	/** Simulates $effect for designMode toggle (line 271) */
	function effectDesignModeToggle() {
		if (designMode) {
			transitionTo({ type: 'idle' });
			activeTool = 'select'; // unconditional for design mode
		}
	}

	/** Simulates $effect for measureActive derived (line 194) */
	function effectMeasureActive() {
		if (!getMeasureActive()) {
			measureResult = null;
		}
	}

	/** Simulates $effect for tool switch clearing activeFeature (line 295) */
	function effectToolSwitch() {
		if (activeTool && activeTool !== 'select') {
			if (interactionState.type === 'featureSelected') {
				transitionTo({ type: 'idle' });
			}
			if (activeTool !== 'polygon' && interactionState.type === 'drawRegion') {
				transitionTo({ type: 'idle' });
			}
		}
	}

	/** Simulates $effect for featurePickMode selection capture (line 307) */
	function effectFeaturePickCapture(selectedFeature: { id: string; geometry: Geometry } | null, selectedLayerId: string | null) {
		if (interactionState.type === 'pickFeature' && !interactionState.picked && selectedFeature && selectedLayerId) {
			const fid = String(selectedFeature.id ?? '');
			if (fid) {
				transitionTo({ type: 'pickFeature', picked: { featureId: fid, layerId: selectedLayerId } });
			}
		}
	}

	// ── User actions ──

	/** Escape key handler (line 527) */
	function handleEscape() {
		if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
			transitionTo({ type: 'idle' });
		}
	}

	/** AnnotationPanel onrequestregion (line 820) */
	function requestRegion() {
		transitionTo({ type: 'drawRegion' });
	}

	/** AnnotationPanel onrequestfeaturepick (line 821) */
	function requestFeaturePick() {
		transitionTo({ type: 'pickFeature' });
	}

	/** Region drawn callback (line 697) */
	function onRegionDrawn(geometry: { type: 'Polygon'; coordinates: number[][][] }) {
		if (interactionState.type === 'drawRegion') {
			transitionTo({ type: 'drawRegion', geometry });
		}
	}

	/** DrawActionRow "Annotate" (line 721) */
	function drawActionAnnotate() {
		activeSection = 'annotations';
		if (interactionState.type === 'featureSelected') {
			const feature = interactionState.feature;
			transitionTo({ type: 'pickFeature', picked: { featureId: feature.featureId, layerId: feature.layerId } });
		} else {
			resetInteraction();
		}
	}

	/** DrawActionRow "Measure" (line 727) */
	function drawActionMeasure() {
		if (interactionState.type !== 'featureSelected') return;
		const geom = interactionState.feature.geometry;
		if (geom.type === 'LineString' || geom.type === 'Polygon') {
			measureResult = { type: geom.type, value: 42, unit: 'km' };
		}
		activeSection = 'analysis';
		analysisTab = 'measure';
		transitionTo({ type: 'idle' });
	}

	/** DrawActionRow "Dismiss" (line 740) */
	function drawActionDismiss() {
		if (interactionState.type === 'featureSelected') {
			transitionTo({ type: 'idle' });
		}
	}

	/** onannotationsaved (formerly onannotationchange) */
	function onAnnotationSaved(action?: 'created' | 'deleted') {
		if (action === 'created') {
			if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
				transitionTo({ type: 'idle' });
			}
		}
	}

	/** Toggle designMode (line 543 / 582) */
	function toggleDesignMode() {
		designMode = !designMode;
		effectDesignModeToggle();
	}

	/** Switch active section */
	function setActiveSection(section: SectionId | null) {
		activeSection = section;
		effectActiveSectionChange();
	}

	/** Set active tool */
	function setActiveTool(tool: ToolId) {
		activeTool = tool;
		effectToolSwitch();
	}

	/** Set an active feature (simulates selection tracking effect) */
	function simulateFeatureSelect(feature: ActiveFeature | null) {
		if (feature && (interactionState.type === 'idle' || interactionState.type === 'featureSelected')) {
			transitionTo({ type: 'featureSelected', feature });
		} else if (!feature && interactionState.type === 'featureSelected') {
			transitionTo({ type: 'idle' });
		}
	}

	/** Set pending measurement annotation */
	function setPendingMeasurement(m: PendingMeasurementAnnotation | null) {
		if (m) {
			transitionTo({ type: 'pendingMeasurement', measurement: m });
		} else if (interactionState.type === 'pendingMeasurement') {
			transitionTo({ type: 'idle' });
		}
	}

	return {
		// State accessors (derived from union)
		get interactionState() { return interactionState; },
		get annotationRegionMode() { return interactionState.type === 'drawRegion'; },
		get annotationRegionGeometry() { return interactionState.type === 'drawRegion' ? interactionState.geometry : undefined; },
		get featurePickMode() { return interactionState.type === 'pickFeature' && !interactionState.picked; },
		get pickedFeature() { return interactionState.type === 'pickFeature' ? interactionState.picked : undefined; },
		get activeFeature() { return interactionState.type === 'featureSelected' ? interactionState.feature : null; },
		get pendingMeasurementAnnotation() { return interactionState.type === 'pendingMeasurement' ? interactionState.measurement : null; },
		get designMode() { return designMode; },
		get activeSection() { return activeSection; },
		get analysisTab() { return analysisTab; },
		get activeTool() { return activeTool; },
		get measureResult() { return measureResult; },
		get measureActive() { return getMeasureActive(); },

		// Actions
		resetInteraction,
		handleEscape,
		requestRegion,
		requestFeaturePick,
		onRegionDrawn,
		drawActionAnnotate,
		drawActionMeasure,
		drawActionDismiss,
		onAnnotationSaved,
		toggleDesignMode,
		setActiveSection,
		setActiveTool,
		simulateFeatureSelect,
		setPendingMeasurement,
		effectFeaturePickCapture,
		effectMeasureActive,
	};
}

// ── Test fixtures ───────────────────────────────────────────────────────────

const SAMPLE_POLYGON_GEOMETRY = {
	type: 'Polygon' as const,
	coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
};

const SAMPLE_LINE_GEOMETRY: Geometry = {
	type: 'LineString',
	coordinates: [[0, 0], [1, 1]],
};

const SAMPLE_FEATURE: ActiveFeature = {
	featureId: 'feat-001',
	layerId: 'layer-001',
	geometry: SAMPLE_POLYGON_GEOMETRY,
};

const SAMPLE_LINE_FEATURE: ActiveFeature = {
	featureId: 'feat-002',
	layerId: 'layer-001',
	geometry: SAMPLE_LINE_GEOMETRY,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MapEditor interaction modes', () => {
	let modes: ReturnType<typeof createInteractionModes>;

	beforeEach(() => {
		modes = createInteractionModes();
	});

	// ── Scenario 1: Mode exclusivity ──────────────────────────────────────

	describe('mode exclusivity', () => {
		it('entering region mode clears featurePick and activeFeature', () => {
			modes.simulateFeatureSelect(SAMPLE_FEATURE);
			expect(modes.activeFeature).not.toBeNull();

			modes.requestRegion();

			expect(modes.annotationRegionMode).toBe(true);
			expect(modes.featurePickMode).toBe(false);
			expect(modes.activeFeature).toBeNull();
		});

		it('entering featurePick mode clears region mode', () => {
			modes.requestRegion();
			expect(modes.annotationRegionMode).toBe(true);

			modes.requestFeaturePick();

			expect(modes.featurePickMode).toBe(true);
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
		});

		it('entering measure flow clears region and featurePick', () => {
			// simulateFeatureSelect first (from idle), then requestRegion would
			// clobber it with the union. Instead test the actual measure flow:
			// select a feature, then measure.
			modes.simulateFeatureSelect(SAMPLE_LINE_FEATURE);
			modes.drawActionMeasure();

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pendingMeasurementAnnotation).toBeNull();
		});

		it('resetInteraction clears all modes', () => {
			modes.simulateFeatureSelect(SAMPLE_FEATURE);
			modes.resetInteraction();
			modes.requestRegion();
			modes.resetInteraction();
			modes.setPendingMeasurement({ geometry: SAMPLE_POLYGON_GEOMETRY, result: { type: 'Polygon', value: 1, unit: 'km2' } });
			modes.resetInteraction();

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pendingMeasurementAnnotation).toBeNull();
			expect(modes.activeFeature).toBeNull();
			expect(modes.interactionState).toEqual({ type: 'idle' });
		});
	});

	// ── Scenario 2: Abandon flows ─────────────────────────────────────────

	describe('abandon flows', () => {
		it('clears region mode when switching to activity panel', () => {
			modes.requestRegion();
			expect(modes.annotationRegionMode).toBe(true);

			modes.setActiveSection('activity');

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
			expect(modes.featurePickMode).toBe(false);
		});

		it('clears featurePickMode when switching to analysis panel', () => {
			modes.requestFeaturePick();
			expect(modes.featurePickMode).toBe(true);

			modes.setActiveSection('analysis');

			expect(modes.featurePickMode).toBe(false);
			expect(modes.pickedFeature).toBeUndefined();
		});

		it('clears all modes and resets tool on Escape during region draw', () => {
			modes.requestRegion();
			expect(modes.annotationRegionMode).toBe(true);
			expect(modes.activeTool).toBe('polygon');

			modes.handleEscape();

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.featurePickMode).toBe(false);
			expect(modes.activeFeature).toBeNull();
			expect(modes.activeTool).toBe('select');
		});

		it('clears all modes on Escape during feature pick', () => {
			modes.requestFeaturePick();
			expect(modes.featurePickMode).toBe(true);

			modes.handleEscape();

			expect(modes.featurePickMode).toBe(false);
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.activeTool).toBe('select');
		});

		it('Escape is a no-op when no interactive mode is active', () => {
			// No mode active — Escape should not change tool
			modes.setActiveTool('line');
			modes.handleEscape();

			expect(modes.activeTool).toBe('line');
		});

		it('clears pending measurement when leaving annotation section', () => {
			modes.setPendingMeasurement({ geometry: SAMPLE_LINE_GEOMETRY, result: { type: 'LineString', value: 5, unit: 'km' } });

			modes.setActiveSection('activity');

			expect(modes.pendingMeasurementAnnotation).toBeNull();
		});

		it('resets tool to select when sidebar section change clears drawRegion', () => {
			modes.requestRegion();
			expect(modes.activeTool).toBe('polygon');

			modes.setActiveSection('activity');

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.activeTool).toBe('select');
		});

		it('resets tool to select when sidebar section change clears pickFeature', () => {
			modes.requestFeaturePick();
			expect(modes.activeTool).toBe('select');

			modes.setActiveSection('activity');

			expect(modes.featurePickMode).toBe(false);
			expect(modes.activeTool).toBe('select');
		});
	});

	// ── Scenario 3: Rapid mode switching (stress) ─────────────────────────

	describe('rapid mode switching', () => {
		it('region then immediate featurePick leaves only featurePick active', () => {
			modes.requestRegion();
			modes.requestFeaturePick();

			expect(modes.featurePickMode).toBe(true);
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
			expect(modes.activeTool).toBe('select');
		});

		it('featurePick then immediate region leaves only region active', () => {
			modes.requestFeaturePick();
			modes.requestRegion();

			expect(modes.annotationRegionMode).toBe(true);
			expect(modes.featurePickMode).toBe(false);
			expect(modes.activeTool).toBe('polygon');
		});

		it('region complete then immediate featurePick clears region state fully', () => {
			modes.requestRegion();
			modes.onRegionDrawn(SAMPLE_POLYGON_GEOMETRY);

			// Region completed — geometry captured, mode still drawRegion (with geometry)
			expect(modes.annotationRegionGeometry).toEqual(SAMPLE_POLYGON_GEOMETRY);

			// Immediately enter featurePick
			modes.requestFeaturePick();

			expect(modes.featurePickMode).toBe(true);
			expect(modes.annotationRegionMode).toBe(false);
			// Region geometry cleared by switching to pickFeature variant
			expect(modes.annotationRegionGeometry).toBeUndefined();
		});

		it('toggling designMode on/off rapidly clears all modes each time', () => {
			const iterations = 10;
			for (let i = 0; i < iterations; i++) {
				// Set up some state before each toggle-on
				if (i % 2 === 0) modes.requestRegion();
				else modes.requestFeaturePick();

				// Toggle ON — should clear everything
				modes.toggleDesignMode();
				expect(modes.designMode).toBe(true);
				expect(modes.annotationRegionMode).toBe(false);
				expect(modes.featurePickMode).toBe(false);
				expect(modes.activeFeature).toBeNull();
				expect(modes.activeTool).toBe('select');

				// Toggle OFF
				modes.toggleDesignMode();
				expect(modes.designMode).toBe(false);
			}
		});

		it('alternating region and featurePick N times never leaks state', () => {
			const iterations = 20;
			for (let i = 0; i < iterations; i++) {
				if (i % 2 === 0) {
					modes.requestRegion();
					expect(modes.annotationRegionMode).toBe(true);
					expect(modes.featurePickMode).toBe(false);
				} else {
					modes.requestFeaturePick();
					expect(modes.featurePickMode).toBe(true);
					expect(modes.annotationRegionMode).toBe(false);
				}
			}
		});
	});

	// ── Scenario 4: Flow completion ───────────────────────────────────────

	describe('flow completion', () => {
		it('completing annotation with region clears all annotation state', () => {
			modes.requestRegion();
			modes.onRegionDrawn(SAMPLE_POLYGON_GEOMETRY);
			expect(modes.annotationRegionGeometry).toEqual(SAMPLE_POLYGON_GEOMETRY);

			// Annotation panel fires onannotationsaved after successful create
			modes.onAnnotationSaved('created');

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pickedFeature).toBeUndefined();
			expect(modes.pendingMeasurementAnnotation).toBeNull();
		});

		it('completing annotation with feature pick clears featurePickMode', () => {
			modes.requestFeaturePick();
			// Simulate a feature being selected
			modes.effectFeaturePickCapture(
				{ id: 'feat-003', geometry: SAMPLE_POLYGON_GEOMETRY },
				'layer-002',
			);
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pickedFeature).toEqual({ featureId: 'feat-003', layerId: 'layer-002' });

			// Annotation creation completes
			modes.onAnnotationSaved('created');

			expect(modes.pickedFeature).toBeUndefined();
			expect(modes.featurePickMode).toBe(false);
		});

		it('DrawActionRow Annotate captures activeFeature into pickedFeature and switches to annotations', () => {
			modes.simulateFeatureSelect(SAMPLE_FEATURE);
			modes.drawActionAnnotate();

			// Union model: data moves atomically from featureSelected → pickFeature variant
			expect(modes.pickedFeature).toEqual({
				featureId: SAMPLE_FEATURE.featureId,
				layerId: SAMPLE_FEATURE.layerId,
			});
			expect(modes.activeFeature).toBeNull();
			expect(modes.activeSection).toBe('annotations');
		});

		it('DrawActionRow Measure sets measureResult and clears activeFeature', () => {
			modes.simulateFeatureSelect(SAMPLE_LINE_FEATURE);

			modes.drawActionMeasure();

			expect(modes.measureResult).not.toBeNull();
			expect(modes.activeFeature).toBeNull();
			expect(modes.activeSection).toBe('analysis');
			expect(modes.analysisTab).toBe('measure');
		});

		it('DrawActionRow Measure is a no-op when activeFeature is null', () => {
			modes.drawActionMeasure();

			expect(modes.measureResult).toBeNull();
			expect(modes.activeSection).toBe('annotations'); // unchanged from default
		});

		it('DrawActionRow Dismiss returns to idle from featureSelected', () => {
			modes.simulateFeatureSelect(SAMPLE_FEATURE);
			modes.drawActionDismiss();

			expect(modes.activeFeature).toBeNull();
			expect(modes.interactionState).toEqual({ type: 'idle' });
		});

		it('featurePickCapture sets pickedFeature and exits featurePickMode', () => {
			modes.requestFeaturePick();

			modes.effectFeaturePickCapture(
				{ id: 'feat-100', geometry: SAMPLE_POLYGON_GEOMETRY },
				'layer-100',
			);

			expect(modes.pickedFeature).toEqual({ featureId: 'feat-100', layerId: 'layer-100' });
			expect(modes.featurePickMode).toBe(false);
		});

		it('featurePickCapture ignores selection when not in featurePickMode', () => {
			modes.effectFeaturePickCapture(
				{ id: 'feat-100', geometry: SAMPLE_POLYGON_GEOMETRY },
				'layer-100',
			);

			expect(modes.pickedFeature).toBeUndefined();
		});
	});

	// ── Scenario 5: Adversarial sequences ─────────────────────────────────

	describe('adversarial sequences', () => {
		it('region mode persists when annotation save fires without action', () => {
			modes.requestRegion();
			modes.onRegionDrawn(SAMPLE_POLYGON_GEOMETRY);

			// onannotationsaved without 'created' does not clear draw/pick modes
			modes.onAnnotationSaved();

			// drawRegion state persists — only 'created' clears it
			expect(modes.annotationRegionMode).toBe(true);
			expect(modes.annotationRegionGeometry).toEqual(SAMPLE_POLYGON_GEOMETRY);
		});

		it('region mode clears when annotation creation succeeds', () => {
			modes.requestRegion();
			modes.onRegionDrawn(SAMPLE_POLYGON_GEOMETRY);

			modes.onAnnotationSaved('created');

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
		});

		it('resets tool to select when annotation save clears drawRegion', () => {
			modes.requestRegion();
			expect(modes.activeTool).toBe('polygon');

			modes.onAnnotationSaved('created');

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.activeTool).toBe('select');
		});

		it('featurePickMode survives click on non-feature area', () => {
			modes.requestFeaturePick();

			// Simulate click that selects nothing — effectFeaturePickCapture with null
			modes.effectFeaturePickCapture(null, null);

			// featurePickMode must survive — user has not picked a valid feature
			expect(modes.featurePickMode).toBe(true);
			expect(modes.pickedFeature).toBeUndefined();
		});

		it('entering region mode while measure is active clears measure-related state', () => {
			// Set up pending measurement
			modes.setPendingMeasurement({ geometry: SAMPLE_LINE_GEOMETRY, result: { type: 'LineString', value: 10, unit: 'km' } });

			modes.requestRegion();

			expect(modes.annotationRegionMode).toBe(true);
			// requestRegion replaces the entire union state — pendingMeasurement is gone
			expect(modes.pendingMeasurementAnnotation).toBeNull();
			expect(modes.featurePickMode).toBe(false);
		});

		it('rapid: region cancel featurePick cancel direct-draw works normally', () => {
			// Step 1: Enter region mode
			modes.requestRegion();
			expect(modes.annotationRegionMode).toBe(true);

			// Step 2: Cancel (Escape)
			modes.handleEscape();
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.activeTool).toBe('select');

			// Step 3: Enter featurePick
			modes.requestFeaturePick();
			expect(modes.featurePickMode).toBe(true);

			// Step 4: Cancel (Escape)
			modes.handleEscape();
			expect(modes.featurePickMode).toBe(false);
			expect(modes.activeTool).toBe('select');

			// Step 5: Direct draw — switch to line tool
			modes.setActiveTool('line');
			expect(modes.activeTool).toBe('line');

			// No stale mode should be active
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pendingMeasurementAnnotation).toBeNull();
		});

		it('opening annotation panel, requesting region, then closing panel clears region mode', () => {
			modes.setActiveSection('annotations');
			modes.requestRegion();
			expect(modes.annotationRegionMode).toBe(true);

			// Close panel entirely — set section to null (or any non-annotations)
			modes.setActiveSection(null as unknown as SectionId);
			// The effect checks section !== 'annotations'
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.featurePickMode).toBe(false);
		});

		it('designMode toggle during active region clears region and resets tool', () => {
			modes.requestRegion();
			expect(modes.annotationRegionMode).toBe(true);
			expect(modes.activeTool).toBe('polygon');

			modes.toggleDesignMode();

			expect(modes.designMode).toBe(true);
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.activeTool).toBe('select');
		});

		it('completing measure then immediately requesting region does not leak measureResult', () => {
			modes.simulateFeatureSelect(SAMPLE_LINE_FEATURE);
			modes.drawActionMeasure();
			expect(modes.measureResult).not.toBeNull();

			// Switch back to annotations for region request
			modes.setActiveSection('annotations');
			modes.effectMeasureActive();
			// measureActive is now false (section !== analysis), so measureResult clears
			expect(modes.measureResult).toBeNull();

			modes.requestRegion();
			expect(modes.annotationRegionMode).toBe(true);
			expect(modes.measureResult).toBeNull();
		});

		it('double annotation saved is idempotent', () => {
			modes.requestRegion();
			modes.onRegionDrawn(SAMPLE_POLYGON_GEOMETRY);

			modes.onAnnotationSaved('created');
			modes.onAnnotationSaved('created');

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pickedFeature).toBeUndefined();
		});

		it('featurePickCapture with empty string id does not set pickedFeature', () => {
			modes.requestFeaturePick();

			modes.effectFeaturePickCapture({ id: '', geometry: SAMPLE_POLYGON_GEOMETRY }, 'layer-001');

			// Empty fid should not trigger capture
			expect(modes.pickedFeature).toBeUndefined();
			expect(modes.featurePickMode).toBe(true);
		});

		it('all modes clean after full lifecycle: region draw, annotate, measure, dismiss', () => {
			// 1. Region draw flow
			modes.requestRegion();
			modes.onRegionDrawn(SAMPLE_POLYGON_GEOMETRY);
			modes.onAnnotationSaved('created');

			// 2. Feature pick + annotate
			modes.requestFeaturePick();
			modes.effectFeaturePickCapture({ id: 'f1', geometry: SAMPLE_POLYGON_GEOMETRY }, 'l1');
			modes.onAnnotationSaved('created');

			// 3. Direct draw → annotate via DrawActionRow
			modes.simulateFeatureSelect(SAMPLE_FEATURE);
			modes.drawActionAnnotate();
			modes.onAnnotationSaved('created');

			// 4. Direct draw → measure via DrawActionRow
			modes.simulateFeatureSelect(SAMPLE_LINE_FEATURE);
			modes.drawActionMeasure();

			// 5. Switch away and back
			modes.setActiveSection('activity');
			modes.setActiveSection('annotations');

			// All interaction modes must be clean
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pickedFeature).toBeUndefined();
			expect(modes.pendingMeasurementAnnotation).toBeNull();
			expect(modes.activeFeature).toBeNull();
		});
	});
});
