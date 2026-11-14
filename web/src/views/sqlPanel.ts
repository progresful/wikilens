// The query behind what is on screen, with the time the database took. It only ever shows a
// statement the server reported running.
export interface SqlModel {
  sql: string | null;
  dbMs: number | null;
  count: number;
  note: string | null;
}

export interface SqlView {
  update(model: SqlModel): void;
}

const HIDE = 'hide';
const SHOW = 'show';

export function mountSqlPanel(root: HTMLElement): SqlView {
  root.className = 'sql';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sql-toggle';
  toggle.textContent = HIDE;
  toggle.setAttribute('aria-expanded', 'true');
  const text = document.createElement('pre');
  text.className = 'sql-text';
  const stats = document.createElement('div');
  stats.className = 'sql-stats';
  const note = document.createElement('span');
  note.className = 'sql-note';
  const ms = document.createElement('span');
  ms.className = 'sql-ms';
  const count = document.createElement('span');
  count.className = 'sql-count';
  stats.append(note, ms, count);
  root.replaceChildren(toggle, text, stats);

  toggle.addEventListener('click', () => {
    const collapsed = !text.hidden;
    text.hidden = collapsed;
    stats.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? SHOW : HIDE;
  });

  return {
    update(model) {
      text.textContent = model.sql ?? '';
      note.textContent = model.note ?? '';
      ms.textContent = model.dbMs === null ? '' : `${model.dbMs.toFixed(2)} ms`;
      count.textContent = model.count === 0 ? '' : `${model.count} live ${model.count === 1 ? 'query' : 'queries'}`;
    },
  };
}
