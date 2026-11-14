// The article picker. The list holds the articles with the full experience: those whose
// stories were read by hand come first, the rest are labelled as matched automatically and not
// reviewed. Articles loaded with history only (thousands of them) are found by typing a title.
import type { Article } from '../types';

export interface PickerModel {
  articles: readonly Article[];
  pageId: number | null;
}

export interface PickerHandlers {
  onArticle: (pageId: number) => void;
}

export interface PickerView {
  update(model: PickerModel): void;
}

const FULL_EXPERIENCE_TIER = 1;
const MORE_LIST_ID = 'more-articles';

function option(article: Article): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = String(article.pageId);
  element.textContent = article.title;
  return element;
}

function group(label: string, articles: readonly Article[]): HTMLOptGroupElement {
  const element = document.createElement('optgroup');
  element.label = label;
  element.append(...articles.map(option));
  return element;
}

export function mountPicker(root: HTMLElement, handlers: PickerHandlers): PickerView {
  const select = document.createElement('select');
  select.className = 'article-select';
  select.setAttribute('aria-label', 'article');
  root.replaceChildren(select);
  select.addEventListener('change', () => {
    const pageId = Number(select.value);
    if (Number.isInteger(pageId) && pageId > 0) handlers.onArticle(pageId);
    select.blur();
  });

  let lastArticles: readonly Article[] | null = null;
  let byTitle = new Map<string, number>();
  let search: HTMLInputElement | null = null;

  function buildSearch(more: readonly Article[]): void {
    search?.remove();
    document.getElementById(MORE_LIST_ID)?.remove();
    search = null;
    byTitle = new Map(more.map((article) => [article.title, article.pageId]));
    if (more.length === 0) return;
    const list = document.createElement('datalist');
    list.id = MORE_LIST_ID;
    list.append(...more.map((article) => {
      const item = document.createElement('option');
      item.value = article.title;
      return item;
    }));
    const input = document.createElement('input');
    input.className = 'article-search';
    input.type = 'search';
    input.setAttribute('list', MORE_LIST_ID);
    input.setAttribute('aria-label', 'find an article loaded with history only');
    input.placeholder = `Search ${more.length.toLocaleString('en-GB')} more article${more.length === 1 ? '' : 's'}, history only…`;
    input.addEventListener('change', () => {
      const pageId = byTitle.get(input.value);
      if (pageId === undefined) return;
      handlers.onArticle(pageId);
      input.value = '';
      input.blur();
    });
    root.append(input, list);
    search = input;
  }

  return {
    update(model) {
      if (lastArticles !== model.articles) {
        lastArticles = model.articles;
        const full = model.articles.filter((article) => article.tier === FULL_EXPERIENCE_TIER || article.reviewed);
        const reviewed = full.filter((article) => article.reviewed);
        const others = full.filter((article) => !article.reviewed);
        const groups: HTMLElement[] = [];
        if (reviewed.length > 0) groups.push(group('stories read by hand', reviewed));
        if (others.length > 0) {
          groups.push(reviewed.length > 0 ? group('automatic matching, not reviewed', others) : group('articles', others));
        }
        select.replaceChildren(...groups);
        buildSearch(model.articles.filter((article) => article.tier !== FULL_EXPERIENCE_TIER && !article.reviewed));
      }
      if (model.pageId !== null) {
        // An article opened through the search box is not in the list: show no selection for it.
        select.value = String(model.pageId);
        if (select.value !== String(model.pageId)) select.selectedIndex = -1;
      }
    },
  };
}
