# Faster capture, richer notes, personal organization

The web client and Android app share these features. Use the server and clients
from the same release: the previous 1.18.1 server does not understand the new
formatting, drawing, recording and personal-organization fields.

## Everyday use

- **Web:** click the capture bar to write inline. The adjacent actions start a
  list, image note or drawing. A title alone can be saved. Select images before
  the first save; retrying a failed upload continues on the note already created.
- **Android:** the create button offers text, list, image and drawing. Images can
  also arrive through Android's Share action, including multiple images. Launcher
  shortcuts and the quick-capture widget use the same capture paths.
- Combine **type, label, color and person** filters. Android keeps the search
  entry visible and exposes color/person filters in its additional filter menu.
- The web toolbar switches **grid/list** and the optional quiet style. Existing
  themes remain available. Android already had its system-color option; it was
  retained rather than rebuilt. Note backgrounds are selected in the editor.

Web keyboard shortcuts, outside inputs and dialogs:

| Key | Action |
| --- | --- |
| `c` / `l` | Capture text / list |
| `j` / `k` | Focus next / previous note |
| `x` | Select the focused note |
| `e` | Archive the focused note for yourself |
| `/` | Focus search |

The existing Ctrl/Cmd shortcuts still work.

## Editors, attachments and widgets

The visual editor formats selected text as H1/H2, bold, italic or underline and
can remove formatting. Existing Markdown and code notes keep their source mode;
switching editor modes preserves the text. Pasted web content is inserted as
plain text. The server stores no editor HTML.

Checklists have stable item IDs and one level of indentation. Move items with
the web drag handle or arrow keys; Tab/Shift+Tab indents/outdents. Android exposes
move/indent actions in each row's menu. Checking or moving a parent includes its
subitems. List settings control completed items at the bottom, the collapsed
completed section and insertion at the top.

Drawings retain editable strokes. Both editors offer pen, eraser and undo;
select an attached image to draw over it. OCR inserts recognized text into the
note and records it for search. Android uses bundled local Latin-script ML Kit
recognition; the server uses Tesseract with English/German by default. Override
`OCR_LANGUAGES` only with installed Tesseract language packs.

Recordings remain attached to the note and can be played again. The optional AI
setting controls transcription; storing and playing audio works without AI.
Uploads, OCR downloads and recording persistence require a connection. Existing
attachment and account-storage limits also apply to recordings.

Android widgets include interactive checklist entries, a collection configured
for pinned notes/all active notes/a label, and quick capture. Widget checkbox
changes use the existing local repository and synchronization queue.

## Offline saves and collaboration

The web client durably queues note creation, text/list/feature updates and note
deletion in IndexedDB, scoped to the signed-in account. Cached views remain
readable while the page is open offline. The status banner shows pending writes
and can download a local JSON copy. Media uploads remain online operations; an
unsuccessful upload keeps its current editor selection for retry.

Reconnection replays writes in order. Creates carry a stable `clientRequestId`,
so replay after a lost response does not create a duplicate. Updates retain
`baseUpdatedAt`: a 409 pauses synchronization and keeps the local content. Open
the note to inspect the conflict using the existing conflict controls. A blocked
change can also be copied out or explicitly discarded in the queue banner.
Logout removes this account's drafts and local cache, including pending writes.
Offline cold-start authentication is not added by this change.

Visible web tabs check collaboration updates every ten seconds. Android keeps
its existing local pending-operation and conflict handling.

## Shared wire format

New clients request `personal=true` for note lists, detail, tree, media responses,
pin/archive actions and exports, and send `personalOrganization:true` with note
updates and label operations. Colors, labels, pin and archive are then stored
per `(userId,noteId)` in `noteorganizations`. A participant's choices do not
change another participant's view. Content, drawings and formatting remain
shared. Deleting, moving and managing sharing remain owner operations.

Legacy API calls retain their previous shared note fields for compatibility;
new API integrations should opt into personal organization as described above.

`features` is additive. Omission preserves it on update. Its shared shape is:

```json
{
  "format": "rich",
  "marks": [{"type":"bold","start":0,"end":5}],
  "background": "grid",
  "drawing": {"width":800,"height":600,"strokes":[
    {"color":"#202124","width":3,"points":[[10,20],[30,40]]}
  ]},
  "ocrText": "Recognized image text",
  "list": {"checkedToBottom":true,"addToTop":false,"collapseCompleted":false}
}
```

Marks use UTF-16 offsets into the exact plain `content`, matching browser and
Kotlin strings. Allowed mark types are `bold`, `italic`, `underline`, `h1`, `h2`.
Backgrounds are `none`, `grid`, `lines`, `dots`, `leaves`, `sand`. An optional
`drawing.imageFilename` references an attachment on the note. Drawings are capped
at 500 strokes/20,000 points and the full feature object at 250,000 JSON characters.
List items retain `{id,text,completed,order,indent}`; `indent` is 0 or 1.

Revisions and Markdown ZIP round trips retain these data. Markdown files include
readable text and optional `keepLocalData` frontmatter for exact restoration;
ZIP imports remap image annotation references to the newly stored filenames.
Audio bytes and their attachment metadata round trip too. Ordinary database
backups include the personal organization collection. Android Room migration
7→8 adds feature JSON and a separate searchable OCR-text column. The sync
signature is versioned as `personal-v1:`: upgrading refetches unchanged notes
once, while retaining the transaction-bound protection for pending local edits.

The public-demo origin repair only admits the packaged demo's exact frontend
origin when `DEMO_MODE=true`. Private installations continue to use their own
allowlist; see [public-demo.md](public-demo.md).
