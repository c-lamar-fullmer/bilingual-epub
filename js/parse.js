// Turns an AO3 "Download > HTML" file into plain JavaScript objects:
//
//   { title, author, sourceUrl, tags: [{label, value}], summary: [block],
//     chapters: [{ title, blocks: [block], chars }] }
//
// A "block" is one paragraph-like thing:
//   { type: 'p' | 'h' | 'hr', tag, html, text, center, quote }
// `html` keeps simple formatting (italics etc.) for the original text,
// `text` is the plain text that gets sent to the translator.

const INLINE_TAGS = { em: 'em', i: 'em', strong: 'strong', b: 'strong', u: 'u', s: 's', strike: 's', del: 's', sub: 'sub', sup: 'sup' };
const BLOCK_TAGS = new Set(['p', 'div', 'blockquote', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'hr', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// XML does not allow most control characters; strip them so the EPUB stays valid.
const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
export const escapeXml = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Collapse the source file's formatting whitespace (and non-breaking spaces) into single spaces.
const squash = (s) => s.replace(/[ \t\r\n ]+/g, ' ');

/** Plain text of a node, <br> becomes a newline. */
function textOf(node) {
  if (node.nodeType === Node.TEXT_NODE) return squash(node.data);
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.tagName === 'BR') return '\n';
  return [...node.childNodes].map(textOf).join('');
}
const tidyText = (s) => s.replace(/ *\n */g, '\n').trim();

/** Safe XHTML for a node's contents: only a few formatting tags survive, links become plain text. */
function htmlOf(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeXml(squash(node.data));
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '<br/>';
  const inner = [...node.childNodes].map(htmlOf).join('');
  return INLINE_TAGS[tag] ? `<${INLINE_TAGS[tag]}>${inner}</${INLINE_TAGS[tag]}>` : inner;
}
const tidyHtml = (s) => s.replace(/ *<br\/> */g, '<br/>').trim();

function makeBlock(el, tag, quote) {
  const text = tidyText(textOf(el));
  if (!text) return null; // skips AO3's empty <p>&nbsp;</p> spacers
  const style = (el.getAttribute('style') || '').replace(/\s/g, '');
  return {
    type: /^h\d$/.test(tag) ? 'h' : 'p',
    tag: /^h\d$/.test(tag) ? tag : 'p',
    html: tidyHtml(htmlOf(el)),
    text,
    center: el.getAttribute('align') === 'center' || style.includes('text-align:center'),
    quote,
  };
}

/** Walks a container and returns its paragraph blocks in reading order. */
export function extractBlocks(root, quote = false, out = []) {
  for (const el of root.children) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'hr') out.push({ type: 'hr' });
    else if (tag === 'p' || tag === 'pre' || /^h[1-6]$/.test(tag)) {
      const b = makeBlock(el, tag === 'pre' ? 'p' : tag, quote);
      if (b) out.push(b);
    } else if (tag === 'blockquote') extractBlocks(el, true, out);
    else if (BLOCK_TAGS.has(tag) || el.querySelector('p')) {
      // A container (div, list, table...). If it holds block children, go inside; otherwise it IS a paragraph.
      if ([...el.children].some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()))) extractBlocks(el, quote, out);
      else {
        const b = makeBlock(el, 'p', quote);
        if (b) out.push(b);
      }
    }
  }
  return out;
}

const oneLine = (el) => tidyText(textOf(el)).replace(/\s+/g, ' ');
const countChars = (blocks) => blocks.reduce((n, b) => n + (b.text ? b.text.length : 0), 0);

/** Blocks from "Summary"/"Notes" style blockquotes, each preceded by a small label paragraph. */
function notesFrom(container) {
  const out = [];
  for (const bq of container.querySelectorAll('blockquote.userstuff')) {
    const label = bq.previousElementSibling ? oneLine(bq.previousElementSibling) : '';
    out.push({ label, blocks: extractBlocks(bq) });
  }
  return out;
}

export function parseAo3(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');

  const preface = doc.querySelector('#preface');
  const meta = preface?.querySelector('.meta');
  const title = (meta?.querySelector('h1') && oneLine(meta.querySelector('h1'))) || doc.title || 'Untitled';
  const author = meta?.querySelector('.byline') ? oneLine(meta.querySelector('.byline')).replace(/^by\s+/i, '') : '';

  const links = [...(preface?.querySelectorAll('p.message a') ?? [])].map((a) => a.href).filter((h) => /\/works\//.test(h));
  const sourceUrl = links[links.length - 1] || '';

  const skip = new Set(['Language', 'Stats']);
  const tags = [];
  for (const dt of meta?.querySelectorAll('dl.tags > dt') ?? []) {
    const label = oneLine(dt).replace(/:$/, '');
    const dd = dt.nextElementSibling;
    if (dd && !skip.has(label)) tags.push({ label, value: oneLine(dd) });
  }

  const summary = meta ? notesFrom(meta).flatMap((n) => n.blocks) : [];

  // Chapters: each one starts with <div class="meta group"><h2 class="heading">, and its text follows.
  const chapters = [];
  const root = doc.querySelector('#chapters') || doc.body;
  const groups = [...root.querySelectorAll('div.meta.group')];

  if (groups.length) {
    for (const group of groups) {
      const heading = group.querySelector('h2.heading');
      const chapter = { title: heading ? oneLine(heading) : `Chapter ${chapters.length + 1}`, blocks: [] };

      for (const note of notesFrom(group)) {
        if (note.label) chapter.blocks.push({ type: 'h', tag: 'h4', html: escapeXml(note.label), text: '', label: true });
        chapter.blocks.push(...note.blocks);
      }
      for (let el = group.nextElementSibling; el && !el.matches('div.meta.group'); el = el.nextElementSibling) {
        if (el.matches('div.userstuff')) chapter.blocks.push(...extractBlocks(el));
        else for (const note of notesFrom(el)) {           // end notes
          if (note.label) chapter.blocks.push({ type: 'h', tag: 'h4', html: escapeXml(note.label), text: '', label: true });
          chapter.blocks.push(...note.blocks);
        }
      }
      chapters.push(chapter);
    }
  } else {
    // One-chapter works have no chapter headings.
    const body = root.querySelector('div.userstuff') || root;
    chapters.push({ title, blocks: extractBlocks(body) });
  }

  for (const ch of chapters) ch.chars = countChars(ch.blocks);
  return { title, author, sourceUrl, tags, summary, chapters };
}
