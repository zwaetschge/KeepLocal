import React, { useState, useRef, useImperativeHandle, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './SearchBar.css';

const SearchBar = React.forwardRef(({ onSearch }, ref) => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    }
  }));

  // Stable reference to onSearch to avoid re-creating the debounced function
  const onSearchRef = useRef(onSearch);
  useEffect(() => { onSearchRef.current = onSearch; }, [onSearch]);

  const debouncedSearch = useCallback((value) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onSearchRef.current(value);
    }, 300);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    debouncedSearch(value);
  };

  const handleClear = () => {
    setSearchTerm('');
    // Clear immediately without debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
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
