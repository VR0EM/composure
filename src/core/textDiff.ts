export interface DiffLine {
  type: 'context' | 'added' | 'removed' | 'gap';
  text: string;
  /** 1-based line number in the old text (context/removed) */
  oldLine?: number;
  /** 1-based line number in the new text (context/added) */
  newLine?: number;
}

/**
 * Line-based diff for previewing a fix: trims the common prefix/suffix, runs
 * an LCS on the changed middle, and keeps `context` unchanged lines around
 * each change. Compose files are small, so the quadratic LCS is fine.
 */
export function diffLines(oldText: string, newText: string, context = 2): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  // LCS table on the middle section
  const lcs: number[][] = Array.from({ length: midA.length + 1 }, () =>
    new Array<number>(midB.length + 1).fill(0),
  );
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const all: DiffLine[] = [];
  for (let k = 0; k < prefix; k++) {
    all.push({ type: 'context', text: a[k]!, oldLine: k + 1, newLine: k + 1 });
  }
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      all.push({ type: 'context', text: midA[i]!, oldLine: prefix + i + 1, newLine: prefix + j + 1 });
      i++;
      j++;
    } else if (i < midA.length && (j >= midB.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      all.push({ type: 'removed', text: midA[i]!, oldLine: prefix + i + 1 });
      i++;
    } else {
      all.push({ type: 'added', text: midB[j]!, newLine: prefix + j + 1 });
      j++;
    }
  }
  for (let k = 0; k < suffix; k++) {
    const oldIdx = a.length - suffix + k;
    const newIdx = b.length - suffix + k;
    all.push({ type: 'context', text: a[oldIdx]!, oldLine: oldIdx + 1, newLine: newIdx + 1 });
  }

  // Keep only context lines near a change
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((line, idx) => {
    if (line.type === 'context') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(all.length - 1, idx + context); k++) {
      keep[k] = true;
    }
  });

  const result: DiffLine[] = [];
  let skipped = false;
  all.forEach((line, idx) => {
    if (keep[idx]) {
      if (skipped && result.length > 0) result.push({ type: 'gap', text: '…' });
      result.push(line);
      skipped = false;
    } else {
      skipped = true;
    }
  });
  return result;
}
