import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './NoteModal.css';
import ColorPicker from './ColorPicker';
import LinkPreview from './LinkPreview';
import { sanitize } from '../utils/sanitize';
import { getColorVar } from '../utils/colorMapper';
import { fetchLinkPreviewAPI } from '../services/api';

function NoteModal({ note, onSave, onClose, onToggleArchive, onOpenCollaborate }) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [tags, setTags] = useState(note?.tags?.join(', ') || '');
  const [color, setColor] = useState(note?.color || '#ffffff');
  const [isTodoList, setIsTodoList] = useState(note?.isTodoList || false);
  const [todoItems, setTodoItems] = useState(note?.todoItems || []);
  const [linkPreviews, setLinkPreviews] = useState(note?.linkPreviews || []);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const contentTextareaRef = useRef(null);
  const fetchTimeoutRef = useRef(null);

  // Update state when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title || '');
      setContent(note.content || '');
      setTags(note.tags?.join(', ') || '');
      setColor(note.color || '#ffffff');
      setIsTodoList(note.isTodoList || false);
      setTodoItems(note.todoItems || []);
      setLinkPreviews(note.linkPreviews || []);
    }
  }, [note]);

  // Detect URLs in content and fetch previews
  useEffect(() => {
    if (isTodoList || !content || content.trim() === '') {
      return;
    }

    // Clear previous timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce URL detection
    fetchTimeoutRef.current = setTimeout(() => {
      const urlPattern = /(https?:\/\/[^\s]+)/g;
      const urls = content.match(urlPattern);

      if (urls && urls.length > 0) {
        // Only fetch preview for first URL and if it's not already in linkPreviews
        const firstUrl = urls[0];
        const existingPreview = linkPreviews.find(p => p.url === firstUrl);

        if (!existingPreview && !fetchingPreview) {
          setFetchingPreview(true);
          fetchLinkPreviewAPI(firstUrl)
            .then(preview => {
              setLinkPreviews([preview]);
              setFetchingPreview(false);
            })
            .catch(error => {
              console.error('Failed to fetch link preview:', error);
              setFetchingPreview(false);
            });
        }
      } else {
        // No URLs found, clear previews
        setLinkPreviews([]);
      }
    }, 1000); // Wait 1 second after typing stops

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [content, isTodoList, linkPreviews, fetchingPreview]);

  const handleSave = () => {
    // Validate based on mode
    if (isTodoList) {
      if (todoItems.length === 0 || todoItems.every(item => !item.text.trim())) {
        return;
      }
    } else {
      if (!content.trim()) {
        return;
      }
    }

    const tagArray = tags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag !== '');

    const noteData = {
      title: title.trim(),
      content: isTodoList ? '' : content.trim(),
      tags: tagArray,
      color: color,
      isTodoList: isTodoList,
      todoItems: isTodoList ? todoItems.filter(item => item.text.trim()).map((item, index) => ({
        text: item.text.trim(),
        completed: item.completed || false,
        order: index
      })) : [],
      linkPreviews: linkPreviews || [],
    };

    onSave(noteData);
    onClose();
  };

  const handleToggleTodoMode = () => {
    const newMode = !isTodoList;
    setIsTodoList(newMode);

    // When switching to todo mode, convert content to todo items
    if (newMode) {
      if (content.trim()) {
        const lines = content.split('\n').filter(line => line.trim());
        const items = lines.map((line, index) => ({
          text: line.trim(),
          completed: false,
          order: index
        }));
        setTodoItems(items);
        setContent('');
      } else {
        // Start with one empty item
        setTodoItems([{ text: '', completed: false, order: 0 }]);
      }
    }
    // When switching to regular mode, convert todo items to content
    else if (!newMode && todoItems.length > 0) {
      const contentText = todoItems.map(item => item.text).join('\n');
      setContent(contentText);
      setTodoItems([]);
    }
  };

  const handleAddTodoItem = () => {
    setTodoItems([...todoItems, { text: '', completed: false, order: todoItems.length }]);
  };

  const handleTodoItemChange = (index, text) => {
    const updated = [...todoItems];
    updated[index] = { ...updated[index], text };
    setTodoItems(updated);
  };

  const handleTodoItemToggle = (index) => {
    const updated = [...todoItems];
    updated[index] = { ...updated[index], completed: !updated[index].completed };
    setTodoItems(updated);
  };

  const handleTodoItemDelete = (index) => {
    const updated = todoItems.filter((_, i) => i !== index);
    setTodoItems(updated.map((item, i) => ({ ...item, order: i })));
  };

  const handleTodoItemKeyDown = (e, index) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTodoItem();
    } else if (e.key === 'Backspace' && !todoItems[index].text && todoItems.length > 1) {
      e.preventDefault();
      handleTodoItemDelete(index);
    }
  };

  const handleKeyDown = (e) => {
    // ESC to close
    if (e.key === 'Escape') {
      onClose();
    }
    // Ctrl/Cmd + Enter to save
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSave();
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [title, content, tags, color]);

  return (
    <div className="note-modal-overlay" onClick={onClose}>
      <div
        className="note-modal"
        style={{ backgroundColor: getColorVar(color) }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="note-modal-close"
          onClick={onClose}
          aria-label={t('close')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="note-modal-body">
          <input
            type="text"
            className="note-modal-title"
            placeholder={t('title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={!isTodoList}
          />

          {isTodoList ? (
            <div className="todo-list-container">
              {todoItems.map((item, index) => (
                <div key={index} className="todo-item">
                  <input
                    type="checkbox"
                    className="todo-item-checkbox"
                    checked={item.completed}
                    onChange={() => handleTodoItemToggle(index)}
                  />
                  <input
                    type="text"
                    className={`todo-item-input ${item.completed ? 'completed' : ''}`}
                    placeholder={t('todoItem')}
                    value={item.text}
                    onChange={(e) => handleTodoItemChange(index, e.target.value)}
                    onKeyDown={(e) => handleTodoItemKeyDown(e, index)}
                    autoFocus={index === todoItems.length - 1}
                  />
                  <button
                    type="button"
                    className="todo-item-delete"
                    onClick={() => handleTodoItemDelete(index)}
                    aria-label={t('deleteItem')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="todo-add-item"
                onClick={handleAddTodoItem}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                {t('todoItem')}
              </button>
            </div>
          ) : (
            <textarea
              ref={contentTextareaRef}
              className="note-modal-content"
              placeholder={t('enterNote')}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
            />
          )}

          {!isTodoList && linkPreviews && linkPreviews.length > 0 && (
            <div className="note-modal-link-previews">
              {linkPreviews.map((preview, index) => (
                <LinkPreview
                  key={index}
                  preview={preview}
                  onRemove={() => {
                    setLinkPreviews(linkPreviews.filter((_, i) => i !== index));
                  }}
                />
              ))}
            </div>
          )}

          <input
            type="text"
            className="note-modal-tags"
            placeholder={t('tagsPlaceholder')}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        <div className="note-modal-footer">
          <div className="note-modal-toolbar">
            <ColorPicker
              selectedColor={color}
              onColorSelect={setColor}
            />
            <button
              type="button"
              className={`btn-modal-checkbox ${isTodoList ? 'active' : ''}`}
              onClick={handleToggleTodoMode}
              title={isTodoList ? t('switchToNote') : t('switchToList')}
              aria-label={isTodoList ? t('switchToNote') : t('switchToList')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <path d="M9 11l3 3 6-6"/>
              </svg>
            </button>
            {note && onToggleArchive && (
              <button
                type="button"
                className={`btn-modal-archive ${note.isArchived ? 'archived' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleArchive(note._id);
                  onClose();
                }}
                title={note.isArchived ? "Dearchivieren" : "Archivieren"}
                aria-label={note.isArchived ? "Dearchivieren" : "Archivieren"}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
                </svg>
              </button>
            )}
            {note && onOpenCollaborate && (
              <button
                type="button"
                className="btn-modal-collaborate"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenCollaborate(note);
                  onClose();
                }}
                title="Teilen"
                aria-label="Teilen"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </button>
            )}
          </div>
          <div className="note-modal-actions">
            <button
              className="btn-modal-cancel"
              onClick={onClose}
            >
              {t('cancel')}
            </button>
            <button
              className="btn-modal-save"
              onClick={handleSave}
              disabled={isTodoList ? (todoItems.length === 0 || todoItems.every(item => !item.text.trim())) : !content.trim()}
            >
              {t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NoteModal;
