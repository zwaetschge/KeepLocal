import { newLocalId } from './localId.mjs';
export function normalizeChecklist(items = []) {
  return items.map((item, index) => ({
    ...item,
    id: item.id || item._id || newLocalId(),
    indent: index && item.indent === 1 ? 1 : 0,
    order: index,
  }));
}
export function moveChecklist(items, from, to) {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  )
    return items;
  const next = [...items];
  let count = 1;
  if (!items[from].indent)
    while (from + count < items.length && items[from + count].indent) count++;
  if (to >= from && to < from + count) return items;
  let target = to;
  if (!items[from].indent) {
    if (to < from) {
      while (target > 0 && items[target].indent) target--;
    } else {
      target++;
      while (target < items.length && items[target].indent) target++;
    }
  } else if (to > from) target++;
  const group = next.splice(from, count);
  next.splice(target > from ? target - count : target, 0, ...group);
  return next.map((item, index) => ({
    ...item,
    order: index,
    indent: index ? item.indent : 0,
  }));
}
export function changeIndent(items, index, indent) {
  if (!index || !items[index]) return items;
  return items.map((item, i) =>
    i === index ? { ...item, indent: indent ? 1 : 0 } : item,
  );
}
export function toggleChecklist(
  items,
  index,
  completed = !items[index]?.completed,
) {
  if (!items[index]) return items;
  let end = index + 1;
  if (!items[index].indent)
    while (end < items.length && items[end].indent) end++;
  return items.map((item, i) =>
    i >= index && i < end ? { ...item, completed } : item,
  );
}
