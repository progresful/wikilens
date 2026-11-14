// The question line and what goes with it: example questions, the other matching
// paragraphs, the message when a question cannot be asked, and how long the ranking took.
import type { AskResult } from '../types';

export interface AskModel {
  question: string;
  asking: boolean;
  message: string | null;
  ask: AskResult | null;
  trackedParaId: number | null;
  examples: readonly { fi: string; en: string }[];
}

export interface AskHandlers {
  onAsk: (question: string) => void;
  onChip: (paraId: number) => void;
  onClear: () => void;
}

export interface AskView {
  update(model: AskModel): void;
  readonly input: HTMLInputElement;
}

const CHIP_CHARS = 44;

function button(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  element.title = title;
  element.addEventListener('click', onClick);
  return element;
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

export function mountAsk(root: HTMLElement, handlers: AskHandlers): AskView {
  const input = document.createElement('input');
  input.className = 'question';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 400;
  input.placeholder = 'Ask this article a question…';
  input.setAttribute('aria-label', 'question about this article');
  const row = document.createElement('div');
  row.className = 'ask-row';
  root.replaceChildren(input, row);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handlers.onAsk(input.value);
    }
  });

  let last: AskModel | null = null;

  function rowContent(model: AskModel): Node[] {
    const nodes: Node[] = [];
    if (model.message !== null) nodes.push(span('ask-message', model.message));
    if (model.asking) nodes.push(span('ask-wait', 'asking…'));
    const ask = model.ask;
    if (ask === null) {
      if (model.examples.length > 0) nodes.push(span('ask-hint', 'try:'));
      for (const example of model.examples) {
        // The same question in Finnish and in English: the model reads both, the article is Finnish.
        nodes.push(button('example-question', example.fi, example.en, () => handlers.onAsk(example.fi)));
        nodes.push(button('example-question', example.en, example.fi, () => handlers.onAsk(example.en)));
      }
      return nodes;
    }
    if (ask.mode === 'keyword') nodes.push(span('mode-keyword', 'keyword match'));
    const others = ask.matches.filter((match) => match.paraId !== model.trackedParaId);
    if (others.length > 0) nodes.push(span('ask-hint', 'also matches:'));
    for (const match of others) {
      const short = match.preview.length > CHIP_CHARS ? `${match.preview.slice(0, CHIP_CHARS)}…` : match.preview;
      nodes.push(button('chip', short, match.preview, () => handlers.onChip(match.paraId)));
    }
    if (ask.mode === 'vector') {
      nodes.push(span('ask-timing', `every wording this article ever had, ranked: embedding ${ask.embedMs.toFixed(0)} ms · MariaDB ${ask.rankMs.toFixed(1)} ms`));
    }
    nodes.push(button('clear-question', '× clear', 'clear the question', handlers.onClear));
    return nodes;
  }

  return {
    input,
    update(model) {
      if (
        last !== null && last.question === model.question && last.asking === model.asking && last.message === model.message
        && last.ask === model.ask && last.trackedParaId === model.trackedParaId && last.examples === model.examples
      ) return;
      if (last === null || last.question !== model.question) input.value = model.question;
      last = model;
      row.replaceChildren(...rowContent(model));
    },
  };
}
