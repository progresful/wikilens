// Word-level difference between two wordings of a paragraph. Pure functions.

export interface Op {
  type: 'eq' | 'ins' | 'del';
  token: string;
}

// A word (letters, digits, and the apostrophes, hyphens and dashes inside compounds), or one
// other visible character.
const TOKEN = /[\p{L}\p{N}’'–-]+|[^\s\p{L}\p{N}]/gu;
const NO_SPACE_BEFORE = /^[,.;:!?)\]”»%]$/u;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Whether a token is written with a space in front of it. */
export function needsSpaceBefore(token: string, isFirst: boolean): boolean {
  return !isFirst && !NO_SPACE_BEFORE.test(token);
}

/** Longest-common-subsequence diff. Within a change, removals come before insertions. */
export function diffWords(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // lcs[i * width + j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j]
        ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const left = a[i] as string;
    const right = b[j] as string;
    if (left === right) {
      ops.push({ type: 'eq', token: left });
      i++;
      j++;
    } else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      ops.push({ type: 'del', token: left });
      i++;
    } else {
      ops.push({ type: 'ins', token: right });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ type: 'del', token: a[i] as string });
  for (; j < m; j++) ops.push({ type: 'ins', token: b[j] as string });
  return ops;
}
