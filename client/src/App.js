import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import NoteForm from './components/NoteForm';
import NoteList from './components/NoteList';

function App() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Notizen vom Server laden
  useEffect(() => {
    fetchNotes();
  }, []);

  const fetchNotes = async () => {
    try {
      const response = await axios.get('/api/notes');
      setNotes(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Fehler beim Laden der Notizen:', error);
      setLoading(false);
    }
  };

  // Neue Notiz erstellen
  const createNote = async (noteData) => {
    try {
      const response = await axios.post('/api/notes', noteData);
      setNotes([response.data, ...notes]);
    } catch (error) {
      console.error('Fehler beim Erstellen der Notiz:', error);
    }
  };

  // Notiz löschen
  const deleteNote = async (id) => {
    try {
      await axios.delete(`/api/notes/${id}`);
      setNotes(notes.filter(note => note.id !== id));
    } catch (error) {
      console.error('Fehler beim Löschen der Notiz:', error);
    }
  };

  // Notiz aktualisieren
  const updateNote = async (id, updatedData) => {
    try {
      const response = await axios.put(`/api/notes/${id}`, updatedData);
      setNotes(notes.map(note => note.id === id ? response.data : note));
    } catch (error) {
      console.error('Fehler beim Aktualisieren der Notiz:', error);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>📝 KeepLocal</h1>
        <p>Ihre lokale Notizen-App</p>
      </header>

      <main className="App-main">
        <NoteForm onCreateNote={createNote} />

        {loading ? (
          <div className="loading">Lade Notizen...</div>
        ) : (
          <NoteList
            notes={notes}
            onDeleteNote={deleteNote}
            onUpdateNote={updateNote}
          />
        )}
      </main>
    </div>
  );
}

export default App;
