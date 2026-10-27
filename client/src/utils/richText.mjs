export function shiftMarks(marks = [], before, after) {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const end = before.length - tail,
    delta = after.length - before.length;
  return marks
    .map((m) => ({
      ...m,
      start:
        m.start <= start ? m.start : m.start >= end ? m.start + delta : start,
      end:
        m.end <= start
          ? m.end
          : m.end >= end
            ? m.end + delta
            : after.length - tail,
    }))
    .filter((m) => m.start >= 0 && m.end > m.start && m.end <= after.length);
}
export function richSegments(text, marks = []) {
  const points = [
    ...new Set([
      0,
      text.length,
      ...marks.flatMap((m) => [
        Math.max(0, m.start),
        Math.min(text.length, m.end),
      ]),
    ]),
  ].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, i) => ({
    text: text.slice(start, points[i + 1]),
    types: marks
      .filter((m) => m.start <= start && m.end >= points[i + 1])
      .map((m) => m.type),
  }));
}
export function readRichDom(root) {
  let text = '';
  const marks = [];
  const walk = (node, types = []) => {
    if (node.nodeType === 3) {
      const start = text.length;
      text += node.textContent;
      for (const type of types)
        if (text.length > start) marks.push({ type, start, end: text.length });
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }
    const block = /^(DIV|P|H1|H2)$/.test(node.tagName);
    if (block && text && !text.endsWith('\n')) text += '\n';
    const kind =
      {
        B: 'bold',
        STRONG: 'bold',
        I: 'italic',
        EM: 'italic',
        U: 'underline',
        H1: 'h1',
        H2: 'h2',
      }[node.tagName] || node.dataset?.mark;
    const next = kind ? [...new Set([...types, kind])] : types;
    for (const child of node.childNodes) walk(child, next);
    if (block && node.nextSibling && !text.endsWith('\n')) text += '\n';
  };
  for (const child of root.childNodes) walk(child);
  const merged = [];
  for (const type of ['bold', 'italic', 'underline', 'h1', 'h2']) {
    for (const mark of marks
      .filter((m) => m.type === type)
      .sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last?.type === type && last.end >= mark.start)
        last.end = Math.max(last.end, mark.end);
      else merged.push({ ...mark });
    }
  }
  return { text, marks: merged };
}
export function writeRichDom(root, text, marks = []) {
  const doc = root.ownerDocument,
    fragment = doc.createDocumentFragment();
  for (const segment of richSegments(text, marks)) {
    let node = doc.createTextNode(segment.text);
    for (const type of segment.types) {
      const wrap = doc.createElement(
        { bold: 'strong', italic: 'em', underline: 'u' }[type] || 'span',
      );
      if (type === 'h1' || type === 'h2' || type === 'plain') {
        wrap.dataset.mark = type;
        wrap.style.fontSize = type === 'h1' ? '1.5em' : '1.25em';
        wrap.style.fontWeight = '600';
      }
      wrap.append(node);
      node = wrap;
    }
    fragment.append(node);
  }
  root.replaceChildren(fragment);
}
export function formatMarks(marks, text, start, end, type) {
  if (type === 'h1' || type === 'h2' || type === 'plain') {
    start = text.lastIndexOf('\n', Math.max(-1, start - 1)) + 1;
    const next = text.indexOf('\n', end);
    end = next < 0 ? text.length : next;
  }
  if (end <= start) return marks;
  const same = (m) =>
    type === 'clear' ||
    (type === 'plain'
      ? ['h1', 'h2'].includes(m.type)
      : m.type === type ||
        (['h1', 'h2'].includes(type) && ['h1', 'h2'].includes(m.type)));
  const remove =
    ['clear', 'plain'].includes(type) ||
    marks.some((m) => m.type === type && m.start <= start && m.end >= end);
  const next = marks.flatMap((m) =>
    same(m) && m.start < end && m.end > start
      ? [
          m.start < start ? { ...m, end: start } : null,
          m.end > end ? { ...m, start: end } : null,
        ].filter(Boolean)
      : [m],
  );
  if (!remove) next.push({ type, start, end });
  return next;
}
export function richSelection(root) {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const position = (node, offset) => {
    const prefix = range.cloneRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(node, offset);
    const box = root.ownerDocument.createElement('div');
    box.append(prefix.cloneContents());
    return readRichDom(box).text.length;
  };
  return {
    start: position(range.startContainer, range.startOffset),
    end: position(range.endContainer, range.endOffset),
  };
}
export function selectRichRange(root, start, end) {
  const doc = root.ownerDocument,
    walker = doc.createTreeWalker(root, 4);
  let offset = 0,
    node,
    first,
    last;
  while ((node = walker.nextNode())) {
    if (!first && offset + node.length >= start)
      first = [node, Math.max(0, start - offset)];
    if (offset + node.length >= end) {
      last = [node, Math.max(0, end - offset)];
      break;
    }
    offset += node.length;
  }
  if (first && last) {
    const range = doc.createRange();
    range.setStart(...first);
    range.setEnd(...last);
    const selection = doc.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
