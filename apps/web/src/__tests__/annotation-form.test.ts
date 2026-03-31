import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AnnotationForm from '$lib/components/annotations/AnnotationForm.svelte';

vi.mock('exifr', () => ({ default: { gps: vi.fn().mockResolvedValue(null) } }));

describe('AnnotationForm', () => {
  const defaultProps = {
    mapId: 'map-1',
    oncreate: vi.fn(),
    pendingMeasurementData: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form with text field', () => {
    render(AnnotationForm, { props: defaultProps });
    // Text textarea is visible by default
    expect(screen.getByLabelText(/note/i)).toBeTruthy();
  });

  it('pre-fills form when pendingMeasurementData is provided', () => {
    const measurementData = {
      title: 'Distance: 1.50 km',
      content: 'Measurement: distance — 3 vertices',
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [1, 1],
          [2, 0],
        ],
      },
    };
    render(AnnotationForm, {
      props: {
        ...defaultProps,
        pendingMeasurementData: measurementData,
      },
    });
    // Form should show measurement data
    expect(screen.getByText(/1\.50 km/)).toBeTruthy();
  });

  it('calls oncreate with form data on submit', async () => {
    const oncreate = vi.fn();
    render(AnnotationForm, {
      props: { ...defaultProps, oncreate },
    });
    const textarea = screen.getByLabelText(/note/i);
    await fireEvent.input(textarea, { target: { value: 'Test annotation' } });
    const submitBtn = screen.getByRole('button', { name: /save/i });
    await submitBtn.click();
    expect(oncreate).toHaveBeenCalledTimes(1);
    const call = oncreate.mock.calls[0][0];
    expect(call.mapId).toBe('map-1');
    expect(call.content.kind).toBe('single');
    expect(call.content.body.type).toBe('text');
    expect(call.content.body.text).toBe('Test annotation');
  });

  it('switches content type when type button clicked', async () => {
    render(AnnotationForm, { props: defaultProps });
    const emojiBtn = screen.getByTestId('content-type-emoji');
    await emojiBtn.click();
    expect(screen.getByLabelText(/emoji/i)).toBeTruthy();
  });

  it('disables submit when required field is empty', () => {
    render(AnnotationForm, { props: defaultProps });
    const submitBtn = screen.getByRole('button', { name: /save/i });
    // Text type with empty text should disable submit
    expect(submitBtn.disabled).toBe(true);
  });
});
