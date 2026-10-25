import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Testing Library's auto-cleanup only registers itself when Vitest globals
 * are enabled. We keep globals off (explicit imports everywhere), so unmount
 * between tests manually — otherwise the DOM leaks across cases and queries
 * match stale markup from the previous test.
 */
afterEach(() => cleanup());

/**
 * jsdom does not implement a few browser APIs the UI relies on.
 * Polyfill them once here so component tests run without touching production code.
 */

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}