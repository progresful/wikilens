// The article picker. Articles whose stories were read by hand come first; the rest are
// labelled as matched automatically and not reviewed.
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

  return {
    update(model) {
      if (lastArticles !== model.articles) {
        lastArticles = model.articles;
        const reviewed = model.articles.filter((article) => article.reviewed);
        const others = model.articles.filter((article) => !article.reviewed);
        const groups: HTMLElement[] = [];
        if (reviewed.length > 0) groups.push(group('stories read by hand', reviewed));
        if (others.length > 0) {
          groups.push(reviewed.length > 0 ? group('automatic matching, not reviewed', others) : group('articles', others));
        }
        select.replaceChildren(...groups);
      }
      if (model.pageId !== null) select.value = String(model.pageId);
    },
  };
}
