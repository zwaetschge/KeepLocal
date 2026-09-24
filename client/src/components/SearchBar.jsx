import React, { useState, useRef, useImperativeHandle, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './SearchBar.css';

const SearchBar = React.forwardRef(({ onSearch, searchTerm: externalSearchTerm }, ref) => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // v1.18.0: Gespeicherte Suchen setzen den Begriff von außen — das Feld muss
  // ihm folgen (vorher zeigte es weiter den zuletzt getippten Text und die
  // Liste filterte nach etwas anderem als dastand). Ein noch laufender Debounce
  // des getippten Texts wird mitgekündigt, sonst überholte er die gespeicherte
  // Suche 300 ms später.
  useEffect(() => {
    if (externalSearchTerm === undefined) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchTerm(externalSearchTerm);
  }, [externalSearchTerm]);

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
        onKeyDown={(event) => {
          // Escape leert die Suche und gibt den Fokus frei, statt (wie bisher)
          // nur den Browser-Default zu triggern.
          if (event.key === 'Escape' && searchTerm) {
            event.stopPropagation();
            handleClear();
          }
        }}
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
