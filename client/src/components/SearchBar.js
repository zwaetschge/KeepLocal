import React, { useState } from 'react';
import './SearchBar.css';

function SearchBar({ onSearch }) {
  const [searchTerm, setSearchTerm] = useState('');

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    onSearch(value);
  };

  const handleClear = () => {
    setSearchTerm('');
    onSearch('');
  };

  return (
    <div className="search-bar">
      <input
        type="text"
        placeholder="Notizen durchsuchen..."
        value={searchTerm}
        onChange={handleSearch}
        className="search-input"
      />
      {searchTerm && (
        <button onClick={handleClear} className="search-clear" title="Suche löschen">
          ✕
        </button>
      )}
      <span className="search-icon">🔍</span>
    </div>
  );
}

export default SearchBar;
