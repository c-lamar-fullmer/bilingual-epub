// A tiny ZIP writer (no compression, "stored" method). EPUB is just a ZIP file
// with a specific layout, and stored entries are valid, so we don't need a library.

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ path: 'a/b.txt', data: string | Uint8Array }] -> Blob. Order is preserved. */
export function makeZip(files, mimeType = 'application/zip') {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const parts = [];      // local headers + data
  const central = [];    // central directory entries
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.path);
    const data = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header signature
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // flags: UTF-8 names
    local.setUint16(8, 0, true);            // method 0 = stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);           // no extra field
    parts.push(new Uint8Array(local.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);      // central directory signature
    cd.setUint16(4, 20, true);              // version made by
    cd.setUint16(6, 20, true);              // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);         // where the local header starts
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const cdSize = central.reduce((sum, p) => sum + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: mimeType });
}
