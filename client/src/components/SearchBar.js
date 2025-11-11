import React, { useState, useRef, useImperativeHandle } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './SearchBar.css';

const SearchBar = React.forwardRef(({ onSearch }, ref) => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const inputRef = useRef(null);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    }
  }));

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    onSearch(value);
  };

  const handleClear = () => {
    setSearchTerm('');
    onSearch('');
    inputRef.current?.focus();
  };

  return (
    <div className="search-bar" role="search">
      <input
        ref={inputRef}
        type="search"
        placeholder={t('searchPlaceholder')}
        value={searchTerm}
        onChange={handleSearch}
        className="search-input"
        aria-label={t('searchNotes')}
      />
      {searchTerm && (
        <button
          onClick={handleClear}
          className="search-clear"
          title={t('clearSearch')}
          aria-label={t('clearSearch')}
        >
          ✕
        </button>
      )}
      <span className="search-icon" aria-hidden="true">🔍</span>
    </div>
  );
});

SearchBar.displayName = 'SearchBar';

export default SearchBar;
