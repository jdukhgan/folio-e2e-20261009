# Folio UI foundation

This is the Designer-owned visual system and component layer for Folio. It
follows shared UI/API contract v2 (fields, limits, errors, focus fallback,
direct status change and result announcements).

## Direction

Folio's library is styled as **one independent publisher's catalogue**. The
interface uses warm paper and ink with a single vermilion accent. Titles are
set in **Newsreader**, an editorial serif with optical sizes. Interface text
uses **Schibsted Grotesk**, a grotesk with newspaper origins. Both fonts are
self-hosted from `public/fonts/` under the SIL Open Font License; the licence
files are in that folder.

- **Signature: the shelf line.** Each cover has its own trim height and
  stands on one continuous hairline, with the caption set below the line.
- **Composition (refinement v2): a library with a reading rail.** One compact
  masthead bar holds the wordmark, search, status filter, theme and **Add a
  book**; it is sticky from tablet width up. Below it, *On the desk* (books
  being read, each with its note excerpt) is a tinted rail beside the shelf on
  screens 64rem and wider, so a 1280×720 window shows the desk, the full first
  row of the shelf and the start of the second. From 40rem to 64rem the desk
  spans the page and sets its books side by side. On phones everything stacks.
- **Reading filter = reading journal.** Filtering by *Reading* does not shrink
  the desk into two small shelf covers. It shows the same desk entries in a
  two-column journal with larger covers and up to nine lines of notes (one
  column on phones). Other filters and searches use the shelf.
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

### How the v2 direction was chosen

- **Reference inspected:** Fitzcarraldo Editions' home page
  (fitzcarraldoeditions.com, viewed 2026-10-09 at 1280×720). Two principles
  were kept. First, one serif voice and a hairline header carry the whole
  identity, with no decoration. Second, captions read as running sentences,
  with titles in italic. One lesson was rejected: its full-bleed hero pushes
  the catalogue below the first viewport, which is wrong for a working
  library. literal.club (403 bot challenge) and mubi.com (503) could not be
  viewed, so they were not used as references. The installed Impeccable *craft
  floor* and *Operate* guidance were the second reference: standard controls,
  the world limited to type, palette, density and one signature move.
- **Alternatives sketched:** (A) a reading rail beside the shelf, and (B) the
  existing full-width desk compressed into a short band above the shelf. A
  was chosen. It puts the whole collection in the first view without
  shrinking the reading notes, and the rail turns naturally into the tablet
  and journal layouts. B still pushed the shelf to the fold at 720px and kept
  the tablet half-empty.
- **Weakest major state fixed in one batch:** after the layout change, the
  weakest state was the detail sheet at 1280×720. A 12rem cover pushed the new
  status switch and the notes below the fold. The batch set the cover to
  8.5rem (6.5rem on phones), tightened the head and body spacing, removed the
  duplicate status tag, stopped status labels wrapping on phones, gave the
  dark desk rail its own lifted token (`--desk`), and added
  `scroll-padding-top` so a book focused after the sheet closes is not hidden
  behind the sticky masthead.

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
  state for tests: `{ books, query, status, sheet, bookId, pending }`.
- No new source method is needed for v2. The detail status change calls
  `source.update(id, { title, author, status, notes })` with the last
  committed title, author and notes, sent unchanged.

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
- **Direct status change (detail).** Under the title, *Reading status* is a
  group of three toggle buttons (`aria-pressed`). Toggle buttons are used
  instead of radios so that arrow keys never send a request. Choosing a
  different status calls `source.update` with the committed fields. While the
  request is pending, the chosen button shows a spinner. The pressed button
  stays on the committed status until the library confirms the change. All
  status buttons, Edit and Delete have `aria-disabled="true"`, and the footer
  live note says “Moving “Title” to Finished…”. Repeated clicks, Escape and
  Close repeat that explanation and send nothing. On success, the collection
  refreshes, the new status becomes pressed and keeps focus, and a toast
  confirms the change. If the book has left the active filter, it disappears
  from the list, and closing uses the focus fallback below.
  - **Network, 500, 400 or 422:** the controls unlock, then focus moves to an
    alert under the switch that says the status is unchanged. It offers
    **Try “Finished” again**, which retries the chosen status.
  - **404:** the collection refreshes before the controls unlock. The alert
    says the book is no longer in the library and that nothing was changed,
    and it offers **Close**. Status, Edit and Delete stay disabled, and the
    book is never recreated.
- **Result announcements.** A visually hidden `role="status"` paragraph
  (`[data-role="results-announcer"]`) speaks one concise summary after a
  search, filter, **Clear search** or **Show all statuses** response arrives,
  for example “2 books marked Reading.”, “4 books matching “the”.” or
  “No books match “zzz”.”. It only speaks for the response that is still
  current: superseded responses, refreshes after mutations and the first load
  never announce. Failed reloads use the existing alert banner instead.
  **Show all statuses** now returns focus to the *All* filter.
- **Toasts.** Toasts appear in a polite live region. That region is a manual
  popover, so it stays visible above the modal sheet.
- **Literal text.** All user text is inserted with `textContent`. Notes are
  shown with `white-space: pre-wrap` in the detail view.

## Reference evidence

The reference page is `public/reference.html`. Append `?latency=<ms>`,
`&empty` or `&failload` to the URL to set up a scenario. Use the fixture panel
at the bottom right before opening a sheet, because the modal sheet makes it
inert. It can inject save, status-change and delete failures, delete book #4
from another window (open #4 afterwards to see the status or save 404), slow
down responses and empty the library. `window.folioReference.source.controls`
offers the same controls for scripted checks.

| Fixture | Expected behaviour |
| --- | --- |
| *Next status change: network / 500* | Chosen button shows progress, committed button stays pressed; on failure, focus moves to the alert after the controls unlock, and **Try “…” again** succeeds |
| *Delete #4 elsewhere*, then change #4's status | Collection refreshes, missing-book alert gets focus, mutations stay locked, **Close** moves focus to the next surviving book |
| *Slow (2.5s)* plus extra status clicks | No second request; the pending note repeats |

Foundation captures (fixtures, css px), in this folder:

- `desktop-light.png` (1280×720, all books)
- `desktop-light-reading.png` (1280×720, Reading journal)
- `desktop-light-status-failed.png` (status change failed, retry focused)
- `desktop-dark-detail.png` (1280×720)
- `tablet-light.png` (820×1180)
- `phone-light.png` (390×844)
- `phone-dark-reading.png` (390×844)

The following were also inspected but not saved: the tablet Reading journal,
the phone detail sheet in light, the dark search and no-match states, the
empty library, the Add editor, the pending status change, and the 404 lock.
None of the 1280, 820 and 390 views overflowed horizontally. These captures
are foundation evidence only. Integrated browser acceptance belongs to the
Verifier.
