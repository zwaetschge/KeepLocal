import React, { useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { moveChecklist, changeIndent } from '../utils/checklist.mjs';
export default function ChecklistEditor({
  items,
  onChange,
  onText,
  onToggle,
  onDelete,
  onKeyDown,
  onAdd,
  options,
  onOptions,
}) {
  const { t } = useLanguage();
  const dragged = useRef(null);
  const row = (item, index) => (
    <div
      key={item.id || item._id || index}
      className="todo-item"
      style={{ marginInlineStart: item.indent ? 24 : 0 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (dragged.current !== null)
          onChange(moveChecklist(items, dragged.current, index));
        dragged.current = null;
      }}
    >
      <button
        type="button"
        draggable
        aria-label={t('keepMoveItem')}
        title={t('keepMoveItem')}
        onDragStart={(e) => {
          dragged.current = index;
          e.dataTransfer.setData('text/plain', item.id || String(index));
        }}
        onDragEnd={() => {
          dragged.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            let target = index + (e.key === 'ArrowUp' ? -1 : 1);
            if (e.key === 'ArrowDown' && !item.indent)
              while (target < items.length && items[target].indent) target++;
            onChange(moveChecklist(items, index, target));
          }
        }}
      >
        ⠿
      </button>
      <input
        type="checkbox"
        className="todo-item-checkbox"
        checked={item.completed}
        onChange={() => onToggle(index)}
        aria-label={`${t('keepCompleteItem')}: ${item.text}`}
      />
      <input
        className={`todo-item-input ${item.completed ? 'completed' : ''}`}
        value={item.text}
        placeholder={t('todoItem')}
        maxLength={500}
        aria-label={t('todoItem')}
        onChange={(e) => onText(index, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            onChange(changeIndent(items, index, !e.shiftKey));
          } else onKeyDown(e, index);
        }}
      />
      <button
        type="button"
        disabled={!index}
        aria-label={item.indent ? t('keepOutdent') : t('keepIndent')}
        onClick={() => onChange(changeIndent(items, index, !item.indent))}
      >
        {item.indent ? '⇤' : '⇥'}
      </button>
      <button
        type="button"
        className="todo-item-delete"
        onClick={() => onDelete(index)}
        aria-label={t('deleteItem')}
      >
        ×
      </button>
    </div>
  );
  const grouped = items.map((item, index) => ({ item, index }));
  let parentCompleted = false;
  const sections = grouped.map((entry) => {
    if (!entry.item.indent) parentCompleted = entry.item.completed;
    return {
      ...entry,
      done:
        options.checkedToBottom !== false &&
        (entry.item.completed || (entry.item.indent && parentCompleted)),
    };
  });
  const open = sections.filter((entry) => !entry.done),
    done = sections.filter((entry) => entry.done);
  return (
    <div className="todo-list-container">
      {open.map(({ item, index }) => row(item, index))}
      <button className="todo-add-item" type="button" onClick={onAdd}>
        ＋ {t('todoItem')}
      </button>
      {done.length > 0 && (
        <details
          open={!options.collapseCompleted}
          onToggle={(e) => {
            if (
              e.target === e.currentTarget &&
              options.collapseCompleted === e.currentTarget.open
            )
              onOptions({
                ...options,
                collapseCompleted: !e.currentTarget.open,
              });
          }}
        >
          <summary>
            {done.length} {t('keepCompleted')}
          </summary>
          {done.map(({ item, index }) => row(item, index))}
        </details>
      )}
      <details>
        <summary>{t('keepListSettings')}</summary>
        <label>
          <input
            type="checkbox"
            checked={options.checkedToBottom !== false}
            onChange={(e) =>
              onOptions({ ...options, checkedToBottom: e.target.checked })
            }
          />
          {t('keepCheckedBottom')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.addToTop === true}
            onChange={(e) =>
              onOptions({ ...options, addToTop: e.target.checked })
            }
          />
          {t('keepAddTop')}
        </label>
        <button
          type="button"
          onClick={() =>
            onChange(
              items
                .filter((i) => !i.completed)
                .map((item, index) => ({
                  ...item,
                  indent: index ? item.indent : 0,
                })),
            )
          }
        >
          {t('keepRemoveCompleted')}
        </button>
      </details>
    </div>
  );
}
