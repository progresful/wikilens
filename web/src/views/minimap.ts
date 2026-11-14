// A small map of the page: one bar per block, tinted like the page, the answer marked.
import { churnLevel } from '../time';
import type { Frame } from '../types';
import type { WordingCache } from '../wordingCache';

export interface MinimapModel {
  frame: Frame | null;
  cache: WordingCache;
  wordingsVersion: number;
  churn: Readonly<Record<string, number>> | null;
  answerParaId: number | null;
}

export interface MinimapView {
  update(model: MinimapModel): void;
}

const LONGEST_CHARS = 600;

export function mountMinimap(root: HTMLElement): MinimapView {
  const count = document.createElement('span');
  count.className = 'mm-count';
  const blocks = document.createElement('div');
  blocks.className = 'mm-blocks';
  root.replaceChildren(count, blocks);
  let last: MinimapModel | null = null;

  function update(model: MinimapModel): void {
    if (
      last !== null && last.frame === model.frame && last.wordingsVersion === model.wordingsVersion
      && last.churn === model.churn && last.answerParaId === model.answerParaId
    ) return;
    last = model;
    const frame = model.frame;
    if (frame === null) return;
    count.textContent = `${frame.blocks.length} ¶`;
    blocks.replaceChildren(...frame.blocks.map((block) => {
      const bar = document.createElement('i');
      const wording = model.cache.get(block.hash);
      bar.className = 'mm-block';
      if (wording?.kind === 'h') bar.classList.add('mm-heading');
      const length = wording?.text.length ?? LONGEST_CHARS / 2;
      bar.style.width = `${Math.min(100, 25 + (length / LONGEST_CHARS) * 75)}%`;
      const wordings = model.churn?.[String(block.paraId)];
      if (wordings !== undefined && wording?.kind !== 'h') bar.classList.add(`churn-${churnLevel(wordings)}`);
      if (block.paraId === model.answerParaId) bar.classList.add('mm-answer');
      return bar;
    }));
  }

  return { update };
}
