import React from 'react';
import './LinkPreview.css';

function LinkPreview({ preview, onRemove }) {
  const { url, title, description, image, siteName } = preview;

  const handleClick = (e) => {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    if (onRemove) {
      onRemove();
    }
  };

  return (
    <div className="link-preview" onClick={handleClick}>
      {image && (
        <div className="link-preview-image-container">
          <img
            src={image}
            alt={title || siteName || 'Link preview'}
            className="link-preview-image"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      )}
      <div className="link-preview-content">
        {siteName && (
          <div className="link-preview-site">{siteName}</div>
        )}
        {title && (
          <div className="link-preview-title">{title}</div>
        )}
        {description && (
          <div className="link-preview-description">{description}</div>
        )}
        <div className="link-preview-url">{url}</div>
      </div>
      {onRemove && (
        <button
          className="link-preview-remove"
          onClick={handleRemove}
          aria-label="Vorschau entfernen"
          title="Vorschau entfernen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  );
}

export default LinkPreview;
