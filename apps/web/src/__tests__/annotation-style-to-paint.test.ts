/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  lineStylePaint,
  fillStylePaint,
  pinStylePaint,
  showLabelFor,
} from '$lib/components/map/annotation-style-to-paint.js';

describe('annotation-style-to-paint', () => {
  describe('lineStylePaint', () => {
    it('returns an empty object when style is null or undefined', () => {
      expect(lineStylePaint(null)).toEqual({});
      expect(lineStylePaint(undefined)).toEqual({});
    });

    it('maps strokeColor/Width/Opacity onto their line-* MapLibre keys', () => {
      const paint = lineStylePaint({
        strokeColor: '#abcdef',
        strokeWidth: 4,
        strokeOpacity: 0.5,
      });
      expect(paint).toEqual({
        'line-color': '#abcdef',
        'line-width': 4,
        'line-opacity': 0.5,
      });
    });

    it('translates strokeStyle to dasharray tuples (dashed/dotted/solid)', () => {
      expect(lineStylePaint({ strokeStyle: 'dashed' })).toEqual({ 'line-dasharray': [4, 2] });
      expect(lineStylePaint({ strokeStyle: 'dotted' })).toEqual({ 'line-dasharray': [1, 2] });
      expect(lineStylePaint({ strokeStyle: 'solid' })).toEqual({ 'line-dasharray': [1, 0] });
    });

    it('omits fields the caller did not set (sparse overrides)', () => {
      // Caller spreads into an existing paint constant — setting nothing
      // means "don't override", not "override with undefined".
      expect(lineStylePaint({ strokeWidth: 2 })).toEqual({ 'line-width': 2 });
    });
  });

  describe('fillStylePaint', () => {
    it('maps fillColor/Opacity', () => {
      expect(fillStylePaint({ fillColor: '#ff00ff', fillOpacity: 0.3 })).toEqual({
        'fill-color': '#ff00ff',
        'fill-opacity': 0.3,
      });
    });
  });

  describe('pinStylePaint', () => {
    it('maps fill onto circle center and stroke onto circle outline', () => {
      expect(
        pinStylePaint({
          fillColor: '#111111',
          fillOpacity: 0.9,
          strokeColor: '#222222',
          strokeWidth: 3,
          strokeOpacity: 0.5,
        }),
      ).toEqual({
        'circle-color': '#111111',
        'circle-opacity': 0.9,
        'circle-stroke-color': '#222222',
        'circle-stroke-width': 3,
        'circle-stroke-opacity': 0.5,
      });
    });
  });

  describe('showLabelFor', () => {
    it('defaults to true when no style is set (preserve current behaviour)', () => {
      expect(showLabelFor(null)).toBe(true);
      expect(showLabelFor({})).toBe(true);
    });
    it('honours explicit showLabel=false', () => {
      expect(showLabelFor({ showLabel: false })).toBe(false);
      expect(showLabelFor({ showLabel: true })).toBe(true);
    });
  });
});
