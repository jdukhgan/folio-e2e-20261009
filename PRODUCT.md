# Folio — a library worth coming back to

## Product
A small personal reading library for someone who cares about books and visual culture. The first screen should make it pleasant to scan a collection, see what is being read, and open or add a book. Build a useful application, not a marketing landing page. No accounts, external APIs, payments, collaboration or uploads.

## Visual ambition
Aim for the craft of a contemporary independent cultural publication combined with the responsiveness of a premium native app. Distinctive composition, confident typography, beautiful content treatment and restrained, purposeful motion. It should feel authored, not like a generic admin dashboard. Do not interpret modern as gratuitous gradients, glass, neon or a wall of identical rounded cards.

No existing design system is supplied. The UI Designer chooses ONE coherent visual direction autonomously, creates a compact token/component foundation and IMPLEMENTS the actual UI components and representative working screen. Use the installed Impeccable craft guidance. If native Design is already available and authorized, use it; otherwise use the approved local implementation path without waiting for new consent. Do not stop at design.md or ask the user to choose concepts.

A cover-led collection is a useful starting point: original typographic/abstract SVG or CSS cover art for eight credible fictional books, varied yet art-directed as one collection. No image service, copyrighted covers or decorative stock photos required. Give content an intentional rhythm and distinguish the main action from secondary tools. Build a considered detail/edit experience; do not leave a large permanent form competing with the library. Choose the details rather than mechanically copying this suggestion. Keep all existing design choices coherent in light and dark themes.

Inspect desktop, tablet and phone. Good taste includes readable contrast, touch targets, keyboard focus, empty/error/loading states, reduced motion and usable small screens. Beauty cannot excuse broken behavior. Use a small set of meaningful assets/details exceptionally well; no decorative feature expansion.

## Functional scope and acceptance
- Store books in SQLite: title (required, max160), author (required, max120), reading status (Want to read / Reading / Finished), notes (max4000). Treat notes as literal text.
- Create, view, edit and delete books, search title/author and filter by status. Seed eight fictional books once, never duplicate or reset user edits on restart.
- Persist data across application restarts outside transient checkout/build output.
- Prevent duplicate mutations while pending. Show actionable failures and preserve drafts. Return keyboard focus sensibly after dialogs and deletion. Handle stale/missing records and invalid data predictably.
- Responsive light/dark themes, meaningful empty and no-match states, and no horizontal page overflow.
- Use the simplest maintainable stack that can deliver the visual quality. No unnecessary framework/services.
- A documented one-command local run and persistent unprivileged preview service. Keep runtime data and secrets out of Git.

## Team delivery
Lead creates 3–5 meaningful visible delivery cards plus the kickoff coordinator, with native workflow inheritance and explicit dependencies. Designer owns implemented UI foundations; Builder owns end-to-end integration, including frontend and backend. API work can proceed independently after the small shared field/error contract is agreed; integrated UI waits for the Designer's implementation.

Use the configured workflow and roles. Reviewer checks code/data correctness; Verifier tests the integrated running app and owns the browser evidence matrix. Reuse current evidence with revision and URLs; repeat only affected checks after a fix. Designer accepts final visual fidelity at Lead acceptance. No duplicate review loops or new session solely for a status update. Do not skip meaningful checks to hit a time target.

Publish accepted source to this public repository, excluding private infrastructure details, credentials, transcripts and runtime databases. Deliver the working preview URL, concise test results, representative final desktop/mobile screenshots in both themes and any real limitations. The final app remains running for inspection.
