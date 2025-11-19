import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSettings } from '../contexts/SettingsContext';
import './NoteModal.css';
import ColorPicker from './ColorPicker';
import LinkPreview from './LinkPreview';
import { getColorVar } from '../utils/colorMapper';
import { useLinkPreview, useTodoList, useModalShortcuts } from '../hooks';
import notesAPI from '../services/api/notesAPI';

function NoteModal({ note, onSave, onClose, onToggleArchive, onOpenCollaborate, onTogglePin, onDelete }) {
  const { t } = useLanguage();
  const { settings } = useSettings();
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [tags, setTags] = useState(note?.tags?.join(', ') || '');
  const [color, setColor] = useState(note?.color || '#ffffff');
  const [isTodoList, setIsTodoList] = useState(note?.isTodoList || false);
  const [images, setImages] = useState(note?.images || []);
  const [newImageFiles, setNewImageFiles] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null); // {index, url}
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const contentTextareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

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

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (contentTextareaRef.current && !isTodoList) {
      const textarea = contentTextareaRef.current;
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight to fit all content
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [content, isTodoList]);

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

  // Lightbox handlers
  const openLightbox = (index) => {
    setLightboxImage({ index, url: images[index].url });
  };

  const closeLightbox = () => {
    setLightboxImage(null);
  };

  const nextImage = () => {
    if (lightboxImage && images.length > 0) {
      const nextIndex = (lightboxImage.index + 1) % images.length;
      setLightboxImage({ index: nextIndex, url: images[nextIndex].url });
    }
  };

  const prevImage = () => {
    if (lightboxImage && images.length > 0) {
      const prevIndex = (lightboxImage.index - 1 + images.length) % images.length;
      setLightboxImage({ index: prevIndex, url: images[prevIndex].url });
    }
  };

  // Voice recording handlers
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());

        // Automatically transcribe after recording stops
        await handleTranscribe(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Fehler beim Starten der Aufnahme:', error);
      alert('Fehler beim Zugriff auf das Mikrofon. Bitte überprüfen Sie die Berechtigungen.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleTranscribe = async (audioBlob) => {
    if (!note) {
      alert('Bitte speichern Sie die Notiz zuerst, bevor Sie eine Aufnahme transkribieren.');
      return;
    }

    setIsTranscribing(true);
    try {
      const transcription = await notesAPI.transcribeAudio(note._id, audioBlob);

      // Append transcribed text to content
      if (transcription && transcription.text) {
        const separator = content.trim() ? '\n\n' : '';
        setContent(content + separator + transcription.text);
      }
    } catch (error) {
      console.error('Fehler bei der Transkription:', error);
      alert(error.message || 'Fehler bei der Transkription');
    } finally {
      setIsTranscribing(false);
    }
  };

  // Keyboard shortcuts for lightbox
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (lightboxImage) {
        if (e.key === 'Escape') {
          closeLightbox();
        } else if (e.key === 'ArrowRight') {
          nextImage();
        } else if (e.key === 'ArrowLeft') {
          prevImage();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage, images]);

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

          {note && images && images.length > 0 && (
            <div className="note-modal-images">
              <div className="uploaded-images">
                {images.map((image, index) => (
                  <div key={index} className="image-preview" onClick={() => openLightbox(index)}>
                    <img src={image.url} alt={image.filename} />
                    <button
                      type="button"
                      className="image-delete-btn"
                      onClick={(e) => { e.stopPropagation(); handleImageDelete(image.filename); }}
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
            </div>
          )}

          {note && newImageFiles.length > 0 && (
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

          {/* Hidden file input for image selection */}
          {note && (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              style={{ display: 'none' }}
              id="image-upload-input"
            />
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
            {note && (
              <>
                <label
                  htmlFor="image-upload-input"
                  className="btn-modal-image-select"
                  title="Bilder auswählen"
                  style={{ cursor: 'pointer' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </label>
                {newImageFiles.length > 0 && (
                  <button
                    type="button"
                    className={`btn-modal-image-upload ${uploadingImages ? 'uploading' : ''}`}
                    onClick={handleImageUpload}
                    disabled={uploadingImages}
                    title={uploadingImages ? 'Hochladen...' : `${newImageFiles.length} Bild(er) hochladen`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {newImageFiles.length > 0 && (
                      <span className="image-count-badge">{newImageFiles.length}</span>
                    )}
                  </button>
                )}
              </>
            )}
            {note && settings.aiFeatures.voiceTranscription && !isTodoList && (
              <button
                type="button"
                className={`btn-modal-voice ${isRecording ? 'recording' : ''} ${isTranscribing ? 'transcribing' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isTranscribing}
                title={isRecording ? 'Aufnahme stoppen' : isTranscribing ? 'Transkribiere...' : 'Sprachaufnahme starten'}
                aria-label={isRecording ? 'Aufnahme stoppen' : 'Sprachaufnahme starten'}
              >
                {isTranscribing ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                )}
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

      {/* Lightbox for viewing images */}
      {lightboxImage && (
        <div className="lightbox-overlay" onClick={closeLightbox}>
          <button className="lightbox-close" onClick={closeLightbox} aria-label="Schließen">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {images.length > 1 && (
            <>
              <button className="lightbox-prev" onClick={(e) => { e.stopPropagation(); prevImage(); }} aria-label="Vorheriges Bild">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <button className="lightbox-next" onClick={(e) => { e.stopPropagation(); nextImage(); }} aria-label="Nächstes Bild">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </>
          )}

          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxImage.url} alt={`Bild ${lightboxImage.index + 1}`} />
            {images.length > 1 && (
              <div className="lightbox-counter">
                {lightboxImage.index + 1} / {images.length}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NoteModal;
