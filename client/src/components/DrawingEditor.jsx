import React, { useState, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
export function DrawingPreview({ drawing, images = [] }) {
  const { t } = useLanguage();
  if (!drawing?.strokes?.length && !drawing?.imageFilename) return null;
  const background = images.find((i) => i.filename === drawing.imageFilename);
  return (
    <svg
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      className="drawing-preview"
      role="img"
      aria-label={t('keepDrawing')}
    >
      {background && (
        <image
          href={background.url}
          width={drawing.width}
          height={drawing.height}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {drawing.strokes.map((s, i) => (
        <polyline
          key={i}
          points={s.points.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
export default function DrawingEditor({ value, onChange, images = [] }) {
  const { t } = useLanguage();
  const drawing = value || { width: 800, height: 600, strokes: [] };
  const [color, setColor] = useState('#202124');
  const [width, setWidth] = useState(3);
  const [erase, setErase] = useState(false);
  const [active, setActive] = useState(null);
  const current = useRef(null);
  const point = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(
          drawing.width,
          ((e.clientX - r.left) * drawing.width) / r.width,
        ),
      ),
      Math.max(
        0,
        Math.min(
          drawing.height,
          ((e.clientY - r.top) * drawing.height) / r.height,
        ),
      ),
    ];
  };
  const finish = () => {
    const stroke = current.current;
    if (stroke) {
      onChange({ ...drawing, strokes: [...drawing.strokes, stroke] });
      current.current = null;
      setActive(null);
    }
  };
  return (
    <div className="drawing-editor">
      <div
        className="format-toolbar"
        role="toolbar"
        aria-label={t('keepDrawingTools')}
      >
        <label>
          {t('keepColor')}{' '}
          <input
            type="color"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
              setErase(false);
            }}
          />
        </label>
        <label>
          {t('keepPenWidth')}{' '}
          <input
            type="range"
            min="1"
            max="20"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          aria-pressed={erase}
          onClick={() => setErase(!erase)}
        >
          {t('keepEraser')}
        </button>
        <button
          type="button"
          disabled={!drawing.strokes.length}
          onClick={() =>
            onChange({ ...drawing, strokes: drawing.strokes.slice(0, -1) })
          }
        >
          {t('keepUndo')}
        </button>
        {images.length > 0 && (
          <select
            aria-label={t('keepAnnotate')}
            value={drawing.imageFilename || ''}
            onChange={(e) =>
              onChange({
                ...drawing,
                imageFilename: e.target.value || undefined,
              })
            }
          >
            <option value="">{t('keepBlankCanvas')}</option>
            {images.map((im, i) => (
              <option key={im.filename} value={im.filename}>
                {t('keepImage')} {i + 1}
              </option>
            ))}
          </select>
        )}
      </div>
      <svg
        className="drawing-canvas"
        viewBox={`0 0 ${drawing.width} ${drawing.height}`}
        role="img"
        aria-label={t('keepDrawingCanvas')}
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            onChange({ ...drawing, strokes: drawing.strokes.slice(0, -1) });
          }
        }}
        onPointerDown={(e) => {
          const p = point(e);
          e.currentTarget.setPointerCapture(e.pointerId);
          if (erase) {
            let chosen = -1;
            let distance = 25;
            drawing.strokes.forEach((s, i) =>
              s.points.forEach((q) => {
                const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
                if (d < distance) {
                  chosen = i;
                  distance = d;
                }
              }),
            );
            if (chosen >= 0)
              onChange({
                ...drawing,
                strokes: drawing.strokes.filter((_, i) => i !== chosen),
              });
            return;
          }
          if (drawing.strokes.length >= 500) return;
          current.current = {
            color,
            width,
            points: [
              p,
              [
                Math.min(drawing.width, p[0] + 0.1),
                Math.min(drawing.height, p[1] + 0.1),
              ],
            ],
          };
          setActive(current.current);
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          const total = drawing.strokes.reduce(
            (n, s) => n + s.points.length,
            0,
          );
          if (total + current.current.points.length >= 20000) return;
          current.current = {
            ...current.current,
            points: [...current.current.points, point(e)],
          };
          setActive(current.current);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <rect
          width={drawing.width}
          height={drawing.height}
          fill="var(--bg-paper)"
        />
        {images.find((i) => i.filename === drawing.imageFilename) && (
          <image
            href={images.find((i) => i.filename === drawing.imageFilename).url}
            width={drawing.width}
            height={drawing.height}
            preserveAspectRatio="xMidYMid meet"
          />
        )}
        {[...drawing.strokes, ...(active ? [active] : [])].map((s, i) => (
          <polyline
            key={i}
            points={s.points.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}
