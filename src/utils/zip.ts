const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

export function buildZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nb = enc.encode(entry.name);
    const { time, date } = dosDateTime();
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + nb.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true);
    l.setUint16(6, 0, true); l.setUint16(8, 0, true);
    l.setUint16(10, time, true); l.setUint16(12, date, true);
    l.setUint32(14, crc, true); l.setUint32(18, entry.data.length, true);
    l.setUint32(22, entry.data.length, true); l.setUint16(26, nb.length, true);
    l.setUint16(28, 0, true); local.set(nb, 30);
    locals.push(local, entry.data);

    const central = new Uint8Array(46 + nb.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true);
    c.setUint16(6, 20, true); c.setUint16(8, 0, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, entry.data.length, true);
    c.setUint32(24, entry.data.length, true); c.setUint16(28, nb.length, true);
    c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true);
    c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    central.set(nb, 46);
    centrals.push(central);
    offset += local.length + entry.data.length;
  }

  const cd = concatBytes(centrals);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
  e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, cd.length, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);

  return concatBytes([...locals, cd, end]);
}
