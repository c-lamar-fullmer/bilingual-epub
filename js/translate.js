// Wraps Chrome's built-in Translator API (runs on-device: free, no key, no content filter).
// https://developer.chrome.com/docs/ai/translator-api

import { getCached, putCached } from './cache.js';

export const LANGUAGES = [
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
];

export const apiSupported = () => 'Translator' in self;

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' */
export async function checkAvailability(code) {
  return Translator.availability({ sourceLanguage: 'en', targetLanguage: code });
}

/** Creates the translator. Must be called from a click handler the first time (model download needs a user gesture). */
export function createTranslator(code, onDownload) {
  return Translator.create({
    sourceLanguage: 'en',
    targetLanguage: code,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onDownload?.(e.loaded));
    },
  });
}

// The model handles a few thousand characters at a time, so split very long paragraphs at sentence ends.
const MAX_CHUNK = 1500;
function chunk(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["”’')\]]*\s*|$)/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length > MAX_CHUNK) { chunks.push(current); current = ''; }
    current += s;
    while (current.length > MAX_CHUNK * 2) { chunks.push(current.slice(0, MAX_CHUNK)); current = current.slice(MAX_CHUNK); } // no punctuation at all
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Translates one paragraph. Returns { text, cached } or { text: null } if it has no letters
 * (like "* * *") or the translator failed twice.
 */
export async function translateText(translator, code, text) {
  if (!/\p{L}/u.test(text)) return { text: null, cached: true }; // nothing to translate
  const hit = await getCached(code, text);
  if (hit) return { text: hit, cached: true };

  try {
    const lines = [];
    for (const line of text.split('\n')) {            // keep <br> line breaks (poems, epigraphs)
      const pieces = [];
      for (const c of chunk(line)) pieces.push(await translateWithRetry(translator, c));
      lines.push(pieces.join(' ').trim());
    }
    const result = lines.join('\n');
    await putCached(code, text, result);
    return { text: result, cached: false };
  } catch (err) {
    console.warn('Translation failed for a paragraph:', err);
    return { text: null, cached: false, failed: true };
  }
}

async function translateWithRetry(translator, text) {
  if (!/\p{L}/u.test(text)) return text;
  try {
    return await translator.translate(text);
  } catch {
    return await translator.translate(text); // one retry
  }
}
