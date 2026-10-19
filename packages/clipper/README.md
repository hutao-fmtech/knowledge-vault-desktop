# @kvd/clipper

Pure helpers + Node write path for the Chrome/Edge browser clipper (`apps/clipper`).

Clips land only under vault-relative `01-收件箱/`. The extension talks to disk via the **File System Access API** (persisted directory handle) so clips are not lost when the desktop app is closed — see `apps/clipper/README.md`.
