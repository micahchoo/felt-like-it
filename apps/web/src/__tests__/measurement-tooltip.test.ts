import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import MeasurementTooltip from '$lib/components/measurements/MeasurementTooltip.svelte';

describe('MeasurementTooltip', () => {
  const distanceResult = {
    type: 'distance' as const,
    value: 1500,
    vertexCount: 3,
    distanceKm: 1.5,
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 0],
      ] as [number, number][],
    },
  };

  const areaResult = {
    type: 'area' as const,
    value: 5000000,
    vertexCount: 4,
    areaM2: 5000000,
    areaKm2: 5.0,
    perimeterKm: 4,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0] as [number, number],
          [1, 0] as [number, number],
          [1, 1] as [number, number],
          [0, 1] as [number, number],
          [0, 0] as [number, number],
        ],
      ],
    },
  };

  it('renders distance measurement with value', () => {
    render(MeasurementTooltip, {
      result: distanceResult,
      position: { x: 100, y: 200 },
      onsave: () => {},
      onclear: () => {},
    });
    expect(screen.getByText(/1\.50 km/)).toBeTruthy();
    expect(screen.getByText('Save as annotation')).toBeTruthy();
  });

  it('renders area measurement with value', () => {
    render(MeasurementTooltip, {
      result: areaResult,
      position: { x: 150, y: 250 },
      onsave: () => {},
      onclear: () => {},
    });
    expect(screen.getByText(/5\.00 km/)).toBeTruthy();
  });

  it('calls onsave when save button clicked', async () => {
    let saveCalled = false;
    render(MeasurementTooltip, {
      result: distanceResult,
      position: { x: 100, y: 200 },
      onsave: () => {
        saveCalled = true;
      },
      onclear: () => {},
    });
    const btn = screen.getByText('Save as annotation');
    await btn.click();
    expect(saveCalled).toBe(true);
  });

  it('calls onclear when clear button clicked', async () => {
    let clearCalled = false;
    render(MeasurementTooltip, {
      result: distanceResult,
      position: { x: 100, y: 200 },
      onsave: () => {},
      onclear: () => {
        clearCalled = true;
      },
    });
    const btn = screen.getByText('Clear');
    await btn.click();
    expect(clearCalled).toBe(true);
  });

  it('positions tooltip at given coordinates', () => {
    const { container } = render(MeasurementTooltip, {
      result: distanceResult,
      position: { x: 100, y: 200 },
      onsave: () => {},
      onclear: () => {},
    });
    const tooltip = container.querySelector('.measurement-tooltip') as HTMLElement;
    expect(tooltip).not.toBeNull();
    expect(tooltip.style.left).toBe('100px');
    expect(tooltip.style.top).toBe('200px');
  });
});
