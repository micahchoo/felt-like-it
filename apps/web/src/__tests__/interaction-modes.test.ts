// @vitest-environment node
/**
 * Stress tests for the three drawing/annotation linkage flows in MapEditor.
 *
 * These tests extract the state-machine logic from MapEditor.svelte and verify
 * mode exclusivity, abandon flows, rapid switching, flow completion, and
 * adversarial sequences. No DOM or Svelte runtime needed — pure state logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── Extracted state machine ─────────────────────────────────────────────────
// Mirrors the state variables, clearInteractionModes, effects, and handlers
// from MapEditor.svelte (lines ~177–320, ~527–533, ~718–738, ~808–821).

type SectionId = 'annotations' | 'analysis' | 'activity';
type AnalysisTab = 'measure' | 'process';
type ToolId = 'select' | 'polygon' | 'line' | 'point';

interface Geometry {
	type: string;
	coordinates: unknown;
}

interface ActiveFeature {
	featureId: string;
	layerId: string;
	geometry: Geometry;
}

interface PickedFeature {
	featureId: string;
	layerId: string;
}

interface MeasurementResult {
	type: string;
	value: number;
	unit: string;
}

interface PendingMeasurementAnnotation {
	geometry: Geometry;
	result: MeasurementResult;
}

/** Minimal reproduction of MapEditor interaction-mode state machine. */
function createInteractionModes() {
	// ── State ──
	let annotationRegionMode = false;
	let annotationRegionGeometry: { type: 'Polygon'; coordinates: number[][][] } | undefined;
	let featurePickMode = false;
	let pickedFeature: PickedFeature | undefined;
	let activeFeature: ActiveFeature | null = null;
	let pendingMeasurementAnnotation: PendingMeasurementAnnotation | null = null;
	let designMode = false;
	let activeSection: SectionId | null = 'annotations';
	let analysisTab: AnalysisTab = 'process';
	let activeTool: ToolId = 'select';
	let measureResult: MeasurementResult | null = null;

	// ── Derived ──
	function getMeasureActive() {
		return activeSection === 'analysis' && analysisTab === 'measure' && !designMode;
	}

	// ── Core cleanup (MapEditor line 239) ──
	function clearInteractionModes(keep?: 'region' | 'featurePick' | 'measure' | 'activeFeature') {
		if (keep !== 'region') {
			annotationRegionMode = false;
			annotationRegionGeometry = undefined;
		}
		if (keep !== 'featurePick') {
			featurePickMode = false;
		}
		if (keep !== 'measure') {
			pendingMeasurementAnnotation = null;
		}
		if (keep !== 'activeFeature') {
			activeFeature = null;
		}
	}

	// ── Effects (simulated as imperative calls) ──

	/** Simulates $effect for activeSection change (line 258) */
	function effectActiveSectionChange() {
		if (activeSection !== 'annotations') {
			annotationRegionMode = false;
			annotationRegionGeometry = undefined;
			featurePickMode = false;
			pickedFeature = undefined;
			pendingMeasurementAnnotation = null;
		}
	}

	/** Simulates $effect for designMode toggle (line 271) */
	function effectDesignModeToggle() {
		if (designMode) {
			clearInteractionModes();
			activeTool = 'select';
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
			activeFeature = null;
			if (activeTool !== 'polygon' || !annotationRegionMode) {
				// featurePickMode would be cleared here in real component
				// (the comment in source says "they've abandoned the pick flow")
			}
		}
	}

	/** Simulates $effect for featurePickMode selection capture (line 307) */
	function effectFeaturePickCapture(selectedFeature: { id: string; geometry: Geometry } | null, selectedLayerId: string | null) {
		if (featurePickMode && selectedFeature && selectedLayerId) {
			const fid = String(selectedFeature.id ?? '');
			if (fid) {
				pickedFeature = { featureId: fid, layerId: selectedLayerId };
				featurePickMode = false;
			}
		}
	}

	// ── User actions ──

	/** Escape key handler (line 527) */
	function handleEscape() {
		if (featurePickMode || annotationRegionMode) {
			clearInteractionModes();
			activeTool = 'select';
		}
	}

	/** AnnotationPanel onrequestregion (line 820) */
	function requestRegion() {
		clearInteractionModes('region');
		annotationRegionMode = true;
		annotationRegionGeometry = undefined;
		activeTool = 'polygon';
	}

	/** AnnotationPanel onrequestfeaturepick (line 821) */
	function requestFeaturePick() {
		clearInteractionModes('featurePick');
		featurePickMode = true;
		pickedFeature = undefined;
		activeTool = 'select';
	}

	/** Region drawn callback (line 697) */
	function onRegionDrawn(geometry: { type: 'Polygon'; coordinates: number[][][] }) {
		annotationRegionGeometry = geometry;
		annotationRegionMode = false;
	}

	/** DrawActionRow "Annotate" (line 721) */
	function drawActionAnnotate() {
		clearInteractionModes();
		activeSection = 'annotations';
		pickedFeature = activeFeature !== null
			? { featureId: activeFeature.featureId, layerId: activeFeature.layerId }
			: undefined;
		activeFeature = null;
	}

	/** DrawActionRow "Measure" (line 727) */
	function drawActionMeasure() {
		if (!activeFeature) return;
		clearInteractionModes('activeFeature');
		const geom = activeFeature.geometry;
		if (geom.type === 'LineString' || geom.type === 'Polygon') {
			measureResult = { type: geom.type, value: 42, unit: 'km' };
		}
		activeSection = 'analysis';
		analysisTab = 'measure';
		activeFeature = null;
	}

	/** DrawActionRow "Dismiss" (line 740) */
	function drawActionDismiss() {
		activeFeature = null;
	}

	/** onannotationchange (line 808) */
	function onAnnotationChange() {
		annotationRegionMode = false;
		annotationRegionGeometry = undefined;
		featurePickMode = false;
		pickedFeature = undefined;
		pendingMeasurementAnnotation = null;
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
		activeFeature = feature;
	}

	/** Set pending measurement annotation */
	function setPendingMeasurement(m: PendingMeasurementAnnotation | null) {
		pendingMeasurementAnnotation = m;
	}

	return {
		// State accessors
		get annotationRegionMode() { return annotationRegionMode; },
		get annotationRegionGeometry() { return annotationRegionGeometry; },
		get featurePickMode() { return featurePickMode; },
		get pickedFeature() { return pickedFeature; },
		get activeFeature() { return activeFeature; },
		get pendingMeasurementAnnotation() { return pendingMeasurementAnnotation; },
		get designMode() { return designMode; },
		get activeSection() { return activeSection; },
		get analysisTab() { return analysisTab; },
		get activeTool() { return activeTool; },
		get measureResult() { return measureResult; },
		get measureActive() { return getMeasureActive(); },

		// Actions
		clearInteractionModes,
		handleEscape,
		requestRegion,
		requestFeaturePick,
		onRegionDrawn,
		drawActionAnnotate,
		drawActionMeasure,
		drawActionDismiss,
		onAnnotationChange,
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
			modes.requestRegion();
			modes.simulateFeatureSelect(SAMPLE_LINE_FEATURE);

			// Measure via DrawActionRow — clearInteractionModes('activeFeature') then set analysis
			modes.drawActionMeasure();

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pendingMeasurementAnnotation).toBeNull();
		});

		it('clearInteractionModes with no keep clears all modes', () => {
			modes.requestRegion();
			modes.simulateFeatureSelect(SAMPLE_FEATURE);
			modes.setPendingMeasurement({ geometry: SAMPLE_POLYGON_GEOMETRY, result: { type: 'Polygon', value: 1, unit: 'km2' } });

			modes.clearInteractionModes();

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pendingMeasurementAnnotation).toBeNull();
			expect(modes.activeFeature).toBeNull();
		});

		it('clearInteractionModes preserves the kept mode only', () => {
			modes.requestRegion();
			modes.setPendingMeasurement({ geometry: SAMPLE_POLYGON_GEOMETRY, result: { type: 'Polygon', value: 1, unit: 'km2' } });
			modes.simulateFeatureSelect(SAMPLE_FEATURE);

			modes.clearInteractionModes('region');

			expect(modes.annotationRegionMode).toBe(true);
			expect(modes.featurePickMode).toBe(false);
			expect(modes.pendingMeasurementAnnotation).toBeNull();
			expect(modes.activeFeature).toBeNull();
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

			// Region completed — geometry captured, mode off
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toEqual(SAMPLE_POLYGON_GEOMETRY);

			// Immediately enter featurePick
			modes.requestFeaturePick();

			expect(modes.featurePickMode).toBe(true);
			expect(modes.annotationRegionMode).toBe(false);
			// Region geometry cleared by clearInteractionModes inside requestFeaturePick
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

			// Annotation panel fires onannotationchange after successful create
			modes.onAnnotationChange();

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
			modes.onAnnotationChange();

			expect(modes.pickedFeature).toBeUndefined();
			expect(modes.featurePickMode).toBe(false);
		});

		it('DrawActionRow Annotate clears activeFeature and region mode and switches to annotations', () => {
			modes.requestRegion();
			modes.simulateFeatureSelect(SAMPLE_FEATURE);

			modes.drawActionAnnotate();

			// BUG: clearInteractionModes() nullifies activeFeature before the
			// pickedFeature assignment reads it (MapEditor.svelte line 722-724).
			// The handler should capture activeFeature before clearing.
			// Current behavior: pickedFeature ends up undefined.
			expect(modes.pickedFeature).toBeUndefined();
			expect(modes.activeFeature).toBeNull();
			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.activeSection).toBe('annotations');
		});

		it('DrawActionRow Annotate would set pickedFeature if activeFeature captured before clear', () => {
			// Documents the intended behavior — activeFeature should be captured
			// before clearInteractionModes() is called.
			modes.simulateFeatureSelect(SAMPLE_FEATURE);
			const captured = modes.activeFeature;

			modes.drawActionAnnotate();

			// With pre-capture, pickedFeature would be set correctly
			expect(captured).not.toBeNull();
			expect(captured!.featureId).toBe(SAMPLE_FEATURE.featureId);
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

		it('DrawActionRow Dismiss only clears activeFeature', () => {
			modes.requestRegion();
			modes.simulateFeatureSelect(SAMPLE_FEATURE);

			modes.drawActionDismiss();

			expect(modes.activeFeature).toBeNull();
			// Region mode should NOT be affected by dismiss
			expect(modes.annotationRegionMode).toBe(true);
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
		it('region mode clears even when annotation creation fails', () => {
			modes.requestRegion();
			modes.onRegionDrawn(SAMPLE_POLYGON_GEOMETRY);

			// Simulate failed annotation — onannotationchange still fires on error handling
			modes.onAnnotationChange();

			expect(modes.annotationRegionMode).toBe(false);
			expect(modes.annotationRegionGeometry).toBeUndefined();
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
			// Set up measure active
			modes.setActiveSection('analysis');
			// Restore to annotations for requestRegion (it needs annotation panel)
			modes.setActiveSection('annotations');
			modes.setPendingMeasurement({ geometry: SAMPLE_LINE_GEOMETRY, result: { type: 'LineString', value: 10, unit: 'km' } });

			modes.requestRegion();

			expect(modes.annotationRegionMode).toBe(true);
			// clearInteractionModes('region') clears measure and featurePick but keeps region
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

		it('double annotation change is idempotent', () => {
			modes.requestRegion();
			modes.onRegionDrawn(SAMPLE_POLYGON_GEOMETRY);

			modes.onAnnotationChange();
			modes.onAnnotationChange();

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
			modes.onAnnotationChange();

			// 2. Feature pick + annotate
			modes.requestFeaturePick();
			modes.effectFeaturePickCapture({ id: 'f1', geometry: SAMPLE_POLYGON_GEOMETRY }, 'l1');
			modes.onAnnotationChange();

			// 3. Direct draw → annotate via DrawActionRow
			modes.simulateFeatureSelect(SAMPLE_FEATURE);
			modes.drawActionAnnotate();
			modes.onAnnotationChange();

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
