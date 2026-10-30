import {
  AnimationEasing,
  ITextAnimationSettings,
  TextEntranceAnimation,
  TextExitAnimation,
} from '../models/EditComposition';

/**
 * Deterministic, timeline-based animation expressions.
 *
 * Every value is a pure function of absolute timeline time, so seeking,
 * re-rendering and re-encoding always produce the same frame. Nothing here
 * depends on previously rendered frames.
 */

export interface AnimationWindow {
  type: string;
  durationSeconds: number;
  delaySeconds: number;
  easing: AnimationEasing;
}

export function toAnimationWindow(
  settings: ITextAnimationSettings | undefined
): AnimationWindow | null {
  if (!settings) return null;
  return {
    type: settings.type,
    durationSeconds: settings.durationSeconds,
    delaySeconds: settings.delaySeconds ?? 0,
    easing: settings.easing ?? 'ease-out',
  };
}

/** `p` is a progress expression in 0–1; result is eased into 0–1. */
export function applyEasing(progress: string, easing: AnimationEasing): string {
  const p = `(${progress})`;
  switch (easing) {
    case 'linear':
      return p;
    case 'ease-in':
      return `${p}*${p}`;
    case 'ease-out':
      return `1-(1-${p})*(1-${p})`;
    case 'ease-in-out':
      return `if(lt(${p},0.5),2*${p}*${p},1-2*(1-${p})*(1-${p}))`;
    default:
      return p;
  }
}

function windowSpan(window: AnimationWindow, anchor: number, direction: 1 | -1): {
  start: number;
  end: number;
} {
  const start = direction === 1 ? anchor + window.delaySeconds : anchor - window.delaySeconds - window.durationSeconds;
  return { start, end: start + window.durationSeconds };
}

function progress(timeVar: string, start: number, duration: number): string {
  return `(${timeVar}-${start.toFixed(3)})/${duration.toFixed(3)}`;
}

/**
 * Multiplier applied to a clip's opacity. Returns `null` when nothing animates,
 * so callers keep their existing (untouched) rendering path.
 */
export function opacityFactorExpression(params: {
  timeVar: string;
  clipStart: number;
  clipEnd: number;
  entrance: AnimationWindow | null;
  exit: AnimationWindow | null;
}): string | null {
  const { timeVar, clipStart, clipEnd, entrance, exit } = params;
  if (!entrance && !exit) return null;
  const parts: string[] = [];
  if (entrance) {
    const { start, end } = windowSpan(entrance, clipStart, 1);
    const eased = applyEasing(progress(timeVar, start, entrance.durationSeconds), entrance.easing);
    parts.push(`if(lt(${timeVar},${start.toFixed(3)}),0,if(lt(${timeVar},${end.toFixed(3)}),${eased},1))`);
  }
  if (exit) {
    const { start, end } = windowSpan(exit, clipEnd, -1);
    const eased = applyEasing(progress(timeVar, start, exit.durationSeconds), exit.easing);
    parts.push(`if(lt(${timeVar},${start.toFixed(3)}),1,if(lt(${timeVar},${end.toFixed(3)}),1-${eased},0))`);
  }
  return parts.reduce((combined, part) => (combined ? `(${combined})*(${part})` : part), '');
}

function slideVector(type: string): { axis: 'x' | 'y'; sign: 1 | -1 } | null {
  switch (type) {
    case 'slide-left':
      return { axis: 'x', sign: -1 };
    case 'slide-right':
      return { axis: 'x', sign: 1 };
    case 'slide-top':
      return { axis: 'y', sign: -1 };
    case 'slide-bottom':
      return { axis: 'y', sign: 1 };
    default:
      return null;
  }
}

/**
 * Pixel offset applied to a text overlay while it slides. Returns the offset
 * expression for one axis, or null when this axis does not move.
 */
export function slideOffsetExpression(params: {
  axis: 'x' | 'y';
  size: number;
  timeVar: string;
  clipStart: number;
  clipEnd: number;
  entrance: AnimationWindow | null;
  exit: AnimationWindow | null;
}): string | null {
  const { axis, size, timeVar, clipStart, clipEnd, entrance, exit } = params;
  const entranceVector = entrance ? slideVector(entrance.type) : null;
  const exitVector = exit ? slideVector(exit.type) : null;
  if (entranceVector?.axis !== axis && exitVector?.axis !== axis) return null;
  const parts: string[] = [];
  if (entranceVector?.axis === axis) {
    const { start, end } = windowSpan(entrance!, clipStart, 1);
    const eased = applyEasing(progress(timeVar, start, entrance!.durationSeconds), entrance!.easing);
    const from = entranceVector.sign * size;
    // Before the window the text sits fully off-screen, then it travels to 0.
    parts.push(
      `if(lt(${timeVar},${start.toFixed(3)}),${from.toFixed(2)},if(lt(${timeVar},${end.toFixed(3)}),${from.toFixed(2)}*(1-${eased}),0))`
    );
  }
  if (exitVector?.axis === axis) {
    const { start, end } = windowSpan(exit!, clipEnd, -1);
    const eased = applyEasing(progress(timeVar, start, exit!.durationSeconds), exit!.easing);
    const to = exitVector.sign * size;
    parts.push(
      `if(lt(${timeVar},${start.toFixed(3)}),0,if(lt(${timeVar},${end.toFixed(3)}),${to.toFixed(2)}*${eased},${to.toFixed(2)}))`
    );
  }
  return parts.length > 1 ? `(${parts.join('+')})` : parts[0];
}

/** Scale multipliers for the zoom/pop layer path. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 1.82;
const POP_OVERSHOOT = 1.08;

export function zoomRangeFor(entrance: AnimationWindow | null, exit: AnimationWindow | null): boolean {
  return Boolean(
    (entrance && (entrance.type === 'zoom' || entrance.type === 'pop')) ||
      (exit && exit.type === 'zoom')
  );
}

/**
 * Zoom factor expression for `zoompan`. `timeVar` must resolve to absolute
 * timeline seconds for the layer (for a 30 fps layer that is `in/30`).
 */
export function zoomScaleExpression(params: {
  timeVar: string;
  clipStart: number;
  clipEnd: number;
  entrance: AnimationWindow | null;
  exit: AnimationWindow | null;
}): string {
  const { timeVar, clipStart, clipEnd, entrance, exit } = params;
  const parts: string[] = [];
  if (entrance && (entrance.type === 'zoom' || entrance.type === 'pop')) {
    const { start, end } = windowSpan(entrance, clipStart, 1);
    const eased = applyEasing(progress(timeVar, start, entrance.durationSeconds), entrance.easing);
    const peak = entrance.type === 'pop' ? ZOOM_MAX * POP_OVERSHOOT : ZOOM_MAX;
    parts.push(
      `if(lt(${timeVar},${start.toFixed(3)}),${ZOOM_MIN},if(lt(${timeVar},${end.toFixed(3)}),${ZOOM_MIN}+(${peak.toFixed(3)}-${ZOOM_MIN})*(${eased}),${ZOOM_MAX}))`
    );
  }
  if (exit && exit.type === 'zoom') {
    const { start, end } = windowSpan(exit, clipEnd, -1);
    const eased = applyEasing(progress(timeVar, start, exit.durationSeconds), exit.easing);
    parts.push(
      `if(lt(${timeVar},${start.toFixed(3)}),${ZOOM_MAX},if(lt(${timeVar},${end.toFixed(3)}),${ZOOM_MAX}-(${ZOOM_MAX.toFixed(3)}-${ZOOM_MIN})*(${eased}),${ZOOM_MIN}))`
    );
  }
  if (parts.length === 0) return `${ZOOM_MAX}`;
  return parts.length === 1 ? parts[0] : `(${parts.join('*')})`;
}

/**
 * The zoom layer is rendered at 2x the output size and glyphs are drawn at
 * `2 / ZOOM_MAX` of the requested size, so `zoompan` at ZOOM_MAX reproduces the
 * configured size exactly and never upsamples the rasterised text.
 */
export const ZOOM_LAYER_WIDTH = 2560;
export const ZOOM_LAYER_HEIGHT = 1440;
export const ZOOM_LAYER_DRAW_SCALE = 2 / ZOOM_MAX;

export function isSlideType(type: string): boolean {
  return slideVector(type) !== null;
}

export const ENTRANCE_TYPES: readonly TextEntranceAnimation[] = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-top',
  'slide-bottom',
  'zoom',
  'pop',
];

export const EXIT_TYPES: readonly TextExitAnimation[] = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-top',
  'slide-bottom',
  'zoom',
];
