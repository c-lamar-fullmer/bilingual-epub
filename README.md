# Bilingual EPUB Maker

Upload an AO3 "HTML" download, pick chapters and a language, get an EPUB where every English paragraph is followed by its translation. 100% client-side: no server, no API keys.

## Run locally
Chrome's Translator API needs desktop Chrome 138+ and https or localhost:

    python -m http.server 8000      # then open http://localhost:8000

## Host free (GitHub Pages)
Push this folder to a GitHub repo -> Settings -> Pages -> deploy from the `main` branch root.

## How it works
| File | Job |
|---|---|
| `js/parse.js` | DOMParser reads the AO3 HTML -> metadata, chapters, paragraph blocks (empty spacer paragraphs dropped, italics kept) |
| `js/translate.js` | Chrome's on-device Translator API, long paragraphs split at sentence ends |
| `js/cache.js` | IndexedDB cache so finished paragraphs are never translated twice |
| `js/epub.js` | Builds the EPUB files (XHTML per chapter, nav/ncx, OPF) with original + translated paragraphs alternating |
| `js/zip.js` | ~60-line ZIP writer (EPUB is a ZIP), so no libraries are needed |
| `js/app.js` | The UI and the glue |

Add a language: append `{ code, name }` to `LANGUAGES` in `js/translate.js`.
