// Builds the EPUB file list. Every translated paragraph is followed by its original:
//   <p class="tr" lang="de">Übersetzung</p><p>Original</p>
//
// EPUB = a ZIP containing: mimetype, META-INF/container.xml, an OPF "packing list"
// (content.opf), a table of contents (nav.xhtml + toc.ncx) and one XHTML file per chapter.

import { escapeXml as esc } from './parse.js';
import { makeZip } from './zip.js';

const CSS = `
body { line-height: 1.4; }
h1, h2, h3, h4 { text-align: center; page-break-after: avoid; }
h2.chapter-title { margin-bottom: 0.3em; }
p { margin: 0 0 0.6em 0; text-indent: 0; }
p.center { text-align: center; }
p.quote { margin-left: 1.5em; }
/* German paragraph sits close to its English original, which has a thin rule,
   is slightly smaller, and is followed by a bigger gap before the next pair */
p.tr { margin-bottom: 0.3em; }
p.orig { font-size: 0.9em; margin-bottom: 1.3em; padding-left: 0.7em; border-left: 2px solid #999; }
p.orig.center { padding-left: 0; border-left: 0; }  /* no rule on centered lines */
hr { margin: 1.5em 30%; }
dl.tags dt { font-weight: bold; margin-top: 0.4em; }
dl.tags dd { margin: 0; }
.byline, .note { text-align: center; }
.note { font-size: 0.9em; }
`;

const page = (title, body, lang = 'en') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;

/** One block: the translation first (if it has one), then the original. */
function renderBlock(b, lang) {
  if (b.type === 'hr') return '<hr/>';
  const tag = b.tag;
  const cls = [b.center && 'center', b.quote && 'quote'].filter(Boolean).join(' ');

  const origCls = [cls, b.tr && 'orig'].filter(Boolean).join(' ');
  const original = `<${tag}${origCls ? ` class="${origCls}"` : ''}>${b.html}</${tag}>`;
  if (!b.tr) return original;

  const translated = esc(b.tr).replace(/\n/g, '<br/>');
  const german = `<${tag} class="tr${cls ? ' ' + cls : ''}" lang="${lang.code}" xml:lang="${lang.code}">${translated}</${tag}>`;
  return german + '\n' + original;
}

const renderBlocks = (blocks, lang) => blocks.map((b) => renderBlock(b, lang)).join('\n');

function titleBlock(text, tr, lang) {
  return (tr ? `\n<p class="tr center" lang="${lang.code}" xml:lang="${lang.code}">${esc(tr)}</p>` : '') + `<h2 class="chapter-title">${esc(text)}</h2>`;
}

/**
 * book:     result of parseAo3(), but with `.tr` filled in on blocks
 * chapters: the chosen chapters (each with `.titleTr` and blocks with `.tr`)
 * lang:     { code: 'de', name: 'German' }
 */
export function buildEpub(book, chapters, lang) {
  const uid = 'urn:uuid:' + crypto.randomUUID();
  const bookTitle = `${book.title} (${lang.name} / English)`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // --- front page ---
  const tagList = book.tags.map((t) => `<dt>${esc(t.label)}</dt><dd>${esc(t.value)}</dd>`).join('\n');
  const front = page(book.title, `
<h1>${esc(book.title)}</h1>
<p class="byline">by ${esc(book.author)}</p>
<p class="note">Bilingual edition: each English paragraph is followed by an <em>automatic ${esc(lang.name)} translation</em>
(Chrome's on-device translator). The translation can contain mistakes, so trust the English if they disagree.</p>
${book.sourceUrl ? `<p class="note">Original: ${esc(book.sourceUrl)}</p>` : ''}
${book.summary.length ? `<h3>Summary</h3>\n${renderBlocks(book.summary, lang)}` : ''}
<dl class="tags">
${tagList}
</dl>`);

  // --- chapters ---
  const chapterFiles = chapters.map((ch, i) => ({
    id: `ch${i + 1}`,
    href: `chapter-${i + 1}.xhtml`,
    title: ch.title,
    xhtml: page(ch.title, `${titleBlock(ch.title, ch.titleTr, lang)}\n${renderBlocks(ch.blocks, lang)}`),
  }));

  // --- table of contents (EPUB 3 nav + EPUB 2 ncx for older readers) ---
  const nav = page('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
<li><a href="front.xhtml">Title page</a></li>
${chapterFiles.map((c) => `<li><a href="${c.href}">${esc(c.title)}</a></li>`).join('\n')}
</ol></nav>`);

  const navPoints = [{ href: 'front.xhtml', title: 'Title page' }, ...chapterFiles]
    .map((c, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="${c.href}"/></navPoint>`)
    .join('\n');
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uid}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${esc(bookTitle)}</text></docTitle>
<navMap>
${navPoints}
</navMap>
</ncx>
`;

  // --- package document ---
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uid}</dc:identifier>
<dc:title>${esc(bookTitle)}</dc:title>
<dc:creator>${esc(book.author || 'Unknown')}</dc:creator>
<dc:language>en</dc:language>
<dc:language>${lang.code}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="front" href="front.xhtml" media-type="application/xhtml+xml"/>
${chapterFiles.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx">
<itemref idref="front"/>
${chapterFiles.map((c) => `<itemref idref="${c.id}"/>`).join('\n')}
</spine>
</package>
`;

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

  // `mimetype` must be the FIRST entry in the zip.
  return makeZip([
    { path: 'mimetype', data: 'application/epub+zip' },
    { path: 'META-INF/container.xml', data: container },
    { path: 'OEBPS/content.opf', data: opf },
    { path: 'OEBPS/nav.xhtml', data: nav },
    { path: 'OEBPS/toc.ncx', data: ncx },
    { path: 'OEBPS/style.css', data: CSS },
    { path: 'OEBPS/front.xhtml', data: front },
    ...chapterFiles.map((c) => ({ path: `OEBPS/${c.href}`, data: c.xhtml })),
  ], 'application/epub+zip');
}
