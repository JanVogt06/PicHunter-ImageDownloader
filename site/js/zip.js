const Zip = (() => {
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  /**
   * Computes the CRC-32 checksum of a byte array as required by the ZIP format.
   *
   * @param {Uint8Array} bytes Raw data to checksum.
   * @returns {number} Unsigned 32 bit checksum.
   */
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Converts a JavaScript date into the packed MS-DOS date and time pair
   * used by ZIP headers.
   *
   * @param {Date} date Timestamp to convert.
   * @returns {{time: number, date: number}} Packed 16 bit values.
   */
  function dosTimestamp(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  /**
   * Writes a little endian unsigned integer into a byte array.
   *
   * @param {Uint8Array} target Buffer to write into.
   * @param {number} offset Byte offset of the first byte.
   * @param {number} value Value to encode.
   * @param {number} size Number of bytes to write (2 or 4).
   */
  function writeUint(target, offset, value, size) {
    for (let i = 0; i < size; i += 1) {
      target[offset + i] = (value >>> (i * 8)) & 0xff;
    }
  }

  /**
   * Builds a store-only ZIP archive from a flat list of entries. Directory
   * entries are derived from the slashes inside the entry names.
   *
   * @param {Array<{name: string, data: Uint8Array}>} entries Files to archive.
   * @param {Date} [modified] Timestamp stored for every entry.
   * @returns {Blob} The finished archive.
   */
  function create(entries, modified) {
    const stamp = dosTimestamp(modified || new Date());
    const encoder = new TextEncoder();
    const records = [];
    const seenDirectories = new Set();

    entries.forEach((entry) => {
      const segments = entry.name.split('/');
      segments.pop();
      let prefix = '';
      segments.forEach((segment) => {
        prefix += `${segment}/`;
        if (!seenDirectories.has(prefix)) {
          seenDirectories.add(prefix);
          records.push({ name: prefix, data: new Uint8Array(0), directory: true });
        }
      });
      records.push({ name: entry.name, data: entry.data, directory: false });
    });

    const chunks = [];
    const central = [];
    let offset = 0;

    records.forEach((record) => {
      const name = encoder.encode(record.name);
      const checksum = crc32(record.data);
      const header = new Uint8Array(30 + name.length);
      writeUint(header, 0, 0x04034b50, 4);
      writeUint(header, 4, 20, 2);
      writeUint(header, 6, 0x0800, 2);
      writeUint(header, 8, 0, 2);
      writeUint(header, 10, stamp.time, 2);
      writeUint(header, 12, stamp.date, 2);
      writeUint(header, 14, checksum, 4);
      writeUint(header, 18, record.data.length, 4);
      writeUint(header, 22, record.data.length, 4);
      writeUint(header, 26, name.length, 2);
      writeUint(header, 28, 0, 2);
      header.set(name, 30);
      chunks.push(header, record.data);

      const entryHeader = new Uint8Array(46 + name.length);
      writeUint(entryHeader, 0, 0x02014b50, 4);
      writeUint(entryHeader, 4, 0x031e, 2);
      writeUint(entryHeader, 6, 20, 2);
      writeUint(entryHeader, 8, 0x0800, 2);
      writeUint(entryHeader, 10, 0, 2);
      writeUint(entryHeader, 12, stamp.time, 2);
      writeUint(entryHeader, 14, stamp.date, 2);
      writeUint(entryHeader, 16, checksum, 4);
      writeUint(entryHeader, 20, record.data.length, 4);
      writeUint(entryHeader, 24, record.data.length, 4);
      writeUint(entryHeader, 28, name.length, 2);
      writeUint(entryHeader, 30, 0, 2);
      writeUint(entryHeader, 32, 0, 2);
      writeUint(entryHeader, 34, 0, 2);
      writeUint(entryHeader, 36, record.directory ? 0x0010 : 0, 2);
      writeUint(entryHeader, 38, (record.directory ? 0o40755 : 0o100644) * 0x10000, 4);
      writeUint(entryHeader, 42, offset, 4);
      entryHeader.set(name, 46);
      central.push(entryHeader);

      offset += header.length + record.data.length;
    });

    const centralSize = central.reduce((total, part) => total + part.length, 0);
    const end = new Uint8Array(22);
    writeUint(end, 0, 0x06054b50, 4);
    writeUint(end, 4, 0, 2);
    writeUint(end, 6, 0, 2);
    writeUint(end, 8, records.length, 2);
    writeUint(end, 10, records.length, 2);
    writeUint(end, 12, centralSize, 4);
    writeUint(end, 16, offset, 4);
    writeUint(end, 20, 0, 2);

    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }

  return { create, crc32 };
})();
