// ベンチマーク用：AIFF・AIFF-C・WAV（PCM 8/16/24/32 bit）を読んで、左右をまぜた Float32Array にする
import { readFileSync } from 'node:fs';

function ext80(b, o) {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1];
  let mant = 0;
  for (let i = 0; i < 8; i++) mant = mant * 256 + b[o + 2 + i];
  return mant * 2 ** (exp - 16383 - 63);
}

function pcm(data, ch, bits, little) {
  const bytes = bits / 8;
  const n = Math.floor(data.length / (bytes * ch));
  const x = new Float32Array(n);
  const read = (o) => {
    if (bits === 8) return little ? (data[o] - 128) / 128 : data.readInt8(o) / 128;
    if (bits === 16) return (little ? data.readInt16LE(o) : data.readInt16BE(o)) / 32768;
    if (bits === 24) return (little ? data.readIntLE(o, 3) : data.readIntBE(o, 3)) / 8388608;
    return (little ? data.readInt32LE(o) : data.readInt32BE(o)) / 2147483648;
  };
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += read((i * ch + c) * bytes);
    x[i] = s / ch;
  }
  return x;
}

/** @returns {{ x: Float32Array, sr: number }} */
export function readAudio(path) {
  const b = readFileSync(path);
  const tag = b.toString('ascii', 0, 4);
  if (tag === 'RIFF') {
    let o = 12;
    let ch = 1;
    let sr = 44100;
    let bits = 16;
    while (o + 8 <= b.length) {
      const id = b.toString('ascii', o, o + 4);
      const size = b.readUInt32LE(o + 4);
      if (id === 'fmt ') {
        ch = b.readUInt16LE(o + 10);
        sr = b.readUInt32LE(o + 12);
        bits = b.readUInt16LE(o + 22);
      } else if (id === 'data') return { x: pcm(b.subarray(o + 8, Math.min(b.length, o + 8 + size)), ch, bits, true), sr };
      o += 8 + size + (size & 1);
    }
    throw new Error(`WAV に data が無い: ${path}`);
  }
  if (tag === 'FORM') {
    const form = b.toString('ascii', 8, 12); // AIFF か AIFC
    let o = 12;
    let ch = 1;
    let sr = 44100;
    let bits = 16;
    let little = false;
    while (o + 8 <= b.length) {
      const id = b.toString('ascii', o, o + 4);
      const size = b.readUInt32BE(o + 4);
      if (id === 'COMM') {
        ch = b.readUInt16BE(o + 8);
        bits = b.readUInt16BE(o + 14);
        sr = ext80(b, o + 16);
        if (form === 'AIFC') {
          const comp = b.toString('ascii', o + 26, o + 30);
          if (comp === 'sowt') little = true;
          else if (comp !== 'NONE') throw new Error(`読めない圧縮 ${comp}: ${path}`);
        }
      } else if (id === 'SSND') {
        const off = b.readUInt32BE(o + 8);
        return { x: pcm(b.subarray(o + 16 + off, Math.min(b.length, o + 8 + size)), ch, bits, little), sr };
      }
      o += 8 + size + (size & 1);
    }
    throw new Error(`AIFF に SSND が無い: ${path}`);
  }
  throw new Error(`知らない形式: ${path}`);
}
