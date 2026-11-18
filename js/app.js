// The UI: load file -> pick chapters -> translate -> build EPUB -> download.
import { parseAo3 } from './parse.js';
import { buildEpub } from './epub.js';
import { LANGUAGES, apiSupported, checkAvailability, createTranslator, translateText } from './translate.js';
import { clearCache } from './cache.js';

const $ = (id) => document.getElementById(id);
const CHARS_PER_SEC = 3000; // measured with the test page; only used for the estimate
let book = null;
let cancelled = false;
let downloadUrl = null;

const fmtTime = (sec) => (sec < 90 ? `${Math.round(sec)} sec` : `${Math.round(sec / 60)} min`);
const fmtNum = (n) => n.toLocaleString('en-US');
const currentLang = () => LANGUAGES.find((l) => l.code === $('lang').value);

// ---------- setup ----------
for (const l of LANGUAGES) $('lang').add(new Option(l.name, l.code));
if (!apiSupported()) $('unsupported').hidden = false;

// ---------- step 1: load the file ----------
async function loadFile(file) {
  if (!file) return;
  try {
    book = parseAo3(await file.text());
  } catch (err) {
    alert('Could not read that file: ' + err.message);
    return;
  }
  if (!book.chapters.some((c) => c.chars > 0)) {
    alert("I couldn't find any story text in that file. Is it an AO3 HTML download?");
    book = null;
    return;
  }
  showBook();
}

$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop').classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});

// ---------- step 2: chapter picker ----------
function showBook() {
  $('work-title').textContent = book.title;
  $('work-author').textContent = book.author ? 'by ' + book.author : '';
  const list = $('chapters');
  list.innerHTML = '';
  book.chapters.forEach((ch, i) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.index = i;
    const name = document.createElement('span');
    name.textContent = ch.title;
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = fmtNum(ch.chars) + ' chars';
    label.append(box, name, size);
    li.append(label);
    list.append(li);
  });
  $('step-options').hidden = false;
  $('step-run').hidden = false;
  $('result').hidden = true;
  updateTotals();
  updateLangStatus();
}

const checkboxes = () => [...$('chapters').querySelectorAll('input')];
const selectedChapters = () => checkboxes().filter((b) => b.checked).map((b) => book.chapters[b.dataset.index]);

function updateTotals() {
  const chosen = selectedChapters();
  const chars = chosen.reduce((n, c) => n + c.chars, 0);
  $('totals').textContent = `${chosen.length} of ${book.chapters.length} chapters · ${fmtNum(chars)} characters · about ${fmtTime(chars / CHARS_PER_SEC)} to translate`;
  $('go').disabled = !apiSupported() || chosen.length === 0;
}
$('chapters').addEventListener('change', updateTotals);
$('all').addEventListener('click', () => { checkboxes().forEach((b) => (b.checked = true)); updateTotals(); });
$('none').addEventListener('click', () => { checkboxes().forEach((b) => (b.checked = false)); updateTotals(); });

async function updateLangStatus() {
  if (!apiSupported()) return;
  const lang = currentLang();
  const el = $('lang-status');
  el.textContent = 'checking...';
  try {
    const a = await checkAvailability(lang.code);
    if (lang !== currentLang()) return; // user switched meanwhile
    el.textContent = {
      available: 'ready',
      downloadable: 'will download a small language pack on first use',
      downloading: 'language pack is downloading',
      unavailable: 'not supported by this browser',
    }[a] || a;
  } catch (err) {
    el.textContent = 'could not check (' + err.message + ')';
  }
}
$('lang').addEventListener('change', updateLangStatus);

// ---------- step 3: translate + build ----------
function setBusy(busy) {
  $('go').disabled = busy;
  $('cancel').hidden = !busy;
  $('bar').hidden = !busy;
  $('lang').disabled = busy;
  $('file').disabled = busy;
  checkboxes().forEach((b) => (b.disabled = busy));
}

$('cancel').addEventListener('click', () => { cancelled = true; });

$('go').addEventListener('click', async () => {
  const lang = currentLang();
  const chapters = selectedChapters();
  cancelled = false;
  $('result').hidden = true;
  setBusy(true);

  try {
    $('status').textContent = 'Starting the translator...';
    const translator = await createTranslator(lang.code, (loaded) => {
      $('status').textContent = `Downloading ${lang.name} language pack: ${Math.round(loaded * 100)}%`;
    });

    // Everything that needs translating, in book order. Each item gets a `.tr` field filled in.
    const items = [];
    for (const b of book.summary) items.push(b);
    for (const ch of chapters) {
      items.push({ text: ch.title, set: (t) => (ch.titleTr = t) });
      for (const b of ch.blocks) if (b.text) items.push(b);
    }
    const totalChars = items.reduce((n, it) => n + it.text.length, 0);

    let doneChars = 0, workedChars = 0, failed = 0;
    const started = performance.now();
    $('bar').max = totalChars;
    let lastPaint = 0;

    for (const item of items) {
      if (cancelled) break;
      const r = await translateText(translator, lang.code, item.text);
      if (r.failed) failed++;
      if (item.set) item.set(r.text); else item.tr = r.text;
      doneChars += item.text.length;
      if (!r.cached) workedChars += item.text.length;

      const now = performance.now();
      if (now - lastPaint > 150) { // don't repaint on every paragraph
        lastPaint = now;
        $('bar').value = doneChars;
        const rate = workedChars / ((now - started) / 1000);
        const eta = rate > 0 ? (totalChars - doneChars) / rate : 0;
        $('status').textContent = `Translated ${fmtNum(doneChars)} of ${fmtNum(totalChars)} characters` +
          (eta > 5 ? ` · about ${fmtTime(eta)} left` : '');
      }
    }
    translator.destroy?.();

    if (cancelled) {
      $('status').textContent = 'Cancelled. Finished paragraphs are remembered, so you can start again without losing them.';
      return;
    }

    $('status').textContent = 'Building the EPUB...';
    await new Promise((r) => setTimeout(r)); // let the browser repaint
    const blob = buildEpub(book, chapters, lang);

    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    const slug = book.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'book';
    $('download').href = downloadUrl;
    $('download').download = `${slug}-en-${lang.code}.epub`;
    $('result').hidden = false;
    $('status').textContent = `Done (${(blob.size / 1e6).toFixed(1)} MB).` +
      (failed ? ` ${failed} paragraph(s) could not be translated and appear in English only.` : '');
  } catch (err) {
    console.error(err);
    $('status').textContent = `Error: ${err.name}: ${err.message}`;
  } finally {
    setBusy(false);
    updateTotals();
  }
});

$('clear').addEventListener('click', async () => {
  const ok = await clearCache();
  $('clear-msg').textContent = ok 
    ? '✓ All remembered translations cleared.' 
    : 'Could not clear them (browser storage unavailable).';
  setTimeout(() => { $('clear-msg').textContent = ''; }, 5000); // hide it after 5 seconds
});
