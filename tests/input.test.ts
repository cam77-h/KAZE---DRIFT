import { describe, expect, it } from 'vitest';
import { shapeAxis } from '../src/input/input';
import { defaultSettings, normalizeSettings, applyPreset, GRAPHICS_PRESETS } from '../src/core/settings';

describe('input shaping', () => {
  it('applies deadzone, linearity and sensitivity', () => {
    expect(shapeAxis(0.05, 0.08, 1, 1)).toBe(0);
    expect(shapeAxis(1, 0.08, 1, 1)).toBeCloseTo(1);
    expect(shapeAxis(-1, 0.08, 1.5, 1)).toBeCloseTo(-1);
    // more linearity = finer control near centre
    expect(Math.abs(shapeAxis(0.5, 0, 2, 1))).toBeLessThan(Math.abs(shapeAxis(0.5, 0, 1, 1)));
    // sensitivity reaches full lock sooner, never beyond 1
    expect(shapeAxis(0.8, 0, 1, 2)).toBe(1);
  });
});

describe('settings', () => {
  it('fills missing fields from defaults', () => {
    const s = normalizeSettings({ audio: { master: 0.3 }, controls: { keys: { throttle: ['KeyI'] } } });
    expect(s.audio.master).toBe(0.3);
    expect(s.audio.engine).toBe(defaultSettings().audio.engine);
    expect(s.controls.keys.throttle).toEqual(['KeyI']);
    expect(s.controls.keys.brake.length).toBeGreaterThan(0);
  });
  it('applies graphics presets', () => {
    const s = defaultSettings();
    applyPreset(s.graphics, 'low');
    expect(s.graphics.shadows).toBe(GRAPHICS_PRESETS.low.shadows);
    expect(s.graphics.preset).toBe('low');
  });
});
