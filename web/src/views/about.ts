// "About the data": how much is loaded, read from the database when the panel opens, and
// what the screen does not show. Nothing here is a fixed number.
import { formatDate } from '../time';
import type { Coverage } from '../types';

export interface AboutHandlers {
  loadCoverage: () => Promise<Coverage>;
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString('en-GB')} ${word}${count === 1 ? '' : 's'}`;
}

function facts(coverage: Coverage): string[] {
  return [
    plural(coverage.articles, 'article'),
    plural(coverage.revisions, 'revision'),
    plural(coverage.paragraphVersions, 'paragraph version'),
    plural(coverage.wordings, 'distinct wording'),
    plural(coverage.vectors, 'vector'),
    `${Math.round(coverage.databaseBytes / 1_048_576).toLocaleString('en-GB')} MB in MariaDB ${coverage.mariadbVersion.split('-')[0]}`,
  ];
}

export function mountAbout(panel: HTMLElement, toggle: HTMLButtonElement, handlers: AboutHandlers): void {
  const heading = document.createElement('h2');
  heading.textContent = 'About the data';
  const list = document.createElement('ul');
  const notes = document.createElement('div');
  panel.replaceChildren(heading, list, notes);

  function note(text: string): HTMLParagraphElement {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    return paragraph;
  }

  async function open(): Promise<void> {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    list.replaceChildren();
    notes.replaceChildren(note('reading the database…'));
    try {
      const coverage = await handlers.loadCoverage();
      list.replaceChildren(...facts(coverage).map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
      }));
      notes.replaceChildren(
        note(`Every saved version of these Finnish Wikipedia articles up to ${formatDate(coverage.corpusEnd)}. Nothing after that date is known here.`),
        note('Each paragraph is a row in a system-versioned MariaDB table; each edit is a history row with the time it was saved on Wikipedia. Every frame you scrub is a FOR SYSTEM_TIME AS OF query.'),
        note('Text is simplified: templates, tables and references are not shown. Which blocks of two versions count as the same paragraph is decided automatically and can be wrong; a loose link is drawn dashed.'),
      );
    } catch {
      notes.replaceChildren(note('the database cannot be read right now'));
    }
  }

  toggle.addEventListener('click', () => {
    if (panel.hidden) {
      void open();
    } else {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}
