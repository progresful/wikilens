// Where the secondary parts of the page sit. On a wide window the query, the key and the
// credits stand beside the article. On a narrow one there is no room beside it, so they are
// moved to follow the article's text, inside the part of the page that scrolls: the question
// and the timeline stay put above it and nothing is pinned below.
export const NARROW_QUERY = '(max-width: 900px)';

export interface LayoutParts {
  /** The scrolling article. */
  scroller: HTMLElement;
  /** The row that holds the article and, on a wide window, the right-hand column. */
  stage: HTMLElement;
  /** The right-hand column: year, query, key. */
  rail: HTMLElement;
  /** The left-hand column, which on a wide window ends with the foot. */
  sideColumn: HTMLElement;
  /** Credits, the review note and "About the data". */
  foot: HTMLElement;
}

export function mountLayout(parts: LayoutParts): void {
  const narrow = window.matchMedia(NARROW_QUERY);
  const arrange = (): void => {
    if (narrow.matches) {
      parts.scroller.append(parts.rail, parts.foot);
    } else {
      parts.stage.append(parts.rail);
      parts.sideColumn.append(parts.foot);
    }
  };
  narrow.addEventListener('change', arrange);
  arrange();
}
