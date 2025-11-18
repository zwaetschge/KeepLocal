import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './NoteModal.css';
import ColorPicker from './ColorPicker';
import LinkPreview from './LinkPreview';
import { getColorVar } from '../utils/colorMapper';
import { useLinkPreview, useTodoList, useModalShortcuts } from '../hooks';
import notesAPI from '../services/api/notesAPI';

function NoteModal({ note, onSave, onClose, onToggleArchive, onOpenCollaborate, onTogglePin, onDelete }) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [tags, setTags] = useState(note?.tags?.join(', ') || '');
  const [color, setColor] = useState(note?.color || '#ffffff');
  const [isTodoList, setIsTodoList] = useState(note?.isTodoList || false);
  const [images, setImages] = useState(note?.images || []);
  const [newImageFiles, setNewImageFiles] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const contentTextareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Custom hooks for link preview and todo list management
  const { linkPreviews, setLinkPreviews, fetchingPreview } = useLinkPreview(content, !isTodoList);
  const {
    todoItems,
    setTodoItems,
    updateItemText: handleTodoItemChange,
    toggleItem: handleTodoItemToggle,
    deleteItem: handleTodoItemDelete,
    handleItemKeyDown: handleTodoItemKeyDown,
    getCleanedItems,
  } = useTodoList(note?.todoItems || []);

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
      setImages(note.images || []);
    }
  }, [note, setTodoItems, setLinkPreviews]);

  const handleSave = () => {
    // Validate based on mode
    if (isTodoList) {
      if (todoItems.length === 0 || todoItems.every((item) => !item.text.trim())) {
        return;
      }
    } else {
      if (!content.trim()) {
        return;
      }
    }

    const tagArray = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');

    const noteData = {
      title: title.trim(),
      content: isTodoList ? '' : content.trim(),
      tags: tagArray,
      color: color,
      isTodoList: isTodoList,
      todoItems: isTodoList ? getCleanedItems() : [],
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
        const lines = content.split('\n').filter((line) => line.trim());
        const items = lines.map((line, index) => ({
          text: line.trim(),
          completed: false,
          order: index,
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
      const contentText = todoItems.map((item) => item.text).join('\n');
      setContent(contentText);
      setTodoItems([]);
    }
  };

  // Add todo item handler (using the hook's internal logic via setTodoItems)
  const handleAddTodoItem = () => {
    setTodoItems([...todoItems, { text: '', completed: false, order: todoItems.length }]);
  };

  // Image upload handlers
  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setNewImageFiles([...newImageFiles, ...files]);
    }
  };

  const handleImageUpload = async () => {
    if (!note || newImageFiles.length === 0) return;

    setUploadingImages(true);
    try {
      const updatedNote = await notesAPI.uploadImages(note._id, newImageFiles);
      setImages(updatedNote.images || []);
      setNewImageFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Fehler beim Hochladen der Bilder:', error);
      alert(error.message || 'Fehler beim Hochladen der Bilder');
    } finally {
      setUploadingImages(false);
    }
  };

  const handleImageDelete = async (filename) => {
    if (!note) return;

    try {
      const updatedNote = await notesAPI.deleteImage(note._id, filename);
      setImages(updatedNote.images || []);
    } catch (error) {
      console.error('Fehler beim Löschen des Bildes:', error);
      alert('Fehler beim Löschen des Bildes');
    }
  };

  const removeNewImageFile = (index) => {
    setNewImageFiles(newImageFiles.filter((_, i) => i !== index));
  };

  // Keyboard shortcuts for modal
  useModalShortcuts(onClose, handleSave, [title, content, tags, color]);

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

          {note && (
            <div className="note-modal-images">
              {images && images.length > 0 && (
                <div className="uploaded-images">
                  {images.map((image, index) => (
                    <div key={index} className="image-preview">
                      <img src={image.url} alt={image.filename} />
                      <button
                        type="button"
                        className="image-delete-btn"
                        onClick={() => handleImageDelete(image.filename)}
                        title="Bild löschen"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {newImageFiles.length > 0 && (
                <div className="new-images-preview">
                  {newImageFiles.map((file, index) => (
                    <div key={index} className="image-preview new">
                      <img src={URL.createObjectURL(file)} alt={file.name} />
                      <button
                        type="button"
                        className="image-delete-btn"
                        onClick={() => removeNewImageFile(index)}
                        title="Entfernen"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                      <span className="new-badge">Neu</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="image-upload-controls">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  style={{ display: 'none' }}
                  id="image-upload-input"
                />
                <label htmlFor="image-upload-input" className="btn-select-images">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  Bilder auswählen
                </label>
                {newImageFiles.length > 0 && (
                  <button
                    type="button"
                    className="btn-upload-images"
                    onClick={handleImageUpload}
                    disabled={uploadingImages}
                  >
                    {uploadingImages ? 'Hochladen...' : `${newImageFiles.length} Bild(er) hochladen`}
                  </button>
                )}
              </div>
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
                title={note.isArchived ? t('unarchive') : t('archive')}
                aria-label={note.isArchived ? t('unarchive') : t('archive')}
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
                title={t('share')}
                aria-label={t('share')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </button>
            )}
            {note && onTogglePin && (
              <button
                type="button"
                className={`btn-modal-pin ${note.isPinned ? 'pinned' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(note._id);
                  onClose();
                }}
                title={note.isPinned ? t('unpin') : t('pin')}
                aria-label={note.isPinned ? t('unpin') : t('pin')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 17v5m-5-9H5a2 2 0 0 1 0-4h14a2 2 0 0 1 0 4h-2m-5-9V2"/>
                </svg>
              </button>
            )}
            {note && onDelete && (
              <button
                type="button"
                className="btn-modal-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(note._id);
                  onClose();
                }}
                title={t('delete')}
                aria-label={t('delete')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
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
