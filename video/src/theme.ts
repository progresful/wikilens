// The film's look: the site's own palette and type (Wikipedia's Vector 2022 look, as the site
// rebuilt it), so the typographic scenes and the recorded page read as one thing.
import { Easing } from 'remotion';

export const FPS = 30;
export const CANVAS = { w: 1920, h: 1080 } as const;
/** The recorded page, in page pixels. The footage holds it at twice this, for sharp close-ups. */
export const PAGE = { w: 1600, h: 900 } as const;

export const COLOR = {
  white: '#ffffff',
  backdrop: '#f1f3f5',
  ink: '#202122',
  subtle: '#54595d',
  faint: '#72777d',
  rule: '#a2a9b1',
  hairline: '#c8ccd1',
  link: '#3366cc',
  then: '#6a60b0',
  added: '#a3d3ff',
  removed: '#ffe49c',
  red: '#bf3c2c',
  green: '#177860',
  heat: '#ffcc33',
} as const;

export const FONT = {
  serif: "'Linux Libertine', Georgia, Times, serif",
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

/** One easing for every camera move and every entrance: slow out of rest, slow into rest. */
export const EASE = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
