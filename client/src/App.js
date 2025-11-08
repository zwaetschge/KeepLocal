import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import NoteForm from './components/NoteForm';
import NoteList from './components/NoteList';
import SearchBar from './components/SearchBar';
import ThemeToggle from './components/ThemeToggle';
import Toast from './components/Toast';

function App() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Theme-Präferenz aus localStorage laden
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  });

  // Toast-Benachrichtigung anzeigen
  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  // Notizen vom Server laden
  useEffect(() => {
    fetchNotes();
  }, []);

  // Dark Mode anwenden
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  const fetchNotes = async (search = '') => {
    try {
      setLoading(true);
      const params = search ? { search } : {};
      const response = await axios.get('/api/notes', { params });
      setNotes(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Fehler beim Laden der Notizen:', error);
      showToast('Fehler beim Laden der Notizen', 'error');
      setLoading(false);
    }
  };

  // Neue Notiz erstellen
  const createNote = async (noteData) => {
    try {
      const response = await axios.post('/api/notes', noteData);
      setNotes([response.data, ...notes]);
      showToast('Notiz erfolgreich erstellt', 'success');
    } catch (error) {
      console.error('Fehler beim Erstellen der Notiz:', error);
      showToast('Fehler beim Erstellen der Notiz', 'error');
    }
  };

  // Notiz löschen
  const deleteNote = async (id) => {
    try {
      await axios.delete(`/api/notes/${id}`);
      setNotes(notes.filter(note => note._id !== id));
      showToast('Notiz gelöscht', 'success');
    } catch (error) {
      console.error('Fehler beim Löschen der Notiz:', error);
      showToast('Fehler beim Löschen der Notiz', 'error');
    }
  };

  // Notiz aktualisieren
  const updateNote = async (id, updatedData) => {
    try {
      const response = await axios.put(`/api/notes/${id}`, updatedData);
      setNotes(notes.map(note => note._id === id ? response.data : note));
      showToast('Notiz aktualisiert', 'success');
    } catch (error) {
      console.error('Fehler beim Aktualisieren der Notiz:', error);
      showToast('Fehler beim Aktualisieren der Notiz', 'error');
    }
  };

  // Notiz anheften/abheften
  const togglePinNote = async (id) => {
    try {
      const response = await axios.post(`/api/notes/${id}/pin`);
      setNotes(notes.map(note => note._id === id ? response.data : note));
      const message = response.data.isPinned ? 'Notiz angeheftet' : 'Notiz abgeheftet';
      showToast(message, 'success');
    } catch (error) {
      console.error('Fehler beim Anheften der Notiz:', error);
      showToast('Fehler beim Anheften der Notiz', 'error');
    }
  };

  // Suche durchführen
  const handleSearch = (search) => {
    setSearchTerm(search);
    fetchNotes(search);
  };

  // Theme umschalten
  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>📝 KeepLocal</h1>
        <p>Ihre lokale Notizen-App</p>
      </header>

      <main className="App-main">
        <NoteForm onCreateNote={createNote} />

        <SearchBar onSearch={handleSearch} />

        {loading ? (
          <div className="loading">Lade Notizen...</div>
        ) : (
          <NoteList
            notes={notes}
            onDeleteNote={deleteNote}
            onUpdateNote={updateNote}
            onTogglePin={togglePinNote}
          />
        )}
      </main>

      <ThemeToggle isDarkMode={isDarkMode} onToggle={toggleTheme} />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default App;
