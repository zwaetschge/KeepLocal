import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';
import { newLocalId } from '../utils/localId.mjs';
import React, { useRef, useState, useImperativeHandle, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { readDraft, writeDraft, clearDraft } from '../utils/noteDraft.mjs';
import notesAPI from '../services/api/notesAPI';
import './NoteForm.css';
import KeepIcon from './KeepIcon';

const QuickCapture = React.forwardRef(
  ({ onOpenModal, onCreate, onSaved, parentId = null }, ref) => {
    const { t } = useLanguage();
    const { user } = useAuth();
    const owner = user?.id || user?._id;
    const [expanded, setExpanded] = useState(false);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [list, setList] = useState(false);
    const [files, setFiles] = useState([]);
    const [features, setFeatures] = useState({ format: 'rich', marks: [] });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const input = useRef(null);
    const picker = useRef(null);
    const persisted = useRef(null);
    useImperativeHandle(ref, () => ({
      focus: (kind = 'text') => {
        setExpanded(true);
        setList(kind === 'list');
        requestAnimationFrame(() => input.current?.focus());
      },
    }));
    useEffect(() => {
      const draft = readDraft(null, owner);
      if (draft) {
        if (
          draft.features?.marks?.length ||
          draft.features?.drawing ||
          draft.tags?.length ||
          (draft.color && draft.color !== '#ffffff') ||
          draft.todoItems?.some((item) => item.completed || item.indent)
        ) {
          onOpenModal(null);
          return;
        }
        setFeatures(draft.features || { format: 'plain', marks: [] });
        setTitle(draft.title || '');
        setContent(
          draft.content ||
            (draft.todoItems || []).map((i) => i.text).join('\n'),
        );
        setList(Boolean(draft.isTodoList));
        setExpanded(true);
      }
    }, [owner, onOpenModal]);
    useEffect(() => {
      if (title.trim() || content.trim())
        writeDraft(null, owner, {
          title,
          content,
          isTodoList: list,
          todoItems: [],
          color: '#ffffff',
          features,
        });
    }, [title, content, list, owner, features]);
    const reset = () => {
      setTitle('');
      setContent('');
      setFiles([]);
      setExpanded(false);
      persisted.current = null;
      setFeatures({ format: 'rich', marks: [] });
      clearDraft(null, owner);
    };
    const save = async () => {
      if (busy || (!title.trim() && !content.trim() && !files.length)) return;
      setBusy(true);
      setError('');
      try {
        const data = {
          features,
          title: title.trim() || (!content.trim() ? files[0]?.name : '') || '',
          content: list ? '' : content,
          isTodoList: list,
          parentId,
          todoItems: list
            ? content
                .split('\n')
                .filter((s) => s.trim())
                .map((text, order) => ({
                  id: newLocalId(),
                  text,
                  completed: false,
                  order,
                  indent: 0,
                }))
            : [],
        };
        let note = persisted.current
          ? await notesAPI.update(persisted.current._id, {
              ...data,
              baseUpdatedAt: persisted.current.updatedAt,
            })
          : await onCreate(data);
        if (!note) return;
        persisted.current = note;
        if (files.length) {
          note = await notesAPI.uploadImages(note._id, files);
          persisted.current = note;
          setFiles([]);
        }
        reset();
        onSaved?.();
      } catch (e) {
        setError(resolveApiErrorMessage(e, t, 'errorSaving'));
      } finally {
        setBusy(false);
      }
    };
    const advanced = () => {
      const seed = {
        features,
        title,
        content: list ? '' : content,
        isTodoList: list,
        todoItems: list
          ? content
              .split('\n')
              .filter((s) => s.trim())
              .map((text, order) => ({
                id: persisted.current?.todoItems?.[order]?.id || newLocalId(),
                text,
                order,
                completed: false,
                indent: 0,
              }))
          : [],
        imageFiles: files,
      };
      onOpenModal(
        persisted.current ? { ...persisted.current, ...seed } : null,
        seed,
      );
      clearDraft(null, owner);
      setTitle('');
      setContent('');
      setFiles([]);
      setExpanded(false);
    };
    return (
      <section
        className={`note-form-container quick-capture ${expanded ? 'expanded' : ''}`}
        aria-label={t('createNewNote')}
      >
        {!expanded ? (
          <div className="quick-capture-row">
            <button
              className="note-form-button"
              onClick={() => {
                setExpanded(true);
                setList(false);
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              {t('layoutTakeNote')}
            </button>
            <button
              className="capture-icon"
              aria-label={t('newList')}
              title={t('newList')}
              onClick={() => {
                setList(true);
                setExpanded(true);
              }}
            >
              <KeepIcon name="checklist"/>
            </button>
            {!user?.isDemo && (
              <button
                className="capture-icon"
                aria-label={t('addImage')}
                title={t('addImage')}
                onClick={() => picker.current?.click()}
              >
                <KeepIcon name="image"/>
              </button>
            )}
            <button
              className="capture-icon"
              aria-label={t('keepDrawing')}
              title={t('keepDrawing')}
              onClick={() =>
                onOpenModal(null, {
                  features: {
                    drawing: { width: 800, height: 600, strokes: [] },
                    format: 'rich',
                  },
                })
              }
            >
              <KeepIcon name="edit"/>
            </button>
          </div>
        ) : (
          <>
            <input
              className="note-form-title"
              value={title}
              maxLength={200}
              placeholder={t('title')}
              onChange={(e) => setTitle(e.target.value)}
              aria-label={t('title')}
              disabled={busy}
            />
            <textarea
              ref={input}
              className="note-form-content"
              value={content}
              maxLength={10000}
              placeholder={list ? t('listOnePerLine') : t('enterNote')}
              aria-label={t('noteContent')}
              onChange={(e) => setContent(e.target.value)}
              disabled={busy}
            />
            {files.length > 0 && (
              <p>
                {files.map((f) => f.name).join(', ')}{' '}
                <button
                  onClick={() => setFiles([])}
                  disabled={busy}
                  aria-label={t('removeImage')}
                >
                  ×
                </button>
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="quick-capture-actions">
              <button
                onClick={() => setList(!list)}
                aria-pressed={list}
                disabled={busy}
              >
                {t('newList')}
              </button>
              {!user?.isDemo && (
                <button onClick={() => picker.current?.click()} disabled={busy}>
                  {t('addImage')}
                </button>
              )}
              <button onClick={advanced} disabled={busy}>
                {t('fullEditor')}
              </button>
              <button
                onClick={
                  title.trim() || content.trim() || files.length ? save : reset
                }
                disabled={busy}
              >
                {busy ? t('saving') : t('close')}
              </button>
            </div>
          </>
        )}
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            setFiles(Array.from(e.target.files || []).slice(0, 5));
            setExpanded(true);
            e.target.value = '';
          }}
        />
      </section>
    );
  },
);
QuickCapture.displayName = 'QuickCapture';
export default QuickCapture;
