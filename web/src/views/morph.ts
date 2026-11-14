// One paragraph's words as elements, so a change of wording can be shown word by word:
// inserted words arrive highlighted and stay marked, removed words strike out and collapse.
// Text is written with textContent only.
import { diffWords, needsSpaceBefore } from '../diff';
import type { Op } from '../diff';

export interface MorphView {
  /** Show these words plainly, with no change marked. */
  set(tokens: readonly string[]): void;
  /** Change from one wording to another, marking what arrived and what left. */
  update(from: readonly string[], to: readonly string[]): void;
}

const REMOVE_AFTER_MS = 1000;   // a little longer than the exit animation

function word(token: string, isFirst: boolean, type: Op['type']): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = type === 'eq' ? 'w' : `w ${type}`;
  span.textContent = (needsSpaceBefore(token, isFirst) ? ' ' : '') + token;
  return span;
}

export function mountMorph(root: HTMLElement): MorphView {
  return {
    set(tokens) {
      root.replaceChildren(...tokens.map((token, index) => word(token, index === 0, 'eq')));
    },
    update(from, to) {
      const spans = diffWords(from, to).map((op, index) => word(op.token, index === 0, op.type));
      root.replaceChildren(...spans);
      for (const span of spans) {
        if (!span.classList.contains('del')) continue;
        const remove = (): void => span.remove();
        span.addEventListener('animationend', remove, { once: true });
        window.setTimeout(remove, REMOVE_AFTER_MS);
      }
    },
  };
}
