# Integration TODO für Archive und Collaboration Features

## Fertiggestellt ✓
- Backend: Note/User Models erweitert
- Backend: Friend-Management API
- Backend: Archive & Share API Endpoints
- Frontend: API Client erweitert
- Frontend: Note Component (Archive & Collaborate Buttons)
- Frontend: FriendsModal Component
- Frontend: CollaborateModal Component
- Frontend: Sidebar erweitert (Archiv & Freunde)

## Noch zu tun in App.js

### 1. State hinzufügen:
```javascript
const [showArchived, setShowArchived] = useState(false);
const [showFriendsModal, setShowFriendsModal] = useState(false);
const [showCollaborateModal, setShowCollaborateModal] = useState(false);
const [collaborateNote, setCollaborateNote] = useState(null);
```

### 2. Notizen laden anpassen:
```javascript
const fetchNotes = useCallback(async (search = '', page = 1) => {
  // ...
  const params = {
    page,
    limit: 50,
    archived: showArchived ? 'true' : 'false'  // NEU
  };
  // ...
}, [isLoggedIn, showToast, showArchived]);  // showArchived zu dependencies
```

### 3. Handler hinzufügen:
```javascript
const toggleArchive = async (id) => {
  try {
    const response = await notesAPI.toggleArchive(id);
    setNotes(notes.map(note => note._id === id ? response : note));
    showToast(response.isArchived ? 'Notiz archiviert' : 'Notiz dearchiviert', 'success');
    // Optional: Nach Archivierung aus der Liste entfernen wenn nicht in Archiv-Ansicht
    if (!showArchived && response.isArchived) {
      setNotes(notes.filter(note => note._id !== id));
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
};

const openCollaborateModal = (note) => {
  setCollaborateNote(note);
  setShowCollaborateModal(true);
};

const handleNoteShared = (updatedNote) => {
  setNotes(notes.map(note => note._id === updatedNote._id ? updatedNote : note));
};
```

### 4. Components einbinden:
```jsx
import FriendsModal from './components/FriendsModal';
import CollaborateModal from './components/CollaborateModal';

// In JSX:
<FriendsModal
  isOpen={showFriendsModal}
  onClose={() => setShowFriendsModal(false)}
  isAdmin={user?.isAdmin}
/>

<CollaborateModal
  isOpen={showCollaborateModal}
  onClose={() => setShowCollaborateModal(false)}
  note={collaborateNote}
  onNoteUpdate={handleNoteShared}
/>
```

### 5. Props an Komponenten weitergeben:
```jsx
<Sidebar
  // ... existing props
  archivedCount={/* Anzahl archivierter Notizen berechnen */}
  showArchived={showArchived}
  onShowArchivedToggle={() => setShowArchived(!showArchived)}
  onOpenFriends={() => setShowFriendsModal(true)}
/>

<Note
  // ... existing props
  onToggleArchive={toggleArchive}
  onOpenCollaborate={openCollaborateModal}
/>
```

### 6. Anzahl archivierter Notizen berechnen:
```javascript
const archivedCount = useMemo(() => {
  // API call oder separater State für archivierte Notizen Count
  return 0; // Placeholder
}, [notes]);
```

## Test-Checkliste
- [ ] Freunde hinzufügen/entfernen
- [ ] Freundschaftsanfragen senden/akzeptieren/ablehnen
- [ ] Notizen archivieren/dearchivieren
- [ ] Archiv-Ansicht anzeigen
- [ ] Notizen mit Freunden teilen
- [ ] Geteilte Notizen bearbeiten können
- [ ] Admin kann alle User sehen ohne Freundschaftsanfrage

## Anmerkungen
- Die Backend-Routes sind fertig und getestet
- Alle Frontend-Komponenten sind erstellt
- Es fehlt nur die Integration in App.js
- Die MongoDB-Models unterstützen bereits alle Features
