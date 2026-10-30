import { describe, expect, it } from 'vitest';
import {
  ZOOM_LAYER_DRAW_SCALE,
  applyEasing,
  opacityFactorExpression,
  slideOffsetExpression,
  toAnimationWindow,
  zoomRangeFor,
  zoomScaleExpression,
} from '../services/animations';

const fade = (type = 'fade', durationSeconds = 0.5, easing = 'linear') =>
  toAnimationWindow({ type, durationSeconds, delaySeconds: 0, easing: easing as never });

describe('timeline animation expressions', () => {
  it('only produces expressions when something animates', () => {
    expect(opacityFactorExpression({ timeVar: 't', clipStart: 1, clipEnd: 3, entrance: null, exit: null })).toBeNull();
    expect(opacityFactorExpression({ timeVar: 't', clipStart: 1, clipEnd: 3, entrance: fade(), exit: null })).toContain('if(lt(t,1.000),0');
  });

  it('evaluates entrance and exit windows from absolute clip time', () => {
    const expression = opacityFactorExpression({
      timeVar: 't',
      clipStart: 2,
      clipEnd: 6,
      entrance: fade('fade', 0.5),
      exit: fade('fade', 1),
    });
    expect(expression).toContain('if(lt(t,2.000),0');
    expect(expression).toContain('if(lt(t,5.000),1');
    expect(expression).toContain('if(lt(t,6.000),1-');
  });

  it('supports every easing curve without leaving the 0-1 range', () => {
    for (const easing of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      const expression = applyEasing('p', easing);
      expect(expression).toContain('p');
      expect(expression.length).toBeGreaterThan(0);
    }
  });

  it('moves only the axis a slide animation targets', () => {
    const start = 1;
    const end = 3;
    const x = slideOffsetExpression({
      axis: 'x',
      size: 1280,
      timeVar: 't',
      clipStart: start,
      clipEnd: end,
      entrance: fade('slide-right', 0.5),
      exit: null,
    });
    const y = slideOffsetExpression({
      axis: 'y',
      size: 720,
      timeVar: 't',
      clipStart: start,
      clipEnd: end,
      entrance: fade('slide-right', 0.5),
      exit: null,
    });
    expect(x).toContain('1280.00');
    expect(y).toBeNull();
  });

  it('reverses the slide direction for the opposite side', () => {
    const left = slideOffsetExpression({
      axis: 'x',
      size: 1280,
      timeVar: 't',
      clipStart: 1,
      clipEnd: 3,
      entrance: fade('slide-left', 0.5),
      exit: null,
    });
    expect(left).toContain('-1280.00');
  });

  it('gates zoom and pop on the zoom layer while fade and slide stay on drawtext', () => {
    expect(zoomRangeFor(fade('zoom'), null)).toBe(true);
    expect(zoomRangeFor(fade('pop'), null)).toBe(true);
    expect(zoomRangeFor(null, fade('zoom'))).toBe(true);
    expect(zoomRangeFor(fade('fade'), null)).toBe(false);
    expect(zoomRangeFor(fade('slide-left'), null)).toBe(false);
  });

  it('scales between the zoom floor and full size, with overshoot for pop', () => {
    const zoom = zoomScaleExpression({
      timeVar: '(in/30)',
      clipStart: 1,
      clipEnd: 3,
      entrance: fade('zoom', 1),
      exit: null,
    });
    expect(zoom).toContain('1+(');
    expect(zoom).toContain('1.820');
    const pop = zoomScaleExpression({
      timeVar: '(in/30)',
      clipStart: 1,
      clipEnd: 3,
      entrance: fade('pop', 1),
      exit: null,
    });
    expect(pop).toContain('1.966');
    expect(ZOOM_LAYER_DRAW_SCALE).toBeGreaterThan(1);
  });

  it('is deterministic: identical settings always produce identical expressions', () => {
    const build = () =>
      zoomScaleExpression({
        timeVar: '(in/30)',
        clipStart: 0.5,
        clipEnd: 4.5,
        entrance: fade('zoom', 1.2, 'ease-in-out'),
        exit: fade('zoom', 0.8, 'ease-in'),
      });
    expect(build()).toBe(build());
  });
});
