import React, { useLayoutEffect, useRef } from 'react';
import {
  readRichDom,
  writeRichDom,
  richSegments,
  formatMarks,
  richSelection,
  selectRichRange,
} from '../utils/richText.mjs';
import { useLanguage } from '../contexts/LanguageContext';
export function RichTextPreview({ text, marks = [] }) {
  return (
    <>
      {richSegments(text, marks).map((s, i) => (
        <span
          key={i}
          style={{
            fontWeight:
              s.types.includes('bold') ||
              s.types.some((t) => t === 'h1' || t === 'h2')
                ? 600
                : undefined,
            fontStyle: s.types.includes('italic') ? 'italic' : undefined,
            textDecoration: s.types.includes('underline')
              ? 'underline'
              : undefined,
            fontSize: s.types.includes('h1')
              ? '1.5em'
              : s.types.includes('h2')
                ? '1.25em'
                : undefined,
          }}
        >
          {s.text}
        </span>
      ))}
    </>
  );
}
export default function RichTextEditor({ value, marks = [], onChange }) {
  const { t } = useLanguage();
  const root = useRef(null);
  const local = useRef(null);
  useLayoutEffect(() => {
    const key = JSON.stringify([value, marks]);
    if (local.current !== key) {
      writeRichDom(root.current, value, marks);
      local.current = key;
    }
  }, [value, marks]);
  const update = () => {
    const result = readRichDom(root.current);
    if (result.text.length > 10000) {
      writeRichDom(root.current, value, marks);
      return;
    }
    local.current = JSON.stringify([result.text, result.marks]);
    onChange(result.text, result.marks);
  };
  const command = (name, arg) => {
    if (name === 'insertText') {
      root.current.focus();
      document.execCommand(name, false, arg);
      update();
      return;
    }
    const selection = richSelection(root.current);
    if (!selection) return;
    const data = readRichDom(root.current);
    const type =
      name === 'formatBlock'
        ? arg === 'p'
          ? 'plain'
          : arg
        : name === 'removeFormat'
          ? 'clear'
          : name;
    const next = formatMarks(
      data.marks,
      data.text,
      selection.start,
      selection.end,
      type,
    );
    if (next.length > 1000) return;
    writeRichDom(root.current, data.text, next);
    root.current.focus();
    selectRichRange(root.current, selection.start, selection.end);
    update();
  };
  return (
    <div className="rich-editor">
      <div
        className="format-toolbar"
        role="toolbar"
        aria-label={t('keepFormatting')}
      >
        {[
          ['H1', 'formatBlock', 'h1'],
          ['H2', 'formatBlock', 'h2'],
          ['Aa', 'formatBlock', 'p'],
          ['B', 'bold'],
          ['I', 'italic'],
          ['U', 'underline'],
          ['⊘', 'removeFormat'],
        ].map(([label, cmd, arg]) => (
          <button
            key={label}
            type="button"
            title={t(`keepFormat_${cmd}`) + (arg ? ' ' + arg : '')}
            aria-label={t(`keepFormat_${cmd}`) + (arg ? ' ' + arg : '')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(cmd, arg)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        ref={root}
        role="textbox"
        aria-label={t('noteContent')}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        className="rich-content"
        onInput={update}
        onPaste={(e) => {
          e.preventDefault();
          command('insertText', e.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
}
