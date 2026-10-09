# Folio UI foundation

This is the Designer-owned visual system and component layer for Folio. It
follows shared UI/API contract v1 (fields, limits, errors and focus fallback).

## Direction

Folio's library is styled as **one independent publisher's catalogue**. The
interface uses warm paper and ink with a single vermilion accent. Titles are
set in **Newsreader**, an editorial serif with optical sizes. Interface text
uses **Schibsted Grotesk**, a grotesk with newspaper origins. Both fonts are
self-hosted from `public/fonts/` under the SIL Open Font License; the licence
files are in that folder.

- **Signature: the shelf line.** Each cover has its own trim height and
  stands on one continuous hairline, with the caption set below the line.
  *On the desk* is a full-width surface that shows the books being read now,
  in a larger size and with a note excerpt.
- **Covers.** The eight seeded books (ids 1–8) use the original artwork in
  `public/covers/cover-<id>.svg`. That artwork has no lettering: titles and
  authors are typeset live, so the cover stays correct after a book is
  edited. Books with ids above 8 get deterministic generated artwork printed
  from the same inks. Covers keep their print colours in both themes,
  because they represent physical objects.
- **Themes.** `<html data-theme="light|dark">`. The inline head script and
  `initTheme()` apply the stored choice, or follow the system setting when
  nothing is stored. The masthead button switches the theme and saves the
  choice to `localStorage` under the key `folio-theme`.
- **Motion.** There is one authored moment: the sheet enters, sliding in from
  the right on desktop and up from the bottom on phones. Covers also lift
  slightly on hover. `prefers-reduced-motion` removes all of it.

## Files (Designer-owned)

| File | Purpose |
| --- | --- |
| `public/index.html` | Product shell. Loads `app.js`, which is owned by the Builder. |
| `public/styles.css` | Tokens and every component style. |
| `public/components.js` | Components and the interaction contract (ES module). |
| `public/fixtures.js` | `FIXTURE_BOOKS`, which matches the API seed data, and an in-memory `createFixtureSource()`. |
| `public/reference.html` | Working reference page on fixtures, with failure-injection controls. Not linked from the product. |
| `public/covers/`, `public/fonts/`, `public/favicon.svg` | Assets. |

## Integration (for `app.js`)

```js
import { createLibraryView, FolioError, initTheme } from './components.js';

initTheme();
const view = createLibraryView(document.getElementById('folio'), {
  list: ({ q, status }) => …,   // -> Book[]; status is '' (all) or a status value
  create: (draft) => …,         // -> Book (201 body .book)
  update: (id, draft) => …,     // -> Book
  remove: (id) => …,            // -> void (204)
});
view.start();
```

- `draft` is already normalized: title and author are trimmed, and notes are
  passed through literally. It is also validated on the client before it is
  sent.
- On a non-2xx response, reject with
  `FolioError.fromResponse(response.status, parsedBodyOrNull)`. If `fetch`
  itself throws, reject with `FolioError.network(err)`. Any other rejection
  is treated as a network failure.
- The view takes care of everything else: rendering, search debounce (220 ms)
  with protection against stale responses, the status filter, the
  loading, empty, no-match and error states, the sheet, pending locks, drafts,
  retries and focus.
- Also exported: `STATUSES`, `STATUS_LABELS`, `LIMITS`, `countChars` (counts
  Unicode code points through `Array.from`), `normalizeDraft`,
  `validateDraft`, `renderCover`, `setTheme` and `icon`.
- `view.refresh()` reloads the collection with the current query and filter.
  `view.openCreate()` opens the Add sheet. `view.snapshot` returns a read-only
  state for tests.

## Interaction contract as implemented

- **Pending.** While a request is in flight, Save, Add, Delete, Cancel and
  Close have `aria-disabled="true"`. The active button shows a spinner and
  the text "Saving…", "Adding…" or "Deleting…". Text fields become read-only,
  and status changes are blocked. A live note explains why the sheet can't be
  closed yet. Further clicks, Enter presses and Escape presses do not send a
  duplicate request; they repeat the pending explanation instead.
- **Validation (client or 422).** Error messages appear under each affected
  field and the field gets `aria-invalid`. Focus goes to the first invalid
  field. Character counters show code points and turn red past the limit.
  The `maxlength` attribute is deliberately not used, because it counts
  UTF-16 units.
- **Network, 500 or 400 on save.** An alert names the problem and the next
  step, and offers **Try again**. The draft is kept, and focus moves to the
  alert once the controls unlock.
- **404 on save.** The collection refreshes. An alert says the book is no
  longer in the library, keeps the draft, and offers **Save as a new book**
  or **Discard changes**.
- **Delete.** Confirmation happens inline in the sheet footer, and focus
  starts on **Keep it**. If the delete fails, the confirmation stays open with
  an error and focus moves to **Delete book**. A 404 is treated as already
  removed, and a toast says so.
- **Drafts.** If the editor is closed with unsaved changes, the draft is kept
  per book (or for "new"). It comes back the next time that editor opens,
  with a "Discard them" option.
- **Focus.** When the sheet opens, focus goes to the title field (editor) or
  the heading (detail). Tab is trapped inside the sheet. Escape closes the
  sheet when that is safe, and cancels the delete confirmation first if it is
  showing. Clicking the backdrop also closes the sheet. When the sheet
  closes, focus returns to the button that opened it. If that book is gone,
  focus moves to the next surviving book in the previous order, then the
  previous one, then **Add a book**.
- **Toasts.** Toasts appear in a polite live region. That region is a manual
  popover, so it stays visible above the modal sheet.
- **Literal text.** All user text is inserted with `textContent`. Notes are
  shown with `white-space: pre-wrap` in the detail view.

## Reference evidence

The reference page is `public/reference.html`. Append `?latency=<ms>`,
`&empty` or `&failload` to the URL to set up a scenario. The fixture panel at
the bottom right injects save and delete failures, a deletion from another
window, slow responses and an empty library.

Representative captures are in this folder:

- `desktop-light.png` (1440)
- `desktop-dark-detail.png`
- `desktop-light-save-failed.png`
- `phone-light.png` (390)
- `phone-dark-detail.png`

The tablet layout (820) and the empty, no-match, load-error and loading
states were inspected but not saved.
