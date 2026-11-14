// A check on the narration's timing: no two lines at once, none past the end. Pure function.

/** A line of narration and the seconds of the film between which it is spoken. */
export interface SpokenSpan {
  id: string;
  from: number;
  to: number;
}

/** What is wrong with the timing, one sentence per fault; empty when nothing is. */
export function narrationFaults(spans: readonly SpokenSpan[], filmSeconds: number): string[] {
  const ordered = [...spans].sort((a, b) => a.from - b.from);
  return ordered.flatMap((span, index) => {
    const before = ordered[index - 1];
    const faults: string[] = [];
    if (before !== undefined && span.from < before.to) {
      faults.push(`"${span.id}" starts at ${span.from.toFixed(2)} s, before "${before.id}" has ended at ${before.to.toFixed(2)} s`);
    }
    if (span.to > filmSeconds) {
      faults.push(`"${span.id}" ends at ${span.to.toFixed(2)} s, after the film has ended at ${filmSeconds.toFixed(2)} s`);
    }
    return faults;
  });
}
