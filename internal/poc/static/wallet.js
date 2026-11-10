(() => {
  // node_modules/@noble/hashes/_u64.js
  var U32_MASK64 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
  var _32n = /* @__PURE__ */ BigInt(32);
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0;i < len; i++) {
      const { h, l } = fromBig(lst[i], le);
      [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
  }
  var fromNumH = (n) => n / 2 ** 32 | 0;
  var fromNumL = (n) => n >>> 0;
  function setU64FromNum(view, byteOffset, n, isLE) {
    const h = fromNumH(n);
    const l = fromNumL(n);
    view.setUint32(byteOffset, isLE ? l : h, isLE);
    view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
  }
  var shrSH = (h, _l, s) => h >>> s;
  var shrSL = (h, l, s) => h << 32 - s | l >>> s;
  var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
  var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
  var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
  var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
  function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
  var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
  var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
  var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
  var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
  var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

  // node_modules/@noble/hashes/utils.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  var atitle = (title) => title ? `"${title}" ` : "";
  function anumber(n, title = "") {
    if (typeof n !== "number")
      throw new TypeError(atitle(title) + "expected number, got " + typeof n);
    if (!Number.isSafeInteger(n) || n < 0)
      throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
    return n;
  }
  function abytes(value, length, title = "") {
    if (isBytes(value) && (length === undefined || value.length === length))
      return value;
    if (length !== undefined)
      anumber(length, "length");
    const bytes = isBytes(value);
    const ofLen = length !== undefined ? ` of length ${length}` : "";
    const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
    const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function")
      throw new TypeError("expected hash wrapped by utils.createHasher");
    anumber(h.outputLen);
    anumber(h.blockLen);
    if (h.outputLen < 1 || h.blockLen < 1)
      throw new Error("hash blockLen / outputLen must be >= 1");
  }
  var aobject = (value, label) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
  };
  var aopts = (value, label) => {
    aobject(value, label);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
      throw new TypeError(`"${label}" expected plain object`);
    if (Object.hasOwn(value, "__proto__"))
      throw new TypeError(`"${label}.__proto__" is not allowed`);
  };
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("hash was destroyed");
    if (checkFinished && instance.finished)
      throw new Error("digest() was already called");
  }
  function aoutput(out, instance) {
    abytes(out, undefined, "output");
    const min = instance.outputLen;
    if (!(out.length >= min)) {
      throw new RangeError('"output" expected length >= ' + min);
    }
  }
  function clean(...arrays) {
    for (let i = 0;i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  function rotl(word, shift) {
    return word << shift | word >>> 32 - shift >>> 0;
  }
  var hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex = "";
    for (let i = 0;i < bytes.length; i++) {
      hex += hexes[bytes[i]];
    }
    return hex;
  }
  function asciiToBase16(ch) {
    return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : undefined;
  }
  function hexToBytes(hex) {
    if (typeof hex !== "string")
      throw new TypeError("hex string expected, got " + typeof hex);
    if (hasHexBuiltin) {
      try {
        return Uint8Array.fromHex(hex);
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new RangeError(error.message);
        throw error;
      }
    }
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
      throw new RangeError("hex string expected, got unpadded hex of length " + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0;ai < al; ai++, hi += 2) {
      const n1 = asciiToBase16(hex.charCodeAt(hi));
      const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
      if (n1 === undefined || n2 === undefined) {
        const char = hex[hi] + hex[hi + 1];
        throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
      }
      array[ai] = n1 * 16 + n2;
    }
    return array;
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new TypeError("string expected");
    const encoded = new TextEncoder().encode(str);
    try {
      return new Uint8Array(encoded);
    } finally {
      clean(encoded);
    }
  }
  function concatBytes(...arrays) {
    let sum = 0;
    for (let i = 0;i < arrays.length; i++) {
      const a = arrays[i];
      abytes(a);
      sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i = 0, pad = 0;i < arrays.length; i++) {
      const a = arrays[i];
      res.set(a, pad);
      pad += a.length;
    }
    return res;
  }
  function checkOpts(defaults, opts, title = "opts") {
    aopts(defaults, "defaults");
    if (opts !== undefined)
      aopts(opts, title);
    const merged = Object.assign(Object.create(null), defaults, opts);
    return merged;
  }
  function createHasher(hashCons, info = {}) {
    if (typeof hashCons !== "function")
      throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
    info = checkOpts({}, info, "info");
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(undefined);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.canXOF = tmp.canXOF;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  function randomBytes(bytesLength = 32) {
    anumber(bytesLength, "bytesLength");
    const cr = typeof globalThis === "object" ? globalThis.crypto : null;
    if (typeof cr?.getRandomValues !== "function")
      throw new Error("crypto.getRandomValues must be defined");
    if (bytesLength > 65536)
      throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
    return cr.getRandomValues(new Uint8Array(bytesLength));
  }
  var oidNist = (suffix) => ({
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
  });

  // node_modules/@noble/hashes/_md.js
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }

  class HashMD {
    blockLen;
    outputLen;
    canXOF = false;
    padOffset;
    isLE;
    buffer;
    view;
    finished = false;
    length = 0;
    pos = 0;
    destroyed = false;
    constructor(blockLen, outputLen, padOffset, isLE) {
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      aexists(this);
      abytes(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      let processed = false;
      for (let pos = 0;pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView(data);
          for (;blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          processed = true;
          continue;
        }
        buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
          processed = true;
        }
      }
      this.length += data.length;
      if (processed)
        this.roundClean();
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      buffer.fill(0, pos);
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        buffer.fill(0);
      }
      setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
      this.process(view, 0);
      this.roundClean();
      const oview = out === buffer ? view : createView(out);
      const len = this.outputLen;
      const outLen = len / 4;
      const state = this.get();
      if (len % 4 || outLen > state.length)
        throw new Error("invalid outputLen");
      for (let i = 0;i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneIntoMeta(to) {
      const { buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (pos)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  }
  var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    4089235720,
    3144134277,
    2227873595,
    1013904242,
    4271175723,
    2773480762,
    1595750129,
    1359893119,
    2917565137,
    2600822924,
    725511199,
    528734635,
    4215389547,
    1541459225,
    327033209
  ]);

  // node_modules/@noble/hashes/sha2.js
  var SHA256_K = /* @__PURE__ */ Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = /* @__PURE__ */ new Uint32Array(64);

  class SHA2_32B extends HashMD {
    A = 0;
    B = 0;
    C = 0;
    D = 0;
    E = 0;
    F = 0;
    G = 0;
    H = 0;
    constructor(outputLen, IV) {
      super(64, outputLen, 8, false);
      this.A = IV[0] | 0;
      this.B = IV[1] | 0;
      this.C = IV[2] | 0;
      this.D = IV[3] | 0;
      this.E = IV[4] | 0;
      this.F = IV[5] | 0;
      this.G = IV[6] | 0;
      this.H = IV[7] | 0;
    }
    get() {
      const { A, B, C, D, E, F, G, H } = this;
      return [A, B, C, D, E, F, G, H];
    }
    set(A, B, C, D, E, F, G, H) {
      this.A = A | 0;
      this.B = B | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    _cloneInto(to) {
      (to ||= new this.constructor).set(...this.get());
      return this._cloneIntoMeta(to);
    }
    process(view, offset) {
      for (let i = 0;i < 16; i++, offset += 4)
        SHA256_W[i] = view.getUint32(offset, false);
      for (let i = 16;i < 64; i++) {
        const W15 = SHA256_W[i - 15];
        const W2 = SHA256_W[i - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i = 0;i < 64; i++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
        const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
        const T2 = sigma0 + Maj(A, B, C) | 0;
        H = G;
        G = F;
        F = E;
        E = D + T1 | 0;
        D = C;
        C = B;
        B = A;
        A = T1 + T2 | 0;
      }
      A = A + this.A | 0;
      B = B + this.B | 0;
      C = C + this.C | 0;
      D = D + this.D | 0;
      E = E + this.E | 0;
      F = F + this.F | 0;
      G = G + this.G | 0;
      H = H + this.H | 0;
      this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
      this.destroyed = true;
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      clean(this.buffer);
    }
  }

  class _SHA256 extends SHA2_32B {
    constructor() {
      super(32, SHA256_IV);
    }
  }
  var K512 = /* @__PURE__ */ (() => split([
    "0x428a2f98d728ae22",
    "0x7137449123ef65cd",
    "0xb5c0fbcfec4d3b2f",
    "0xe9b5dba58189dbbc",
    "0x3956c25bf348b538",
    "0x59f111f1b605d019",
    "0x923f82a4af194f9b",
    "0xab1c5ed5da6d8118",
    "0xd807aa98a3030242",
    "0x12835b0145706fbe",
    "0x243185be4ee4b28c",
    "0x550c7dc3d5ffb4e2",
    "0x72be5d74f27b896f",
    "0x80deb1fe3b1696b1",
    "0x9bdc06a725c71235",
    "0xc19bf174cf692694",
    "0xe49b69c19ef14ad2",
    "0xefbe4786384f25e3",
    "0x0fc19dc68b8cd5b5",
    "0x240ca1cc77ac9c65",
    "0x2de92c6f592b0275",
    "0x4a7484aa6ea6e483",
    "0x5cb0a9dcbd41fbd4",
    "0x76f988da831153b5",
    "0x983e5152ee66dfab",
    "0xa831c66d2db43210",
    "0xb00327c898fb213f",
    "0xbf597fc7beef0ee4",
    "0xc6e00bf33da88fc2",
    "0xd5a79147930aa725",
    "0x06ca6351e003826f",
    "0x142929670a0e6e70",
    "0x27b70a8546d22ffc",
    "0x2e1b21385c26c926",
    "0x4d2c6dfc5ac42aed",
    "0x53380d139d95b3df",
    "0x650a73548baf63de",
    "0x766a0abb3c77b2a8",
    "0x81c2c92e47edaee6",
    "0x92722c851482353b",
    "0xa2bfe8a14cf10364",
    "0xa81a664bbc423001",
    "0xc24b8b70d0f89791",
    "0xc76c51a30654be30",
    "0xd192e819d6ef5218",
    "0xd69906245565a910",
    "0xf40e35855771202a",
    "0x106aa07032bbd1b8",
    "0x19a4c116b8d2d0c8",
    "0x1e376c085141ab53",
    "0x2748774cdf8eeb99",
    "0x34b0bcb5e19b48a8",
    "0x391c0cb3c5c95a63",
    "0x4ed8aa4ae3418acb",
    "0x5b9cca4f7763e373",
    "0x682e6ff3d6b2b8a3",
    "0x748f82ee5defb2fc",
    "0x78a5636f43172f60",
    "0x84c87814a1f0ab72",
    "0x8cc702081a6439ec",
    "0x90befffa23631e28",
    "0xa4506cebde82bde9",
    "0xbef9a3f7b2c67915",
    "0xc67178f2e372532b",
    "0xca273eceea26619c",
    "0xd186b8c721c0c207",
    "0xeada7dd6cde0eb1e",
    "0xf57d4f7fee6ed178",
    "0x06f067aa72176fba",
    "0x0a637dc5a2c898a6",
    "0x113f9804bef90dae",
    "0x1b710b35131c471b",
    "0x28db77f523047d84",
    "0x32caab7b40c72493",
    "0x3c9ebe0a15c9bebc",
    "0x431d67c49c100d4c",
    "0x4cc5d4becb3e42b6",
    "0x597f299cfc657e2a",
    "0x5fcb6fab3ad6faec",
    "0x6c44198c4a475817"
  ].map((n) => BigInt(n))))();
  var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
  var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
  var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
  var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);

  class SHA2_64B extends HashMD {
    Ah = 0;
    Al = 0;
    Bh = 0;
    Bl = 0;
    Ch = 0;
    Cl = 0;
    Dh = 0;
    Dl = 0;
    Eh = 0;
    El = 0;
    Fh = 0;
    Fl = 0;
    Gh = 0;
    Gl = 0;
    Hh = 0;
    Hl = 0;
    constructor(outputLen, IV) {
      super(128, outputLen, 16, false);
      this.Ah = IV[0] | 0;
      this.Al = IV[1] | 0;
      this.Bh = IV[2] | 0;
      this.Bl = IV[3] | 0;
      this.Ch = IV[4] | 0;
      this.Cl = IV[5] | 0;
      this.Dh = IV[6] | 0;
      this.Dl = IV[7] | 0;
      this.Eh = IV[8] | 0;
      this.El = IV[9] | 0;
      this.Fh = IV[10] | 0;
      this.Fl = IV[11] | 0;
      this.Gh = IV[12] | 0;
      this.Gl = IV[13] | 0;
      this.Hh = IV[14] | 0;
      this.Hl = IV[15] | 0;
    }
    get() {
      const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
      this.Ah = Ah | 0;
      this.Al = Al | 0;
      this.Bh = Bh | 0;
      this.Bl = Bl | 0;
      this.Ch = Ch | 0;
      this.Cl = Cl | 0;
      this.Dh = Dh | 0;
      this.Dl = Dl | 0;
      this.Eh = Eh | 0;
      this.El = El | 0;
      this.Fh = Fh | 0;
      this.Fl = Fl | 0;
      this.Gh = Gh | 0;
      this.Gl = Gl | 0;
      this.Hh = Hh | 0;
      this.Hl = Hl | 0;
    }
    _cloneInto(to) {
      (to ||= new this.constructor).set(...this.get());
      return this._cloneIntoMeta(to);
    }
    process(view, offset) {
      for (let i = 0;i < 16; i++, offset += 4) {
        SHA512_W_H[i] = view.getUint32(offset);
        SHA512_W_L[i] = view.getUint32(offset += 4);
      }
      for (let i = 16;i < 80; i++) {
        const W15h = SHA512_W_H[i - 15] | 0;
        const W15l = SHA512_W_L[i - 15] | 0;
        const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
        const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
        const W2h = SHA512_W_H[i - 2] | 0;
        const W2l = SHA512_W_L[i - 2] | 0;
        const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
        const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
        const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
        const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
        SHA512_W_H[i] = SUMh | 0;
        SHA512_W_L[i] = SUMl | 0;
      }
      let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      for (let i = 0;i < 80; i++) {
        const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
        const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
        const CHIh = Eh & Fh ^ ~Eh & Gh;
        const CHIl = El & Fl ^ ~El & Gl;
        const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
        const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
        const T1l = T1ll | 0;
        const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
        const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
        const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
        const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
        Hh = Gh | 0;
        Hl = Gl | 0;
        Gh = Fh | 0;
        Gl = Fl | 0;
        Fh = Eh | 0;
        Fl = El | 0;
        ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
        Dh = Ch | 0;
        Dl = Cl | 0;
        Ch = Bh | 0;
        Cl = Bl | 0;
        Bh = Ah | 0;
        Bl = Al | 0;
        const All = add3L(T1l, sigma0l, MAJl);
        Ah = add3H(All, T1h, sigma0h, MAJh);
        Al = All | 0;
      }
      ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
      ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
      ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
      ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
      ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
      ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
      ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
      ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
      this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
      clean(SHA512_W_H, SHA512_W_L);
    }
    destroy() {
      this.destroyed = true;
      clean(this.buffer);
      this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  }

  class _SHA512 extends SHA2_64B {
    constructor() {
      super(64, SHA512_IV);
    }
  }
  var sha256 = /* @__PURE__ */ createHasher(() => new _SHA256, /* @__PURE__ */ oidNist(1));
  var sha512 = /* @__PURE__ */ createHasher(() => new _SHA512, /* @__PURE__ */ oidNist(3));

  // node_modules/@scure/base/index.js
  /*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var freeze = (fn) => Object.freeze(fn());
  function isBytes2(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  function abytes2(b) {
    if (!isBytes2(b))
      throw new TypeError("Uint8Array expected");
  }
  function isArrayOf(isString, arr) {
    if (!Array.isArray(arr))
      return false;
    if (arr.length === 0)
      return true;
    if (isString) {
      return arr.every((item) => typeof item === "string");
    } else {
      return arr.every((item) => Number.isSafeInteger(item));
    }
  }
  function afn(input) {
    if (typeof input !== "function")
      throw new TypeError("function expected");
    return true;
  }
  function astr(label, input) {
    if (typeof input !== "string")
      throw new TypeError(`${label}: string expected`);
    return true;
  }
  function anumber2(n, title = "number") {
    if (typeof n !== "number")
      throw new TypeError(`${title}: expected number, got ${typeof n}`);
    if (!Number.isSafeInteger(n))
      throw new RangeError(`${title}: expected safe integer, got ${n}`);
  }
  function anumArr(label, input) {
    if (!isArrayOf(false, input))
      throw new TypeError(`${label}: array of numbers expected`);
  }
  function chain(...args) {
    const id = (a) => a;
    const wrap = (a, b) => (c) => a(b(c));
    const encode = args.map((x) => x.encode).reduceRight(wrap, id);
    const decode = args.map((x) => x.decode).reduce(wrap, id);
    return { encode, decode };
  }
  var powers = /* @__PURE__ */ (() => {
    let res = [];
    for (let i = 0;i < 40; i++)
      res.push(2 ** i);
    return res;
  })();
  function u8ToNumArr(u8, len = u8.length) {
    const res = new Array(len);
    for (let i = 0;i < len; i++)
      res[i] = u8[i];
    return res;
  }
  var asciiDecoder = /* @__PURE__ */ (() => {
    try {
      const decoder = new TextDecoder;
      return decoder.decode(Uint8Array.of(65, 48, 43, 127)) === "A0+" ? decoder : undefined;
    } catch (e) {
      return;
    }
  })();
  var B2S_CHUNK = 8192;
  function charcodesToString(codes) {
    const len = codes.length;
    if (asciiDecoder !== undefined && len >= 12)
      return asciiDecoder.decode(codes);
    if (len <= B2S_CHUNK)
      return String.fromCharCode.apply(null, codes);
    let res = "";
    for (let i = 0;i < len; i += B2S_CHUNK)
      res += String.fromCharCode.apply(null, codes.subarray(i, i + B2S_CHUNK));
    return res;
  }
  function radix2(bits) {
    anumber2(bits);
    if (bits <= 0 || bits > 8)
      throw new RangeError("radix2: bits should be in (0..8]");
    const mask = powers[bits] - 1;
    return {
      encode: (bytes) => {
        abytes2(bytes);
        const len = bytes.length;
        const res = new Uint8Array(Math.ceil(len * 8 / bits));
        let carry = 0;
        let pos = 0;
        let j = 0;
        for (let i = 0;i < len; ) {
          if (i + 2 < len) {
            carry = carry << 24 | bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
            pos += 24;
            i += 3;
          } else {
            carry = (carry << 8 | bytes[i]) & 65535;
            pos += 8;
            i++;
          }
          for (;; ) {
            pos -= bits;
            res[j++] = carry >> pos & mask;
            if (pos < bits)
              break;
          }
        }
        if (pos > 0)
          res[j] = carry << bits - pos & mask;
        return res;
      },
      decode: (digits) => {
        const len = digits.length;
        const res = new Uint8Array(Math.floor(len * bits / 8));
        let carry = 0;
        let pos = 0;
        let j = 0;
        for (let i = 0;i < len; i++) {
          carry = (carry << bits | digits[i]) & 65535;
          pos += bits;
          for (;pos >= 8; pos -= 8)
            res[j++] = carry >> pos - 8 & 255;
        }
        carry = carry << 8 - pos & 255;
        if (pos >= bits)
          throw new Error("Excess padding");
        if (carry > 0)
          throw new Error(`Non-zero padding: ${carry}`);
        return res;
      }
    };
  }
  function alphabet(letters, aliases) {
    const len = letters.length;
    if (len > 128)
      throw new Error("alphabet: max 128 letters");
    const encTable = new Uint8Array(len);
    const decTable = new Int8Array(128).fill(-1);
    for (let i = 0;i < len; i++) {
      const code = letters.charCodeAt(i);
      if (letters.codePointAt(i) !== code || code > 127)
        throw new Error("alphabet: single-char ASCII letters only");
      encTable[i] = code;
      decTable[code] = i;
    }
    if (aliases !== undefined) {
      for (const alias of Object.keys(aliases)) {
        const code = alias.charCodeAt(0);
        const target = decTable[aliases[alias].charCodeAt(0)];
        if (alias.length !== 1 || code > 127 || target === undefined || target === -1)
          throw new Error(`alphabet: invalid alias ${alias}`);
        decTable[code] = target;
      }
    }
    return {
      encode: (digits) => {
        const codes = new Uint8Array(digits.length);
        for (let i = 0;i < digits.length; i++) {
          const d = digits[i];
          const code = encTable[d];
          if (code === undefined)
            throw new Error(`alphabet.encode: invalid digit ${d}`);
          codes[i] = code;
        }
        return charcodesToString(codes);
      },
      decode: (input) => {
        astr("decode", input);
        const slen = input.length;
        const digits = new Uint8Array(slen);
        for (let i = 0;i < slen; i++) {
          const code = input.charCodeAt(i);
          const digit = code < 128 ? decTable[code] : -1;
          if (digit === -1)
            throw new Error(`Unknown letter "${input[i]}". Allowed: ${letters}`);
          digits[i] = digit;
        }
        return digits;
      }
    };
  }
  function padding(bits, chr = "=") {
    anumber2(bits);
    astr("padding", chr);
    return {
      encode(data) {
        while (data.length * bits % 8)
          data += chr;
        return data;
      },
      decode(input) {
        astr("decode", input);
        let end = input.length;
        if (end * bits % 8)
          throw new Error("padding: invalid length");
        for (;end > 0 && input[end - 1] === chr; end--) {
          const byte = (end - 1) * bits;
          if (byte % 8 === 0)
            throw new Error("padding: excess padding");
        }
        return input.slice(0, end);
      }
    };
  }
  function unsafeWrapper(fn) {
    afn(fn);
    return function(...args) {
      try {
        return fn.apply(null, args);
      } catch (e) {}
    };
  }
  function checksum(len, fn) {
    anumber2(len);
    if (len <= 0)
      throw new RangeError(`checksum length must be positive: ${len}`);
    afn(fn);
    const _fn = fn;
    return {
      encode(data) {
        abytes2(data);
        const sum = _fn(data).slice(0, len);
        const res = new Uint8Array(data.length + len);
        res.set(data);
        res.set(sum, data.length);
        return res;
      },
      decode(data) {
        abytes2(data);
        const payload = data.slice(0, -len);
        const oldChecksum = data.slice(-len);
        const newChecksum = _fn(payload).slice(0, len);
        for (let i = 0;i < len; i++)
          if (newChecksum[i] !== oldChecksum[i])
            throw new Error("Invalid checksum");
        return payload;
      }
    };
  }
  var hasBase64Builtin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toBase64 === "function" && typeof Uint8Array.fromBase64 === "function")();
  var ASCII_WHITESPACE = /[\t\n\f\r ]/;
  var decodeBase64Builtin = (s, isUrl) => {
    astr("base64", s);
    const alphabet = isUrl ? "base64url" : "base64";
    if (s.length > 0 && ASCII_WHITESPACE.test(s))
      throw new Error("invalid base64");
    return Uint8Array.fromBase64(s, { alphabet, lastChunkHandling: "strict" });
  };
  var base64Fallback = /* @__PURE__ */ freeze(() => chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), padding(6)));
  var base64urlFallback = /* @__PURE__ */ freeze(() => chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"), padding(6)));
  var base64 = /* @__PURE__ */ freeze(() => hasBase64Builtin ? {
    encode(b) {
      abytes2(b);
      return b.toBase64();
    },
    decode(s) {
      return decodeBase64Builtin(s, false);
    }
  } : base64Fallback);
  var base64nopad = /* @__PURE__ */ freeze(() => chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")));
  var base64url = /* @__PURE__ */ freeze(() => hasBase64Builtin ? {
    encode(b) {
      abytes2(b);
      return b.toBase64({ alphabet: "base64url" });
    },
    decode(s) {
      return decodeBase64Builtin(s, true);
    }
  } : base64urlFallback);
  var base64urlnopad = /* @__PURE__ */ freeze(() => chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")));
  var B58_GROUP = 656356768;
  var RADIX_BASE_N_MAX_LENGTH = 65536;
  var BASE_N_MAX_BYTES = 2048;
  var BASE_N_MAX_CHARS = 4096;
  var radixBaseN = (BASE, GROUP) => ({
    encode: (bytes) => {
      abytes2(bytes);
      const blen = bytes.length;
      if (blen === 0)
        return new Uint8Array(0);
      if (blen >= RADIX_BASE_N_MAX_LENGTH)
        throw new Error("invalid length");
      let zeros = 0;
      while (zeros < blen - 1 && bytes[zeros] === 0)
        zeros++;
      const nlimbs = Math.ceil(blen / 2);
      const limbs = new Uint16Array(nlimbs);
      const odd = blen & 1;
      if (odd)
        limbs[0] = bytes[0];
      for (let i = odd, j = odd;i < blen; i += 2, j++)
        limbs[j] = bytes[i] << 8 | bytes[i + 1];
      const groups = [];
      let pos = 0;
      while (pos < nlimbs) {
        let carry = 0;
        for (let i = pos;i < nlimbs; i++) {
          const cur = carry * 65536 + limbs[i];
          const q = Math.floor(cur / GROUP);
          carry = cur - q * GROUP;
          limbs[i] = q;
          if (q === 0 && i === pos)
            pos++;
        }
        groups.push(carry);
      }
      const top = groups.length - 1;
      let sig = top * 5;
      for (let v = groups[top];; v = Math.floor(v / BASE)) {
        sig++;
        if (v < BASE)
          break;
      }
      const res = new Uint8Array(zeros + sig);
      let j = res.length - 1;
      for (let g = 0;g < top; g++) {
        let v = groups[g];
        for (let k = 0;k < 5; k++) {
          res[j--] = v % BASE;
          v = Math.floor(v / BASE);
        }
      }
      for (let v = groups[top];j >= zeros; v = Math.floor(v / BASE))
        res[j--] = v % BASE;
      return res;
    },
    decode: (digits) => {
      abytes2(digits);
      const dlen = digits.length;
      if (dlen === 0)
        return new Uint8Array(0);
      if (dlen >= RADIX_BASE_N_MAX_LENGTH)
        throw new Error("invalid length");
      let zeros = 0;
      while (zeros < dlen - 1 && digits[zeros] === 0)
        zeros++;
      const limbs = new Uint16Array(Math.ceil(dlen * 6 / 16) + 1);
      let used = 0;
      let i = 0;
      let group = dlen % 5 || 5;
      while (i < dlen) {
        let gval = 0;
        let factor = 1;
        for (const end = i + group;i < end; i++) {
          const d = digits[i];
          if (d >= BASE)
            throw new Error(`invalid integer: ${d}`);
          gval = gval * BASE + d;
          factor *= BASE;
        }
        group = 5;
        let carry = gval;
        for (let k = 0;k < used; k++) {
          const cur = limbs[k] * factor + carry;
          carry = Math.floor(cur / 65536);
          limbs[k] = cur - carry * 65536;
        }
        for (;carry > 0; carry = Math.floor(carry / 65536))
          limbs[used++] = carry % 65536;
      }
      const valueBytes = used === 0 ? 1 : used * 2 - (limbs[used - 1] < 256 ? 1 : 0);
      const res = new Uint8Array(zeros + valueBytes);
      let j = res.length - 1;
      for (let k = 0;k < used; k++) {
        const limb = limbs[k];
        res[j--] = limb & 255;
        if (j >= zeros)
          res[j--] = limb >> 8;
      }
      return res;
    }
  });
  var genBaseN = (radix, abc) => {
    const letters = alphabet(abc);
    return {
      encode(bytes) {
        abytes2(bytes);
        if (bytes.length > BASE_N_MAX_BYTES)
          throw new Error("invalid length");
        return letters.encode(radix.encode(bytes));
      },
      decode(str) {
        astr("baseN.decode", str);
        if (str.length > BASE_N_MAX_CHARS)
          throw new Error("invalid length");
        return radix.decode(letters.decode(str));
      }
    };
  };
  var radix58 = /* @__PURE__ */ radixBaseN(58, B58_GROUP);
  var genBase58 = (abc) => genBaseN(radix58, abc);
  var base58 = /* @__PURE__ */ freeze(() => genBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"));
  var createBase58check = (sha256) => {
    afn(sha256);
    const _sha256 = sha256;
    return chain(checksum(4, (data) => _sha256(_sha256(data))), base58);
  };
  var BECH_ALPHABET = /* @__PURE__ */ alphabet("qpzry9x8gf2tvdw0s3jn54khce6mua7l");
  var BECH_UPPERCASE_PRINTABLE = /^[\x21-\x60\x7b-\x7e]+$/;
  function assertBech32Printable(label, value) {
    for (let i = 0;i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c < 33 || c > 126)
        throw new Error(`${label}: printable ASCII expected`);
    }
  }
  function wordsToU8(words) {
    const len = words.length;
    const res = new Uint8Array(len);
    for (let i = 0;i < len; i++) {
      const w = words[i];
      if (w < 0 || w >= 32)
        throw new Error(`alphabet.encode: invalid digit ${w}`);
      res[i] = w;
    }
    return res;
  }
  var POLYMOD_GENERATORS = [996825010, 642813549, 513874426, 1027748829, 705979059];
  function bech32Polymod(pre) {
    const b = pre >> 25;
    let chk = (pre & 33554431) << 5;
    for (let i = 0;i < POLYMOD_GENERATORS.length; i++) {
      if ((b >> i & 1) === 1)
        chk ^= POLYMOD_GENERATORS[i];
    }
    return chk;
  }
  function bechChecksum(prefix, words, encodingConst = 1) {
    const len = prefix.length;
    let chk = 1;
    for (let i = 0;i < len; i++) {
      const c = prefix.charCodeAt(i);
      if (c < 33 || c > 126)
        throw new Error(`Invalid prefix (${prefix})`);
      chk = bech32Polymod(chk) ^ c >> 5;
    }
    chk = bech32Polymod(chk);
    for (let i = 0;i < len; i++)
      chk = bech32Polymod(chk) ^ prefix.charCodeAt(i) & 31;
    for (let v of words)
      chk = bech32Polymod(chk) ^ v;
    for (let i = 0;i < 6; i++)
      chk = bech32Polymod(chk);
    chk ^= encodingConst;
    const sum = new Uint8Array(6);
    for (let i = 0;i < 6; i++)
      sum[i] = chk >>> 5 * (5 - i) & 31;
    return BECH_ALPHABET.encode(sum);
  }
  function genBech32(encoding) {
    const ENCODING_CONST = encoding === "bech32" ? 1 : 734539939;
    const _words = radix2(5);
    const toWords = (from) => {
      abytes2(from);
      const len = from.length;
      const res = new Array(Math.ceil(len * 8 / 5));
      let carry = 0;
      let pos = 0;
      let j = 0;
      for (let i = 0;i < len; i++) {
        carry = carry << 8 | from[i];
        pos += 8;
        for (;pos >= 5; pos -= 5)
          res[j++] = carry >> pos - 5 & 31;
      }
      if (pos > 0)
        res[j] = carry << 5 - pos & 31;
      return res;
    };
    const fromWords = (to) => {
      anumArr("radix2.decode", to);
      const len = to.length;
      const digits = new Uint8Array(len);
      for (let i = 0;i < len; i++) {
        const w = to[i];
        if (w < 0 || w >= 32)
          throw new Error(`convertRadix2: invalid word=${w}`);
        digits[i] = w;
      }
      return _words.decode(digits);
    };
    const fromWordsUnsafe = unsafeWrapper(fromWords);
    function encode(prefix, words, limit = 90) {
      astr("bech32.encode prefix", prefix);
      if (limit !== false)
        anumber2(limit, "limit");
      if (isBytes2(words))
        words = u8ToNumArr(words);
      anumArr("bech32.encode", words);
      const plen = prefix.length;
      if (plen === 0)
        throw new TypeError(`Invalid prefix length ${plen}`);
      const actualLength = plen + 7 + words.length;
      if (limit !== false && actualLength > limit)
        throw new TypeError(`Length ${actualLength} exceeds limit ${limit}`);
      assertBech32Printable("bech32.encode prefix", prefix);
      const lowered = prefix.toLowerCase();
      const sum = bechChecksum(lowered, words, ENCODING_CONST);
      return `${lowered}1${BECH_ALPHABET.encode(wordsToU8(words))}${sum}`;
    }
    function decode(str, limit = 90) {
      astr("bech32.decode input", str);
      if (limit !== false)
        anumber2(limit, "limit");
      const slen = str.length;
      if (slen < 8 || limit !== false && slen > limit)
        throw new TypeError(`invalid string length ${slen}, expected (8..${limit})`);
      const lowered = str.toLowerCase();
      if (str !== lowered) {
        if (!BECH_UPPERCASE_PRINTABLE.test(str)) {
          assertBech32Printable("bech32.decode input", str);
          throw new Error(`mixed-case string not allowed`);
        }
      }
      const sepIndex = lowered.lastIndexOf("1");
      if (sepIndex === 0 || sepIndex === -1)
        throw new Error(`invalid separator "1"`);
      const prefix = lowered.slice(0, sepIndex);
      const data = lowered.slice(sepIndex + 1);
      if (data.length < 6)
        throw new Error("invalid data length");
      const digits = BECH_ALPHABET.decode(data);
      const words = u8ToNumArr(digits, digits.length - 6);
      const sum = bechChecksum(prefix, words, ENCODING_CONST);
      if (!data.endsWith(sum))
        throw new Error(`Invalid checksum in ${str}`);
      return { prefix, words };
    }
    const decodeUnsafe = unsafeWrapper(decode);
    function decodeToBytes(str, limit = 90) {
      const { prefix, words } = decode(str, limit);
      return {
        prefix,
        words,
        bytes: fromWords(words)
      };
    }
    function encodeFromBytes(prefix, bytes) {
      return encode(prefix, toWords(bytes));
    }
    return {
      encode,
      decode,
      encodeFromBytes,
      decodeToBytes,
      decodeUnsafe,
      fromWords,
      fromWordsUnsafe,
      toWords
    };
  }
  var bech32 = /* @__PURE__ */ freeze(() => genBech32("bech32"));

  // node_modules/@noble/hashes/hmac.js
  class _HMAC {
    oHash;
    iHash;
    blockLen;
    outputLen;
    canXOF = false;
    finished = false;
    destroyed = false;
    constructor(hash, key) {
      ahash(hash);
      abytes(key, undefined, "key");
      this.iHash = hash.create();
      if (typeof this.iHash.update !== "function")
        throw new Error("expected Hash instance");
      this.blockLen = this.iHash.blockLen;
      this.outputLen = this.iHash.outputLen;
      const blockLen = this.blockLen;
      const pad = new Uint8Array(blockLen);
      pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i = 0;i < pad.length; i++)
        pad[i] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i = 0;i < pad.length; i++)
        pad[i] ^= 54 ^ 92;
      this.oHash.update(pad);
      clean(pad);
    }
    update(buf) {
      aexists(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const buf = out.subarray(0, this.outputLen);
      this.iHash.digestInto(buf);
      this.oHash.update(buf);
      this.oHash.digestInto(buf);
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.oHash.outputLen);
      this.digestInto(out);
      return out;
    }
    _cloneInto(to) {
      to ||= Object.create(Object.getPrototypeOf(this), {});
      const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
      to = to;
      to.finished = finished;
      to.destroyed = destroyed;
      to.blockLen = blockLen;
      to.outputLen = outputLen;
      to.canXOF = canXOF;
      to.oHash = oHash._cloneInto(to.oHash);
      to.iHash = iHash._cloneInto(to.iHash);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true;
      this.oHash.destroy();
      this.iHash.destroy();
    }
  }
  var hmac = /* @__PURE__ */ (() => {
    const hmac_ = (hash, key, message) => new _HMAC(hash, key).update(message).digest();
    hmac_.create = (hash, key) => new _HMAC(hash, key);
    return hmac_;
  })();

  // node_modules/@noble/curves/utils.js
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  function aarray(item, title, inner = () => {}) {
    if (!Array.isArray(item))
      throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
    for (let i = 0;i < item.length; i++)
      inner(item[i], `${title}[${i}]`);
    return item;
  }
  var abytes3 = (value, length, title) => abytes(value, length, title);
  var anumber3 = anumber;
  function astring(value, title = "") {
    if (typeof value !== "string") {
      const prefix = title && `"${title}" `;
      throw new TypeError(prefix + "expected string, got type=" + typeof value);
    }
    return value;
  }
  function aobject2(value, title = "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
    return value;
  }
  function afunction(value, title) {
    if (typeof value !== "function")
      throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
    return value;
  }
  var bytesToHex2 = bytesToHex;
  var concatBytes2 = (...arrays) => concatBytes(...arrays);
  var hexToBytes2 = (hex) => hexToBytes(hex);
  var isBytes3 = isBytes;
  var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
  var _0n = /* @__PURE__ */ BigInt(0);
  var _1n = /* @__PURE__ */ BigInt(1);
  var atitle2 = (title) => title ? `"${title}" ` : "";
  function abool(value, title = "") {
    if (typeof value !== "boolean")
      throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
    return value;
  }
  function abignumber(n) {
    if (typeof n === "bigint") {
      if (!isPosBig(n))
        throw new RangeError("positive bigint expected, got " + n);
    } else
      anumber3(n);
    return n;
  }
  function asafenumber(value, title = "") {
    if (typeof value !== "number") {
      const prefix = title && `"${title}" `;
      throw new TypeError(prefix + "expected number, got type=" + typeof value);
    }
    if (!Number.isSafeInteger(value)) {
      const prefix = title && `"${title}" `;
      throw new RangeError(prefix + "expected safe integer, got " + value);
    }
  }
  function numberToHexUnpadded(num) {
    const hex = abignumber(num).toString(16);
    return hex.length & 1 ? "0" + hex : hex;
  }
  function hexToNumber(hex) {
    if (typeof hex !== "string")
      throw new TypeError("hex string expected, got " + typeof hex);
    return hex === "" ? _0n : BigInt("0x" + hex);
  }
  function bytesToNumberBE(bytes) {
    return hexToNumber(bytesToHex(bytes));
  }
  function bytesToNumberLE(bytes) {
    return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
  }
  function numberToBytesBE(n, len) {
    anumber(len);
    if (len === 0)
      throw new Error("zero output length is invalid");
    n = abignumber(n);
    const expectedLen = len * 2;
    const hex = n.toString(16);
    if (hex.length > expectedLen)
      throw new RangeError("number is too large");
    return hexToBytes(hex.padStart(expectedLen, "0"));
  }
  function numberToBytesLE(n, len) {
    return numberToBytesBE(n, len).reverse();
  }
  function equalBytes(a, b) {
    a = abytes3(a);
    b = abytes3(b);
    if (a.length !== b.length)
      return false;
    let diff = 0;
    for (let i = 0;i < a.length; i++)
      diff |= a[i] ^ b[i];
    return diff === 0;
  }
  function copyBytes(bytes) {
    return Uint8Array.from(abytes3(bytes));
  }
  function asciiToBytes(ascii) {
    if (typeof ascii !== "string")
      throw new TypeError("ascii string expected, got " + typeof ascii);
    return Uint8Array.from(ascii, (c, i) => {
      const charCode = c.charCodeAt(0);
      if (c.length !== 1 || charCode > 127) {
        throw new RangeError(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
      }
      return charCode;
    });
  }
  function isPosBig(n) {
    return typeof n === "bigint" && _0n <= n;
  }
  function inRange(n, min, max) {
    return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
  }
  function aInRange(title, n, min, max) {
    if (!inRange(n, min, max))
      throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
  }
  function bitLen(n) {
    if (n < _0n)
      throw new Error("expected non-negative bigint, got " + n);
    return n === _0n ? 0 : n.toString(2).length;
  }
  var bitMask = (n) => {
    asafenumber(n, "n");
    return (_1n << BigInt(n)) - _1n;
  };
  function createHmacDrbg(hashLen, qByteLen, hmacFn) {
    anumber(hashLen, "hashLen");
    anumber(qByteLen, "qByteLen");
    if (typeof hmacFn !== "function")
      throw new TypeError("hmacFn must be a function");
    const u8n = (len) => new Uint8Array(len);
    const NULL = Uint8Array.of();
    const byte0 = Uint8Array.of(0);
    const byte1 = Uint8Array.of(1);
    const _maxDrbgIters = 1000;
    let v = u8n(hashLen);
    let k = u8n(hashLen);
    let i = 0;
    const reset = () => {
      v.fill(1);
      k.fill(0);
      i = 0;
    };
    const h = (...msgs) => hmacFn(k, concatBytes2(v, ...msgs));
    const reseed = (seed = NULL) => {
      k = h(byte0, seed);
      v = h();
      if (seed.length === 0)
        return;
      k = h(byte1, seed);
      v = h();
    };
    const gen = () => {
      if (i++ >= _maxDrbgIters)
        throw new Error("drbg: tried max amount of iterations");
      let len = 0;
      const out = [];
      while (len < qByteLen) {
        v = h();
        const sl = v.slice();
        out.push(sl);
        len += v.length;
      }
      return concatBytes2(...out);
    };
    const genUntil = (seed, pred) => {
      reset();
      reseed(seed);
      let res = undefined;
      while ((res = pred(gen())) === undefined)
        reseed();
      reset();
      return res;
    };
    return genUntil;
  }
  function validateObject(object, fields = {}, optFields = {}, title = "object") {
    aobject2(object, title);
    aobject2(fields, "fields");
    aobject2(optFields, "optFields");
    function checkField(fieldName, expectedType, isOpt) {
      const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
      const val = object[fieldName];
      if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== undefined : expectedType !== "function")) {
        throw new TypeError(`${label} is invalid: expected own property`);
      }
      if (isOpt && val === undefined)
        return;
      const current = typeof val;
      if (current !== expectedType || val === null)
        throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
    }
    const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
    iter(fields, false);
    iter(optFields, true);
  }

  // node_modules/@noble/curves/abstract/modular.js
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var _0n2 = /* @__PURE__ */ BigInt(0);
  var _1n2 = /* @__PURE__ */ BigInt(1);
  var _2n = /* @__PURE__ */ BigInt(2);
  var _3n = /* @__PURE__ */ BigInt(3);
  var _4n = /* @__PURE__ */ BigInt(4);
  var _5n = /* @__PURE__ */ BigInt(5);
  var _7n = /* @__PURE__ */ BigInt(7);
  var _8n = /* @__PURE__ */ BigInt(8);
  var _9n = /* @__PURE__ */ BigInt(9);
  var _15n = /* @__PURE__ */ BigInt(15);
  var _16n = /* @__PURE__ */ BigInt(16);
  var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
  function mod(a, b) {
    if (b <= _0n2)
      throw new Error("mod: expected positive modulus, got " + b);
    const result = a % b;
    return result >= _0n2 ? result : b + result;
  }
  function pow(num, power, modulo) {
    if (modulo <= _1n2)
      throw new Error("pow: expected modulus > 1, got " + modulo);
    if (typeof power !== "bigint")
      throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
    if (power < _0n2)
      throw new Error("invalid exponent, negatives unsupported");
    if (power === _0n2)
      return _1n2;
    if (power === _1n2)
      return num;
    let d = num % modulo;
    if (d < _0n2)
      d += modulo;
    if (power < POW_WINDOWED_MIN) {
      let p = _1n2;
      while (power > _0n2) {
        if (power & _1n2)
          p = p * d % modulo;
        d = d * d % modulo;
        power >>= _1n2;
      }
      return p;
    }
    const digits = [];
    while (power > _0n2) {
      digits.push(Number(power & _15n));
      power >>= _4n;
    }
    const table = new Array(16);
    table[0] = _1n2;
    table[1] = d;
    for (let i = 2;i < 16; i++)
      table[i] = table[i - 1] * d % modulo;
    let p = table[digits[digits.length - 1]];
    for (let w = digits.length - 2;w >= 0; w--) {
      p = p * p % modulo;
      p = p * p % modulo;
      p = p * p % modulo;
      p = p * p % modulo;
      const digit = digits[w];
      if (digit !== 0)
        p = p * table[digit] % modulo;
    }
    return p;
  }
  function pow2(x, power, modulo) {
    if (modulo <= _1n2)
      throw new Error("pow2: expected modulus > 1, got " + modulo);
    if (power < _0n2)
      throw new Error("pow2: expected non-negative exponent, got " + power);
    let res = x;
    while (power-- > _0n2) {
      res *= res;
      res %= modulo;
    }
    return res;
  }
  function invert(number, modulo) {
    if (number === _0n2)
      throw new Error("invert: expected non-zero number");
    if (modulo <= _1n2)
      throw new Error("invert: expected modulus > 1, got " + modulo);
    let a = mod(number, modulo);
    let b = modulo;
    let x = _0n2, u = _1n2;
    while (a !== _0n2) {
      const q = b / a;
      const r = b - a * q;
      const m = x - u * q;
      b = a, a = r, x = u, u = m;
    }
    const gcd = b;
    if (gcd !== _1n2)
      throw new Error("invert: does not exist");
    return mod(x, modulo);
  }
  function invertCt(a, prime) {
    if (prime <= _1n2)
      throw new Error("invertCt: expected prime modulus > 1, got " + prime);
    const an = mod(a, prime);
    if (an === _0n2)
      throw new Error("invertCt: expected non-zero number");
    const inverse = pow(an, prime - _2n, prime);
    if (mod(an * inverse, prime) !== _1n2)
      throw new Error("invertCt: does not exist");
    return inverse;
  }
  function assertIsSquare(Fp, root, n) {
    const F = Fp;
    if (!F.eql(F.sqr(root), n))
      throw new Error("Cannot find square root");
  }
  function aoddModulus(order, fnName) {
    if ((order & _1n2) === _0n2)
      throw new Error(fnName + ": expected odd modulus, got " + order);
  }
  function sqrt3mod4(Fp, n) {
    const F = Fp;
    const p1div4 = (F.ORDER + _1n2) / _4n;
    const root = F.pow(n, p1div4);
    assertIsSquare(F, root, n);
    return root;
  }
  function sqrt5mod8(Fp, n) {
    const F = Fp;
    const p5div8 = (F.ORDER - _5n) / _8n;
    const n2 = F.mul(n, _2n);
    const v = F.pow(n2, p5div8);
    const nv = F.mul(n, v);
    const i = F.mul(F.mul(nv, _2n), v);
    const root = F.mul(nv, F.sub(i, F.ONE));
    assertIsSquare(F, root, n);
    return root;
  }
  function sqrt9mod16(P) {
    const Fp_ = Field(P);
    const tn = tonelliShanks(P);
    const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
    const c2 = tn(Fp_, c1);
    const c3 = tn(Fp_, Fp_.neg(c1));
    const c4 = (P + _7n) / _16n;
    return (Fp, n) => {
      const F = Fp;
      let tv1 = F.pow(n, c4);
      let tv2 = F.mul(tv1, c1);
      const tv3 = F.mul(tv1, c2);
      const tv4 = F.mul(tv1, c3);
      const e1 = F.eql(F.sqr(tv2), n);
      const e2 = F.eql(F.sqr(tv3), n);
      tv1 = F.cmov(tv1, tv2, e1);
      tv2 = F.cmov(tv4, tv3, e2);
      const e3 = F.eql(F.sqr(tv2), n);
      const root = F.cmov(tv1, tv2, e3);
      assertIsSquare(F, root, n);
      return root;
    };
  }
  function tonelliShanks(P) {
    if (P < _3n)
      throw new Error("sqrt is not defined for small field");
    aoddModulus(P, "tonelliShanks");
    let Q = P - _1n2;
    let S = 0;
    while (Q % _2n === _0n2) {
      Q /= _2n;
      S++;
    }
    let Z = _2n;
    const _Fp = Field(P);
    while (FpLegendre(_Fp, Z) === 1) {
      if (Z++ > 1000)
        throw new Error("Cannot find square root: probably non-prime P");
    }
    if (S === 1)
      return sqrt3mod4;
    let cc = _Fp.pow(Z, Q);
    const Q1div2 = (Q + _1n2) / _2n;
    return function tonelliSlow(Fp, n) {
      const F = Fp;
      if (F.is0(n))
        return n;
      if (FpLegendre(F, n) !== 1)
        throw new Error("Cannot find square root");
      let M = S;
      let c = F.mul(F.ONE, cc);
      let t = F.pow(n, Q);
      let R = F.pow(n, Q1div2);
      while (!F.eql(t, F.ONE)) {
        if (F.is0(t))
          throw new Error("Cannot find square root: probably non-prime P");
        let i = 1;
        let t_tmp = F.sqr(t);
        while (!F.eql(t_tmp, F.ONE)) {
          i++;
          t_tmp = F.sqr(t_tmp);
          if (i === M)
            throw new Error("Cannot find square root");
        }
        const exponent = _1n2 << BigInt(M - i - 1);
        const b = F.pow(c, exponent);
        M = i;
        c = F.sqr(b);
        t = F.mul(t, c);
        R = F.mul(R, b);
      }
      return R;
    };
  }
  function FpSqrt(P) {
    aoddModulus(P, "Fp.sqrt");
    if (P % _4n === _3n)
      return sqrt3mod4;
    if (P % _8n === _5n)
      return sqrt5mod8;
    if (P % _16n === _9n)
      return sqrt9mod16(P);
    return tonelliShanks(P);
  }
  var FIELD_FIELDS = [
    "create",
    "isValid",
    "is0",
    "neg",
    "inv",
    "sqrt",
    "sqr",
    "eql",
    "add",
    "sub",
    "mul",
    "pow",
    "div",
    "addN",
    "subN",
    "mulN",
    "sqrN"
  ];
  function validateField(field) {
    aobject2(field, "field");
    if (typeof field.ORDER !== "bigint")
      throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
    asafenumber(field.BYTES, "BYTES");
    asafenumber(field.BITS, "BITS");
    for (const name of FIELD_FIELDS)
      afunction(field[name], "field." + name);
    if (field.BYTES < 1 || field.BITS < 1)
      throw new Error("invalid field: expected BYTES/BITS > 0");
    if (field.ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
    return field;
  }
  function FpInvertBatch(Fp, nums, passZero = false) {
    validateField(Fp);
    aarray(nums, "nums");
    abool(passZero, "passZero");
    const F = Fp;
    const inverted = new Array(nums.length).fill(passZero ? F.ZERO : undefined);
    const multipliedAcc = nums.reduce((acc, num, i) => {
      if (F.is0(num))
        return acc;
      inverted[i] = acc;
      return F.mul(acc, num);
    }, F.ONE);
    const invertedAcc = F.inv(multipliedAcc);
    nums.reduceRight((acc, num, i) => {
      if (F.is0(num))
        return acc;
      inverted[i] = F.mul(acc, inverted[i]);
      return F.mul(acc, num);
    }, invertedAcc);
    return inverted;
  }
  function FpLegendre(Fp, n) {
    validateField(Fp);
    const F = Fp;
    aoddModulus(F.ORDER, "FpLegendre");
    const p1mod2 = (F.ORDER - _1n2) / _2n;
    const powered = F.pow(n, p1mod2);
    const yes = F.eql(powered, F.ONE);
    const zero = F.eql(powered, F.ZERO);
    const no = F.eql(powered, F.neg(F.ONE));
    if (!yes && !zero && !no)
      throw new Error("invalid Legendre symbol result");
    return yes ? 1 : zero ? 0 : -1;
  }
  function nLength(n, nBitLength) {
    if (nBitLength !== undefined)
      anumber3(nBitLength);
    if (n <= _0n2)
      throw new Error("invalid n length: expected positive n, got " + n);
    if (nBitLength !== undefined && nBitLength < 1)
      throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
    const bits = bitLen(n);
    if (nBitLength !== undefined && nBitLength < bits)
      throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
    const _nBitLength = nBitLength !== undefined ? nBitLength : bits;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
  }
  var FIELD_SQRT = new WeakMap;

  class _Field {
    ORDER;
    BITS;
    BYTES;
    isLE;
    ZERO = _0n2;
    ONE = _1n2;
    _lengths;
    _mod;
    constructor(ORDER, opts = {}) {
      if (ORDER <= _1n2)
        throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
      let _nbitLength = undefined;
      this.isLE = false;
      if (opts != null && typeof opts === "object") {
        if (typeof opts.BITS === "number")
          _nbitLength = opts.BITS;
        if (typeof opts.sqrt === "function")
          Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
        if (typeof opts.isLE === "boolean")
          this.isLE = opts.isLE;
        if (opts.allowedLengths)
          this._lengths = Object.freeze(opts.allowedLengths.slice());
        if (typeof opts.modFromBytes === "boolean")
          this._mod = opts.modFromBytes;
      }
      const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
      if (nByteLength > 2048)
        throw new Error("invalid field: expected ORDER of <= 2048 bytes");
      this.ORDER = ORDER;
      this.BITS = nBitLength;
      this.BYTES = nByteLength;
      Object.freeze(this);
    }
    create(num) {
      return mod(num, this.ORDER);
    }
    isValid(num) {
      if (typeof num !== "bigint")
        throw new TypeError("invalid field element: expected bigint, got " + typeof num);
      return _0n2 <= num && num < this.ORDER;
    }
    is0(num) {
      return num === _0n2;
    }
    isValidNot0(num) {
      return !this.is0(num) && this.isValid(num);
    }
    isOdd(num) {
      return (num & _1n2) === _1n2;
    }
    neg(num) {
      return mod(-num, this.ORDER);
    }
    eql(lhs, rhs) {
      return lhs === rhs;
    }
    sqr(num) {
      return mod(num * num, this.ORDER);
    }
    add(lhs, rhs) {
      return mod(lhs + rhs, this.ORDER);
    }
    sub(lhs, rhs) {
      return mod(lhs - rhs, this.ORDER);
    }
    mul(lhs, rhs) {
      return mod(lhs * rhs, this.ORDER);
    }
    pow(num, power) {
      return pow(num, power, this.ORDER);
    }
    div(lhs, rhs) {
      return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
    }
    sqrN(num) {
      return num * num;
    }
    addN(lhs, rhs) {
      return lhs + rhs;
    }
    subN(lhs, rhs) {
      return lhs - rhs;
    }
    mulN(lhs, rhs) {
      return lhs * rhs;
    }
    inv(num) {
      return invert(num, this.ORDER);
    }
    sqrt(num) {
      let sqrt = FIELD_SQRT.get(this);
      if (!sqrt)
        FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
      return sqrt(this, num);
    }
    toBytes(num) {
      return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
    }
    fromBytes(bytes, skipValidation = false) {
      abytes3(bytes);
      const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
      if (allowedLengths) {
        if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      if (modFromBytes)
        scalar = mod(scalar, ORDER);
      if (!skipValidation) {
        if (!this.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    }
    invertBatch(lst) {
      return FpInvertBatch(this, lst, true);
    }
    cmov(a, b, condition) {
      abool(condition, "condition");
      return condition ? b : a;
    }
  }
  function Field(ORDER, opts = {}) {
    Object.freeze(_Field.prototype);
    return new _Field(ORDER, opts);
  }
  function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== "bigint")
      throw new Error("field order must be bigint");
    if (fieldOrder <= _1n2)
      throw new Error("field order must be greater than 1");
    const bitLength = bitLen(fieldOrder - _1n2);
    return Math.ceil(bitLength / 8);
  }
  function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
  }
  function mapHashToField(key, fieldOrder, isLE = false) {
    abytes3(key);
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = Math.max(getMinHashLength(fieldOrder), 16);
    if (len < minLen || len > 1024)
      throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
    const num = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
    const reduced = mod(num, fieldOrder - _1n2) + _1n2;
    return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
  }

  // node_modules/@noble/curves/abstract/curve.js
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var _0n3 = /* @__PURE__ */ BigInt(0);
  var _1n3 = /* @__PURE__ */ BigInt(1);
  var _4n2 = /* @__PURE__ */ BigInt(4);
  var BLIND_BYTES = 16;
  var BLIND_BITS = 128;
  var FW_WINDOW = 5;
  var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
  function validatePointCons(Point) {
    const pc = Point;
    if (typeof pc !== "function")
      throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
    afunction(pc.fromAffine, "Point.fromAffine");
    afunction(pc.fromBytes, "Point.fromBytes");
    afunction(pc.fromHex, "Point.fromHex");
    aobject2(pc.BASE, "Point.BASE");
    aobject2(pc.ZERO, "Point.ZERO");
    validateField(pc.Fp);
    validateField(pc.Fn);
  }
  function normalizeZ(c, points) {
    validatePointCons(c);
    validateMSMPoints(points, c);
    const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
    return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
  }
  function validateW(W, bits, min = 1) {
    if (!Number.isSafeInteger(W) || W < min || W > bits)
      throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
  }
  function validateTableBytes(numPoints, fpBytes) {
    const bytes = numPoints * (4 * fpBytes + 128);
    if (bytes > TABLE_BYTES_MAX)
      throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
  }
  function probeRandomBytes(randomBytes, length) {
    if (randomBytes === undefined)
      return;
    afunction(randomBytes, "randomBytes");
    try {
      const probe = randomBytes(length);
      if (!isBytes3(probe) || probe.length !== length)
        return;
    } catch {
      return;
    }
    return randomBytes;
  }
  function validateMSMPoints(points, c) {
    aarray(points, "points");
    points.forEach((p, i) => {
      if (!(p instanceof c))
        throw new Error("invalid point at index " + i);
    });
  }
  function validateMSMScalars(scalars, field, maxScalar) {
    if (!Array.isArray(scalars))
      throw new Error("array of scalars expected");
    scalars.forEach((s, i) => {
      const ok = maxScalar === undefined ? field.isValid(s) : isPosBig(s) && s < maxScalar;
      if (!ok)
        throw new Error("invalid scalar at index " + i);
    });
  }
  var pointWindowSizes = new WeakMap;
  function getWindowSize(P) {
    return pointWindowSizes.get(P) || 1;
  }
  function oddMultiples(p, size) {
    const dbl = p.double();
    const t = [p];
    for (let j = 1;j < size; j++)
      t.push(t[j - 1].add(dbl));
    return t;
  }
  function wnafDigits(n, W) {
    const size = 2 ** W;
    const half = size / 2;
    const mask = BigInt(size - 1);
    const d = [];
    while (n > _0n3) {
      let w = 0;
      if (n & _1n3) {
        w = Number(n & mask);
        if (w >= half)
          w -= size;
        n -= BigInt(w);
      }
      d.push(w);
      n >>= _1n3;
    }
    return d;
  }
  function signedWindowDigits(n, W, windows) {
    const size = 2 ** W;
    const half = size / 2;
    const mask = BigInt(size - 1);
    const shiftBy = BigInt(W);
    const d = [];
    for (let w = 0;w < windows; w++) {
      let v = Number(n & mask);
      n >>= shiftBy;
      if (v > half) {
        v -= size;
        n += _1n3;
      }
      d.push(v);
    }
    if (n !== _0n3)
      throw new Error("invalid wnaf");
    return d;
  }
  function wnafWalk(zero, tables, digits) {
    let max = 0;
    for (const d of digits)
      max = Math.max(max, d.length);
    let acc = zero;
    for (let bit = max - 1;bit >= 0; bit--) {
      if (bit !== max - 1)
        acc = acc.double();
      for (let i = 0;i < digits.length; i++) {
        const w = digits[i][bit];
        if (w) {
          const item = tables[i][Math.abs(w) - 1 >> 1];
          acc = acc.add(w < 0 ? item.negate() : item);
        }
      }
    }
    return acc;
  }

  class ScalarMultiplier {
    Point;
    BASE;
    ZERO;
    randomBytes;
    wnafPrecomputes = new WeakMap;
    baseCanBeBlinded;
    bits;
    constructor(Point, randomBytes) {
      validatePointCons(Point);
      this.randomBytes = probeRandomBytes(randomBytes, BLIND_BYTES);
      this.Point = Point;
      this.BASE = Point.BASE;
      this.ZERO = Point.ZERO;
      this.bits = Point.Fn.BITS;
    }
    buildWnafTable(point, W, bits) {
      const windows = Math.ceil(bits / W) + 1;
      const half = 2 ** (W - 1);
      const comp = [];
      let base = point;
      for (let w = 0;w < windows; w++) {
        let acc = base;
        for (let i = 0;i < half; i++) {
          comp.push(acc);
          acc = acc.add(base);
        }
        base = comp[comp.length - 1].double();
      }
      return { W, bits, windows, comp };
    }
    wnafCachedCT(precomputes, n) {
      const { W, windows, comp } = precomputes;
      const half = 2 ** (W - 1);
      const digits = signedWindowDigits(n, W, windows);
      let p = this.ZERO;
      let f = this.BASE;
      for (let w = 0;w < windows; w++) {
        const digit = digits[w];
        const start = w * half;
        const idx = Math.abs(digit) - 1;
        let sel = comp[start];
        for (let i = 1;i < half; i++)
          sel = i === idx ? comp[start + i] : sel;
        const neg = sel.negate();
        if (digit === 0)
          f = f.add(comp[start]);
        else
          p = p.add(digit < 0 ? neg : sel);
      }
      return { p, f };
    }
    getWnafPrecomputes(W, point, bits, transform) {
      let entries = this.wnafPrecomputes.get(point);
      let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
      if (!comp) {
        comp = this.buildWnafTable(point, W, bits);
        if (typeof transform === "function")
          comp = { ...comp, comp: transform(comp.comp) };
        if (!entries) {
          entries = [];
          this.wnafPrecomputes.set(point, entries);
        }
        entries.push(comp);
      }
      return comp;
    }
    assertPoint(point) {
      if (!(point instanceof this.Point))
        throw new TypeError('"point" expected Point instance, got type=' + typeof point);
    }
    validateMulInput(point, scalar) {
      this.assertPoint(point);
      if (!inRange(scalar, _1n3, this.Point.Fn.ORDER))
        throw new Error("invalid scalar");
    }
    runCT(point, n, bits, transform) {
      const W = getWindowSize(point);
      if (W === 1)
        return this.fixedWindowCT(point, n, bits);
      return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
    }
    mulCT(point, scalar, transform) {
      this.validateMulInput(point, scalar);
      return this.runCT(point, scalar, this.bits, transform);
    }
    mulCTBlinded(point, scalar, transform) {
      this.validateMulInput(point, scalar);
      if (this.randomBytes === undefined)
        throw new Error("randomBytes is required for scalar blinding");
      const bits = this.Point.Fn.BITS + BLIND_BITS;
      const blind = this.randomBytes(BLIND_BYTES);
      if (!isBytes3(blind) || blind.length !== BLIND_BYTES)
        throw new Error("randomBytes returned invalid byte array");
      blind[0] = blind[0] & 63 | 128;
      const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
      return this.runCT(point, n, bits, transform);
    }
    fixedWindowCT(point, n, bits) {
      const W = FW_WINDOW;
      const size = 1 << W;
      const mask = bitMask(W);
      const table = new Array(size);
      table[0] = this.ZERO;
      for (let i = 1;i < size; i++)
        table[i] = table[i - 1].add(point);
      const windows = Math.ceil(bits / W);
      let acc = this.ZERO;
      for (let window2 = windows - 1;window2 >= 0; window2--) {
        if (window2 !== windows - 1)
          for (let d = 0;d < W; d++)
            acc = acc.double();
        const digit = Number(n >> BigInt(window2 * W) & mask);
        let sel = table[0];
        for (let i = 1;i < size; i++)
          sel = i === digit ? table[i] : sel;
        acc = acc.add(sel);
      }
      return { p: acc, f: acc };
    }
    shouldBlind(point, cofactor) {
      if (this.randomBytes === undefined)
        return false;
      if (cofactor === _1n3)
        return true;
      if (point !== this.BASE)
        return false;
      if (this.baseCanBeBlinded === undefined)
        this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
      return this.baseCanBeBlinded;
    }
    mulSecret(point, scalar, cofactor, transform) {
      return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
    }
    mulUnsafe(point, scalar, transform) {
      this.assertPoint(point);
      if (!isPosBig(scalar))
        throw new Error("invalid scalar");
      const W = getWindowSize(point);
      if (W === 1 || scalar >= this.Point.Fn.ORDER)
        return mulAddUnsafe(this.Point, [point], [scalar], true);
      const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
      return this.wnafCachedCT(precomputes, scalar).p;
    }
    setWindowSize(point, W) {
      this.assertPoint(point);
      validateW(W, this.bits);
      const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
      validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
      pointWindowSizes.set(point, W);
      this.wnafPrecomputes.delete(point);
    }
    hasWindowSize(point) {
      return getWindowSize(point) !== 1;
    }
  }
  function mulAddUnsafe(c, points, scalars, allowOversized = false) {
    validatePointCons(c);
    validateMSMPoints(points, c);
    abool(allowOversized, "allowOversized");
    validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n2 : undefined);
    if (points.length !== scalars.length)
      throw new Error("arrays of points and scalars must have equal length");
    const tables = points.map((p) => oddMultiples(p, 4));
    const digits = scalars.map((n) => wnafDigits(n, 4));
    return wnafWalk(c.ZERO, tables, digits);
  }
  function createField(order, field, isLE) {
    if (field) {
      if (field.ORDER !== order)
        throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
      validateField(field);
      return field;
    } else {
      return Field(order, { isLE });
    }
  }
  function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
    if (type !== "weierstrass" && type !== "edwards")
      throw new Error('expected curve type "weierstrass" or "edwards"');
    if (FpFnLE === undefined)
      FpFnLE = type === "edwards";
    if (!CURVE || typeof CURVE !== "object")
      throw new Error(`expected valid ${type} CURVE object`);
    validateObject(curveOpts);
    for (const p of ["p", "n", "h"]) {
      const val = CURVE[p];
      if (!(isPosBig(val) && val !== _0n3))
        throw new Error(`CURVE.${p} must be positive bigint`);
    }
    const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
    const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
    const _b = type === "weierstrass" ? "b" : "d";
    const params = ["Gx", "Gy", "a", _b];
    for (const p of params) {
      if (!Fp.isValid(CURVE[p]))
        throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
    }
    CURVE = Object.freeze(Object.assign({}, CURVE));
    return { CURVE, Fp, Fn };
  }
  function createKeygen(randomSecretKey, getPublicKey) {
    return function keygen(seed) {
      const secretKey = randomSecretKey(seed);
      return { secretKey, publicKey: getPublicKey(secretKey) };
    };
  }

  // node_modules/@noble/curves/abstract/der.js
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var _0n4 = /* @__PURE__ */ BigInt(0);

  class DERErr extends Error {
    constructor(m = "") {
      super(m);
    }
  }
  var _DER = {
    Err: DERErr,
    _tlv: {
      encode: (tag, data) => {
        const { Err: E } = _DER;
        asafenumber(tag, "tag");
        if (tag < 0 || tag > 255)
          throw new E("tlv.encode: wrong tag");
        astring(data, "data");
        if (data.length & 1)
          throw new E("tlv.encode: unpadded data");
        const dataLen = data.length / 2;
        const len = numberToHexUnpadded(dataLen);
        if (len.length / 2 & 128)
          throw new E("tlv.encode: long form length too big");
        const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
        const t = numberToHexUnpadded(tag);
        return t + lenLen + len + data;
      },
      decode(tag, data) {
        const { Err: E } = _DER;
        data = abytes3(data, undefined, "DER data");
        let pos = 0;
        if (tag < 0 || tag > 255)
          throw new E("tlv.decode: wrong tag");
        if (data.length < 2 || data[pos++] !== tag)
          throw new E("tlv.decode: wrong tlv");
        const first = data[pos++];
        const isLong = !!(first & 128);
        let length = 0;
        if (!isLong)
          length = first;
        else {
          const lenLen = first & 127;
          if (!lenLen)
            throw new E("tlv.decode(long): indefinite length not supported");
          if (lenLen > 4)
            throw new E("tlv.decode(long): byte length is too big");
          const lengthBytes = data.subarray(pos, pos + lenLen);
          if (lengthBytes.length !== lenLen)
            throw new E("tlv.decode: length bytes not complete");
          if (lengthBytes[0] === 0)
            throw new E("tlv.decode(long): zero leftmost byte");
          for (const b of lengthBytes)
            length = length << 8 | b;
          pos += lenLen;
          if (length < 128)
            throw new E("tlv.decode(long): not minimal encoding");
        }
        const v = data.subarray(pos, pos + length);
        if (v.length !== length)
          throw new E("tlv.decode: wrong value length");
        return { v, l: data.subarray(pos + length) };
      }
    },
    _int: {
      encode(num) {
        const { Err: E } = _DER;
        abignumber(num);
        if (num < _0n4)
          throw new E("integer: negative integers are not allowed");
        let hex = numberToHexUnpadded(num);
        if (Number.parseInt(hex[0], 16) & 8)
          hex = "00" + hex;
        if (hex.length & 1)
          throw new E("unexpected DER parsing assertion: unpadded hex");
        return hex;
      },
      decode(data) {
        const { Err: E } = _DER;
        if (data.length < 1)
          throw new E("invalid signature integer: empty");
        if (data[0] & 128)
          throw new E("invalid signature integer: negative");
        if (data.length > 1 && data[0] === 0 && !(data[1] & 128))
          throw new E("invalid signature integer: unnecessary leading zero");
        return bytesToNumberBE(data);
      }
    },
    toSig(bytes, maxScalarBytes) {
      const { Err: E, _int: int, _tlv: tlv } = _DER;
      if (maxScalarBytes !== undefined) {
        asafenumber(maxScalarBytes, "maxScalarBytes");
        if (maxScalarBytes < 1)
          throw new E("invalid signature: maxScalarBytes must be positive");
      }
      const data = abytes3(bytes, undefined, "signature");
      const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
      if (seqLeftBytes.length)
        throw new E("invalid signature: left bytes after parsing");
      const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
      const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
      if (sLeftBytes.length)
        throw new E("invalid signature: left bytes after parsing");
      if (maxScalarBytes !== undefined && (rBytes.length > maxScalarBytes || sBytes.length > maxScalarBytes))
        throw new E("invalid signature: integer too large");
      return { r: int.decode(rBytes), s: int.decode(sBytes) };
    },
    hexFromSig(sig) {
      const { _tlv: tlv, _int: int } = _DER;
      validateObject(sig, { r: "bigint", s: "bigint" }, {}, "sig");
      const rs = tlv.encode(2, int.encode(sig.r));
      const ss = tlv.encode(2, int.encode(sig.s));
      const seq = rs + ss;
      return tlv.encode(48, seq);
    }
  };
  var DER = /* @__PURE__ */ (() => {
    Object.freeze(_DER._tlv);
    Object.freeze(_DER._int);
    return Object.freeze(_DER);
  })();

  // node_modules/@noble/curves/abstract/weierstrass.js
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n2) / den;
  function _splitEndoScalar(k, basis, n) {
    aInRange("scalar", k, _0n5, n);
    const [[a1, b1], [a2, b2]] = basis;
    const c1 = divNearest(b2 * k, n);
    const c2 = divNearest(-b1 * k, n);
    let k1 = k - c1 * a1 - c2 * a2;
    let k2 = -c1 * b1 - c2 * b2;
    const k1neg = k1 < _0n5;
    const k2neg = k2 < _0n5;
    if (k1neg)
      k1 = -k1;
    if (k2neg)
      k2 = -k2;
    const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
    if (k1 < _0n5 || k1 >= MAX_NUM || k2 < _0n5 || k2 >= MAX_NUM) {
      throw new Error("splitScalar (endomorphism): failed for k");
    }
    return { k1neg, k1, k2neg, k2 };
  }
  function validateSigFormat(format) {
    if (!["compact", "recovered", "der"].includes(format))
      throw new Error('Signature format must be "compact", "recovered", or "der"');
    return format;
  }
  function validateSigOpts(opts, def) {
    validateObject(opts);
    const optsn = {};
    for (let optName of Object.keys(def)) {
      optsn[optName] = opts[optName] === undefined ? def[optName] : opts[optName];
    }
    abool(optsn.lowS, "lowS");
    abool(optsn.prehash, "prehash");
    if (optsn.format !== undefined)
      validateSigFormat(optsn.format);
    return optsn;
  }
  var _0n5 = /* @__PURE__ */ BigInt(0);
  var _1n4 = /* @__PURE__ */ BigInt(1);
  var _2n2 = /* @__PURE__ */ BigInt(2);
  var _3n2 = /* @__PURE__ */ BigInt(3);
  var _4n3 = /* @__PURE__ */ BigInt(4);
  function weierstrass(params, extraOpts = {}) {
    const validated = createCurveFields("weierstrass", params, extraOpts);
    const Fp = validated.Fp;
    const Fn = validated.Fn;
    let CURVE = validated.CURVE;
    const { h: cofactor, n: CURVE_ORDER } = CURVE;
    validateObject(extraOpts, {}, {
      allowInfinityPoint: "boolean",
      clearCofactor: "function",
      isTorsionFree: "function",
      fromBytes: "function",
      toBytes: "function",
      endo: "object",
      randomBytes: "function"
    });
    const { endo: endoOpts, allowInfinityPoint, clearCofactor, isTorsionFree, fromBytes, toBytes } = extraOpts;
    const randomBytes = extraOpts.randomBytes === undefined ? randomBytes2 : extraOpts.randomBytes;
    if (endoOpts) {
      if (!Fp.is0(CURVE.a) || typeof endoOpts.beta !== "bigint" || !Array.isArray(endoOpts.basises)) {
        throw new Error('invalid endo: expected "beta": bigint and "basises": array');
      }
    }
    const endo = endoOpts ? {
      beta: endoOpts.beta,
      basises: endoOpts.basises.map((basis) => [...basis])
    } : undefined;
    const lengths = getWLengths(Fp, Fn);
    function assertCompressionIsSupported() {
      if (!Fp.isOdd)
        throw new Error("compression is not supported: Field does not have .isOdd()");
    }
    function pointToBytes(_c, point, isCompressed) {
      if (point.is0()) {
        if (!allowInfinityPoint)
          throw new Error("bad point: ZERO");
        return Uint8Array.of(0);
      }
      const { x, y } = point.toAffine();
      const bx = Fp.toBytes(x);
      abool(isCompressed, "isCompressed");
      if (isCompressed) {
        assertCompressionIsSupported();
        const hasEvenY = !Fp.isOdd(y);
        return concatBytes2(pprefix(hasEvenY), bx);
      } else {
        return concatBytes2(Uint8Array.of(4), bx, Fp.toBytes(y));
      }
    }
    function pointFromBytes(bytes) {
      abytes3(bytes, undefined, "Point");
      const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
      const length = bytes.length;
      const head = bytes[0];
      const tail = bytes.subarray(1);
      if (allowInfinityPoint && length === 1 && head === 0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (length === comp && (head === 2 || head === 3)) {
        const x = Fp.fromBytes(tail);
        if (!Fp.isValid(x))
          throw new Error("bad point: is not on curve, wrong x");
        const y2 = weierstrassEquation(x);
        let y;
        try {
          y = Fp.sqrt(y2);
        } catch (sqrtError) {
          const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
          throw new Error("bad point: is not on curve, sqrt error" + err);
        }
        assertCompressionIsSupported();
        const evenY = Fp.isOdd(y);
        const evenH = (head & 1) === 1;
        if (evenH !== evenY)
          y = Fp.neg(y);
        return { x, y };
      } else if (length === uncomp && head === 4) {
        const L = Fp.BYTES;
        const x = Fp.fromBytes(tail.subarray(0, L));
        const y = Fp.fromBytes(tail.subarray(L, L * 2));
        if (!isValidXY(x, y))
          throw new Error("bad point: is not on curve");
        return { x, y };
      } else {
        throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
      }
    }
    const encodePoint = toBytes === undefined ? pointToBytes : toBytes;
    const decodePoint = fromBytes === undefined ? pointFromBytes : fromBytes;
    const b3 = Fp.mul(CURVE.b, _3n2);
    const mulA = Fp.is0(CURVE.a) ? (_) => Fp.ZERO : (x) => Fp.mul(CURVE.a, x);
    function weierstrassEquation(x) {
      const x2 = Fp.sqr(x);
      const x3 = Fp.mul(x2, x);
      return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
    }
    function isValidXY(x, y) {
      const left = Fp.sqr(y);
      const right = weierstrassEquation(x);
      return Fp.eql(left, right);
    }
    if (!isValidXY(CURVE.Gx, CURVE.Gy))
      throw new Error("bad curve params: generator point");
    const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n3);
    const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
    if (Fp.is0(Fp.add(_4a3, _27b2)))
      throw new Error("bad curve params: a or b");
    function acoord(title, n, banZero = false) {
      if (!Fp.isValid(n) || banZero && Fp.is0(n))
        throw new Error(`bad point coordinate ${title}`);
      return typeof n === "object" && n !== null ? Fp.create(n) : n;
    }
    function aprjpoint(other) {
      if (!(other instanceof Point))
        throw new Error("Weierstrass Point expected");
    }
    function splitEndoScalarN(k) {
      if (!endo || !endo.basises)
        throw new Error("no endo");
      return _splitEndoScalar(k, endo.basises, Fn.ORDER);
    }
    function pushWnafPair(points, scalars, p, k) {
      if (!Fn.isValid(k))
        throw new RangeError("invalid scalar: out of range");
      if (endo) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(k);
        const psi = new Point(Fp.mul(p.X, endo.beta), p.Y, p.Z);
        points.push(k1neg ? p.negate() : p, k2neg ? psi.negate() : psi);
        scalars.push(k1, k2);
      } else {
        points.push(p);
        scalars.push(k);
      }
    }
    const validityCache = new WeakSet;

    class Point {
      static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
      static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
      static Fp = Fp;
      static Fn = Fn;
      X;
      Y;
      Z;
      constructor(X, Y, Z) {
        this.X = acoord("x", X);
        this.Y = acoord("y", Y, true);
        this.Z = acoord("z", Z);
        Object.freeze(this);
      }
      static CURVE() {
        return CURVE;
      }
      static fromAffine(p) {
        const { x, y } = p || {};
        if (!p || !Fp.isValid(x) || !Fp.isValid(y))
          throw new Error("invalid affine point");
        if (p instanceof Point)
          throw new Error("projective point not allowed");
        if (Fp.is0(x) && Fp.is0(y))
          return Point.ZERO;
        return new Point(x, y, Fp.ONE);
      }
      static fromBytes(bytes) {
        const P = Point.fromAffine(decodePoint(abytes3(bytes, undefined, "point")));
        P.assertValidity();
        return P;
      }
      static fromHex(hex) {
        return Point.fromBytes(hexToBytes2(hex));
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      precompute(windowSize = 6, isLazy = true) {
        wnaf.setWindowSize(this, windowSize);
        if (!isLazy)
          this.multiply(_3n2);
        return this;
      }
      assertValidity() {
        const p = this;
        if (p.is0()) {
          if (allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
            return;
          throw new Error("bad point: ZERO");
        }
        if (validityCache.has(p))
          return;
        const { x, y } = p.toAffine();
        if (!Fp.isValid(x) || !Fp.isValid(y))
          throw new Error("bad point: x or y not field elements");
        if (!isValidXY(x, y))
          throw new Error("bad point: equation left != right");
        if (!p.isTorsionFree())
          throw new Error("bad point: not in prime-order subgroup");
        validityCache.add(p);
      }
      hasEvenY() {
        const { y } = this.toAffine();
        if (!Fp.isOdd)
          throw new Error("Field doesn't support isOdd");
        return !Fp.isOdd(y);
      }
      equals(other) {
        aprjpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
        const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
        return U1 && U2;
      }
      negate() {
        return new Point(this.X, Fp.neg(this.Y), this.Z);
      }
      double() {
        const { X: X1, Y: Y1, Z: Z1 } = this;
        let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp;
        let t0 = Fp.mul(X1, X1);
        let t1 = Fp.mul(Y1, Y1);
        let t2 = Fp.mul(Z1, Z1);
        let t3 = Fp.mul(X1, Y1);
        t3 = Fp.add(t3, t3);
        Z3 = Fp.mul(X1, Z1);
        Z3 = Fp.add(Z3, Z3);
        X3 = mulA(Z3);
        Y3 = Fp.mul(b3, t2);
        Y3 = Fp.add(X3, Y3);
        X3 = Fp.sub(t1, Y3);
        Y3 = Fp.add(t1, Y3);
        Y3 = Fp.mul(X3, Y3);
        X3 = Fp.mul(t3, X3);
        Z3 = Fp.mul(b3, Z3);
        t2 = mulA(t2);
        t3 = Fp.sub(t0, t2);
        t3 = mulA(t3);
        t3 = Fp.add(t3, Z3);
        Z3 = Fp.add(t0, t0);
        t0 = Fp.add(Z3, t0);
        t0 = Fp.add(t0, t2);
        t0 = Fp.mul(t0, t3);
        Y3 = Fp.add(Y3, t0);
        t2 = Fp.mul(Y1, Z1);
        t2 = Fp.add(t2, t2);
        t0 = Fp.mul(t2, t3);
        X3 = Fp.sub(X3, t0);
        Z3 = Fp.mul(t2, t1);
        Z3 = Fp.add(Z3, Z3);
        Z3 = Fp.add(Z3, Z3);
        return new Point(X3, Y3, Z3);
      }
      add(other) {
        aprjpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        let { ZERO: X3, ZERO: Y3, ZERO: Z3 } = Fp;
        let t0 = Fp.mul(X1, X2);
        let t1 = Fp.mul(Y1, Y2);
        let t2 = Fp.mul(Z1, Z2);
        let t3 = Fp.add(X1, Y1);
        let t4 = Fp.add(X2, Y2);
        t3 = Fp.mul(t3, t4);
        t4 = Fp.add(t0, t1);
        t3 = Fp.sub(t3, t4);
        t4 = Fp.add(X1, Z1);
        let t5 = Fp.add(X2, Z2);
        t4 = Fp.mul(t4, t5);
        t5 = Fp.add(t0, t2);
        t4 = Fp.sub(t4, t5);
        t5 = Fp.add(Y1, Z1);
        X3 = Fp.add(Y2, Z2);
        t5 = Fp.mul(t5, X3);
        X3 = Fp.add(t1, t2);
        t5 = Fp.sub(t5, X3);
        Z3 = mulA(t4);
        X3 = Fp.mul(b3, t2);
        Z3 = Fp.add(X3, Z3);
        X3 = Fp.sub(t1, Z3);
        Z3 = Fp.add(t1, Z3);
        Y3 = Fp.mul(X3, Z3);
        t1 = Fp.add(t0, t0);
        t1 = Fp.add(t1, t0);
        t2 = mulA(t2);
        t4 = Fp.mul(b3, t4);
        t1 = Fp.add(t1, t2);
        t2 = Fp.sub(t0, t2);
        t2 = mulA(t2);
        t4 = Fp.add(t4, t2);
        t0 = Fp.mul(t1, t4);
        Y3 = Fp.add(Y3, t0);
        t0 = Fp.mul(t5, t4);
        X3 = Fp.mul(t3, X3);
        X3 = Fp.sub(X3, t0);
        t0 = Fp.mul(t3, t1);
        Z3 = Fp.mul(t5, Z3);
        Z3 = Fp.add(Z3, t0);
        return new Point(X3, Y3, Z3);
      }
      subtract(other) {
        aprjpoint(other);
        return this.add(other.negate());
      }
      is0() {
        return this.equals(Point.ZERO);
      }
      multiply(scalar) {
        if (!Fn.isValidNot0(scalar))
          throw new RangeError("invalid scalar: out of range");
        const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
        return normalize([p, f])[0];
      }
      multiplyUnsafe(scalar) {
        const p = this;
        const sc = scalar;
        if (!Fn.isValid(sc))
          throw new RangeError("invalid scalar: out of range");
        if (sc === _0n5 || p.is0())
          return Point.ZERO;
        if (sc === _1n4)
          return p;
        if (wnaf.hasWindowSize(this))
          return wnaf.mulUnsafe(p, sc, normalize);
        const points = [];
        const scalars = [];
        pushWnafPair(points, scalars, p, sc);
        return mulAddUnsafe(Point, points, scalars);
      }
      mulAddUnsafe(a, other, b) {
        aprjpoint(other);
        const points = [];
        const scalars = [];
        pushWnafPair(points, scalars, this, a);
        pushWnafPair(points, scalars, other, b);
        return mulAddUnsafe(Point, points, scalars);
      }
      toAffine(invertedZ) {
        const p = this;
        let iz = invertedZ;
        if (iz != null && !Fp.isValid(iz))
          throw new RangeError('"invertedZ" expected valid field element');
        const { X, Y, Z } = p;
        if (Fp.eql(Z, Fp.ONE))
          return { x: X, y: Y };
        const is0 = p.is0();
        if (iz == null)
          iz = is0 ? Fp.ONE : Fp.inv(Z);
        const x = Fp.mul(X, iz);
        const y = Fp.mul(Y, iz);
        const zz = Fp.mul(Z, iz);
        if (is0)
          return { x: Fp.ZERO, y: Fp.ZERO };
        if (!Fp.eql(zz, Fp.ONE))
          throw new Error("invZ was invalid");
        return { x, y };
      }
      isTorsionFree() {
        if (cofactor === _1n4)
          return true;
        if (isTorsionFree)
          return isTorsionFree(Point, this);
        return wnaf.mulUnsafe(this, CURVE_ORDER).is0();
      }
      clearCofactor() {
        if (cofactor === _1n4)
          return this;
        if (clearCofactor)
          return clearCofactor(Point, this);
        return this.multiplyUnsafe(cofactor);
      }
      isSmallOrder() {
        if (cofactor === _1n4)
          return this.is0();
        return this.clearCofactor().is0();
      }
      toBytes(isCompressed = true) {
        abool(isCompressed, "isCompressed");
        this.assertValidity();
        return encodePoint(Point, this, isCompressed);
      }
      toHex(isCompressed = true) {
        return bytesToHex2(this.toBytes(isCompressed));
      }
      toString() {
        return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
      }
    }
    const normalize = (points) => normalizeZ(Point, points);
    const wnaf = new ScalarMultiplier(Point, randomBytes);
    if (wnaf.bits >= 6)
      Point.BASE.precompute(6);
    Object.freeze(Point.prototype);
    Object.freeze(Point);
    return Point;
  }
  function pprefix(hasEvenY) {
    return Uint8Array.of(hasEvenY ? 2 : 3);
  }
  function getWLengths(Fp, Fn) {
    return {
      secretKey: Fn.BYTES,
      publicKey: 1 + Fp.BYTES,
      publicKeyUncompressed: 1 + 2 * Fp.BYTES,
      publicKeyHasPrefix: true,
      signature: 2 * Fn.BYTES
    };
  }
  function ecdh(Point, ecdhOpts = {}) {
    validatePointCons(Point);
    const { Fn } = Point;
    const randomBytes_ = ecdhOpts.randomBytes === undefined ? randomBytes2 : ecdhOpts.randomBytes;
    const lengths = Object.assign(getWLengths(Point.Fp, Fn), {
      seed: Math.max(getMinHashLength(Fn.ORDER), 16)
    });
    function isValidSecretKey(secretKey) {
      try {
        const num = Fn.fromBytes(secretKey);
        return Fn.isValidNot0(num);
      } catch (error) {
        return false;
      }
    }
    function isValidPublicKey(publicKey, isCompressed) {
      const { publicKey: comp, publicKeyUncompressed } = lengths;
      try {
        const l = publicKey.length;
        if (isCompressed === true && l !== comp)
          return false;
        if (isCompressed === false && l !== publicKeyUncompressed)
          return false;
        return !Point.fromBytes(publicKey).is0();
      } catch (error) {
        return false;
      }
    }
    function randomSecretKey(seed) {
      seed = seed === undefined ? randomBytes_(lengths.seed) : seed;
      return mapHashToField(abytes3(seed, lengths.seed, "seed"), Fn.ORDER);
    }
    function getPublicKey(secretKey, isCompressed = true) {
      return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
    }
    function isProbPub(item) {
      const { secretKey, publicKey, publicKeyUncompressed } = lengths;
      const allowedLengths = Fn._lengths;
      if (!isBytes3(item))
        return;
      const l = abytes3(item, undefined, "key").length;
      const isPub = l === publicKey || l === publicKeyUncompressed;
      const isSec = l === secretKey || !!allowedLengths?.includes(l);
      if (isPub && isSec)
        return;
      return isPub;
    }
    function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
      if (isProbPub(secretKeyA) === true)
        throw new Error("first arg must be private key");
      if (isProbPub(publicKeyB) === false)
        throw new Error("second arg must be public key");
      const s = Fn.fromBytes(secretKeyA);
      const b = Point.fromBytes(publicKeyB);
      if (b.is0())
        throw new Error("invalid public key: point at infinity");
      return b.multiply(s).toBytes(isCompressed);
    }
    const utils = {
      isValidSecretKey,
      isValidPublicKey,
      randomSecretKey
    };
    const keygen = createKeygen(randomSecretKey, getPublicKey);
    Object.freeze(utils);
    Object.freeze(lengths);
    return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
  }
  function ecdsa(Point, hash, ecdsaOpts = {}) {
    validatePointCons(Point);
    const hash_ = hash;
    ahash(hash_);
    validateObject(ecdsaOpts, {}, {
      hmac: "function",
      lowS: "boolean",
      randomBytes: "function",
      bits2int: "function",
      bits2int_modN: "function"
    });
    const opts = Object.assign({}, ecdsaOpts);
    const randomBytes = opts.randomBytes === undefined ? randomBytes2 : opts.randomBytes;
    const hmac2 = opts.hmac === undefined ? (key, msg) => hmac(hash_, key, msg) : opts.hmac;
    const { Fp, Fn } = Point;
    const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
    const blindLength = getMinHashLength(CURVE_ORDER);
    const csprng = probeRandomBytes(randomBytes, blindLength);
    const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, opts);
    const defaultSigOpts = {
      prehash: true,
      lowS: typeof opts.lowS === "boolean" ? opts.lowS : true,
      format: "compact",
      extraEntropy: false
    };
    const hasLargeRecoveryLifts = CURVE_ORDER * _2n2 + _1n4 < Fp.ORDER;
    function isBiggerThanHalfOrder(number) {
      const HALF = CURVE_ORDER >> _1n4;
      return number > HALF;
    }
    function validateRS(title, num) {
      if (!Fn.isValidNot0(num))
        throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
      return num;
    }
    function assertFieldSignIsSupported() {
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
    }
    function getRecoveryBit(x, y, r) {
      assertFieldSignIsSupported();
      return (x === r ? 0 : 2) | Number(Fp.isOdd(y));
    }
    function assertRecoverableCurve() {
      if (hasLargeRecoveryLifts)
        throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
    }
    function validateSigLength(bytes, format) {
      validateSigFormat(format);
      const size = lengths.signature;
      const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : undefined;
      return abytes3(bytes, sizer);
    }

    class Signature {
      r;
      s;
      recovery;
      constructor(r, s, recovery) {
        this.r = validateRS("r", r);
        this.s = validateRS("s", s);
        if (recovery != null) {
          assertRecoverableCurve();
          if (![0, 1, 2, 3].includes(recovery))
            throw new Error("invalid recovery id");
          this.recovery = recovery;
        }
        Object.freeze(this);
      }
      static fromBytes(bytes, format = defaultSigOpts.format) {
        validateSigLength(bytes, format);
        let recid;
        if (format === "der") {
          if (bytes.length > 2 * Fn.BYTES + 16)
            throw new DER.Err("invalid signature: DER signature too long");
          const { r, s } = DER.toSig(abytes3(bytes), Fn.BYTES + 1);
          return new Signature(r, s);
        }
        if (format === "recovered") {
          recid = bytes[0];
          format = "compact";
          bytes = bytes.subarray(1);
        }
        const L = lengths.signature / 2;
        const r = bytes.subarray(0, L);
        const s = bytes.subarray(L, L * 2);
        return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
      }
      static fromHex(hex, format) {
        return this.fromBytes(hexToBytes2(hex), format);
      }
      assertRecovery() {
        const { recovery } = this;
        if (recovery == null)
          throw new Error("invalid recovery id: must be present");
        return recovery;
      }
      addRecoveryBit(recovery) {
        return new Signature(this.r, this.s, recovery);
      }
      recoverPublicKey(messageHash) {
        const { r, s } = this;
        const recovery = this.assertRecovery();
        const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
        if (!Fp.isValid(radj))
          throw new Error("invalid recovery id: sig.r+curve.n != R.x");
        const x = Fp.toBytes(radj);
        const R = Point.fromBytes(concatBytes2(pprefix((recovery & 1) === 0), x));
        const ir = Fn.inv(radj);
        const h = bits2int_modN(abytes3(messageHash, undefined, "msgHash"));
        const u1 = Fn.create(-h * ir);
        const u2 = Fn.create(s * ir);
        const Q = Point.BASE.mulAddUnsafe(u1, R, u2);
        if (Q.is0())
          throw new Error("invalid recovery: point at infinify");
        Q.assertValidity();
        return Q;
      }
      hasHighS() {
        return isBiggerThanHalfOrder(this.s);
      }
      toBytes(format = defaultSigOpts.format) {
        validateSigFormat(format);
        if (format === "der")
          return hexToBytes2(DER.hexFromSig(this));
        const { r, s } = this;
        const rb = Fn.toBytes(r);
        const sb = Fn.toBytes(s);
        if (format === "recovered") {
          assertRecoverableCurve();
          return concatBytes2(Uint8Array.of(this.assertRecovery()), rb, sb);
        }
        return concatBytes2(rb, sb);
      }
      toHex(format) {
        return bytesToHex2(this.toBytes(format));
      }
    }
    Object.freeze(Signature.prototype);
    Object.freeze(Signature);
    const bits2int = opts.bits2int === undefined ? function bits2int_def(bytes) {
      if (bytes.length > 8192)
        throw new Error("input is too large");
      const num = bytesToNumberBE(bytes);
      const delta = bytes.length * 8 - fnBits;
      return delta > 0 ? num >> BigInt(delta) : num;
    } : opts.bits2int;
    const bits2int_modN = opts.bits2int_modN === undefined ? function bits2int_modN_def(bytes) {
      return Fn.create(bits2int(bytes));
    } : opts.bits2int_modN;
    const ORDER_MASK = bitMask(fnBits);
    function int2octets(num) {
      aInRange("num < 2^" + fnBits, num, _0n5, ORDER_MASK);
      return Fn.toBytes(num);
    }
    function validateMsgAndHash(message, prehash) {
      abytes3(message, undefined, "message");
      return prehash ? abytes3(hash_(message), undefined, "prehashed message") : message;
    }
    function prepSig(message, secretKey, opts) {
      const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
      message = validateMsgAndHash(message, prehash);
      const h1int = bits2int_modN(message);
      const d = Fn.fromBytes(secretKey);
      if (!Fn.isValidNot0(d))
        throw new Error("invalid private key");
      const seedArgs = [int2octets(d), int2octets(h1int)];
      if (extraEntropy != null && extraEntropy !== false) {
        const e = extraEntropy === true ? randomBytes(lengths.secretKey) : extraEntropy;
        seedArgs.push(abytes3(e, undefined, "extraEntropy"));
      }
      const seed = concatBytes2(...seedArgs);
      const m = h1int;
      function k2sig(kBytes) {
        const k = bits2int(kBytes);
        if (!Fn.isValidNot0(k))
          return;
        const q = Point.BASE.multiply(k).toAffine();
        const r = Fn.create(q.x);
        if (r === _0n5)
          return;
        let s;
        if (csprng !== undefined) {
          const b = bytesToNumberBE(mapHashToField(csprng(blindLength), CURVE_ORDER));
          const ibk = Fn.inv(Fn.mul(b, k));
          const bm = Fn.mul(b, m);
          const bd = Fn.mul(b, d);
          s = Fn.create(ibk * Fn.create(bm + bd * r));
        } else {
          const ik = invertCt(k, CURVE_ORDER);
          s = Fn.create(ik * Fn.create(m + r * d));
        }
        if (s === _0n5)
          return;
        let recovery = getRecoveryBit(q.x, q.y, r);
        let normS = s;
        if (lowS && isBiggerThanHalfOrder(s)) {
          normS = Fn.neg(s);
          recovery ^= 1;
        }
        return new Signature(r, normS, hasLargeRecoveryLifts ? undefined : recovery);
      }
      return { seed, k2sig };
    }
    function sign(message, secretKey, opts = {}) {
      const { seed, k2sig } = prepSig(message, secretKey, opts);
      const drbg = createHmacDrbg(hash_.outputLen, Fn.BYTES, hmac2);
      const sig = drbg(seed, k2sig);
      return sig.toBytes(opts.format);
    }
    function verify(signature, message, publicKey, opts = {}) {
      const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
      publicKey = abytes3(publicKey, undefined, "publicKey");
      message = validateMsgAndHash(message, prehash);
      if (!isBytes3(signature)) {
        const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
        throw new Error("verify expects Uint8Array signature" + end);
      }
      validateSigLength(signature, format);
      try {
        const sig = Signature.fromBytes(signature, format);
        const P = Point.fromBytes(publicKey);
        if (P.is0())
          return false;
        if (lowS && sig.hasHighS())
          return false;
        const { r, s } = sig;
        const h = bits2int_modN(message);
        const is = Fn.inv(s);
        const u1 = Fn.create(h * is);
        const u2 = Fn.create(r * is);
        const R = Point.BASE.mulAddUnsafe(u1, P, u2);
        if (R.is0())
          return false;
        const q = R.toAffine();
        const v = Fn.create(q.x);
        if (v !== r)
          return false;
        if (format === "recovered" && sig.recovery !== getRecoveryBit(q.x, q.y, r))
          return false;
        return true;
      } catch (e) {
        return false;
      }
    }
    function recoverPublicKey(signature, message, opts = {}) {
      const { prehash } = validateSigOpts(opts, defaultSigOpts);
      message = validateMsgAndHash(message, prehash);
      return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
    }
    return Object.freeze({
      keygen,
      getPublicKey,
      getSharedSecret,
      utils,
      lengths,
      Point,
      sign,
      verify,
      recoverPublicKey,
      Signature,
      hash: hash_
    });
  }

  // node_modules/@noble/curves/secp256k1.js
  /*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
  var secp256k1_CURVE = {
    p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
    n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
    h: BigInt(1),
    a: BigInt(0),
    b: BigInt(7),
    Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
    Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
  };
  var secp256k1_ENDO = {
    beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
    basises: [
      [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
      [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
    ]
  };
  var _0n6 = /* @__PURE__ */ BigInt(0);
  var _2n3 = /* @__PURE__ */ BigInt(2);
  function sqrtMod(y) {
    const P = secp256k1_CURVE.p;
    const _3n = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
    const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
    const b2 = y * y * y % P;
    const b3 = b2 * b2 * y % P;
    const b6 = pow2(b3, _3n, P) * b3 % P;
    const b9 = pow2(b6, _3n, P) * b3 % P;
    const b11 = pow2(b9, _2n3, P) * b2 % P;
    const b22 = pow2(b11, _11n, P) * b11 % P;
    const b44 = pow2(b22, _22n, P) * b22 % P;
    const b88 = pow2(b44, _44n, P) * b44 % P;
    const b176 = pow2(b88, _88n, P) * b88 % P;
    const b220 = pow2(b176, _44n, P) * b44 % P;
    const b223 = pow2(b220, _3n, P) * b3 % P;
    const t1 = pow2(b223, _23n, P) * b22 % P;
    const t2 = pow2(t1, _6n, P) * b2 % P;
    const root = pow2(t2, _2n3, P);
    if (!Fpk1.eql(Fpk1.sqr(root), y))
      throw new Error("Cannot find square root");
    return root;
  }
  var Fpk1 = /* @__PURE__ */ Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
  var Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
    Fp: Fpk1,
    endo: secp256k1_ENDO
  });
  var secp256k1 = /* @__PURE__ */ ecdsa(Pointk1, sha256);
  var TAGGED_HASH_PREFIXES = Object.create(null);
  function taggedHash(tag, ...messages) {
    let tagP = TAGGED_HASH_PREFIXES[tag];
    if (tagP === undefined) {
      const tagH = sha256(asciiToBytes(tag));
      tagP = concatBytes2(tagH, tagH);
      TAGGED_HASH_PREFIXES[tag] = tagP;
    }
    return sha256(concatBytes2(tagP, ...messages));
  }
  var pointToBytes = (point) => point.toBytes(true).slice(1);
  var affineXToBytes = ({ x }) => Fpk1.toBytes(x);
  var hasEven = (y) => !Fpk1.isOdd(y);
  function schnorrGetExtPubKey(priv) {
    const { Fn, BASE } = Pointk1;
    const d_ = Fn.fromBytes(abytes3(priv, 32, "secretKey"));
    const p = BASE.multiply(d_);
    const affine = p.toAffine();
    const scalar = hasEven(affine.y) ? d_ : Fn.neg(d_);
    return { scalar, bytes: affineXToBytes(affine) };
  }
  function lift_x(x) {
    const Fp = Fpk1;
    if (!Fp.isValidNot0(x))
      throw new Error("invalid x: Fail if x ≥ p");
    const xx = Fp.sqr(x);
    const c = Fp.add(Fp.mulN(xx, x), BigInt(7));
    let y = Fp.sqrt(c);
    if (!hasEven(y))
      y = Fp.neg(y);
    const p = Pointk1.fromAffine({ x, y });
    p.assertValidity();
    return p;
  }
  var num = bytesToNumberBE;
  function challenge(...args) {
    return Pointk1.Fn.create(num(taggedHash("BIP0340/challenge", ...args)));
  }
  function schnorrGetPublicKey(secretKey) {
    return schnorrGetExtPubKey(secretKey).bytes;
  }
  function schnorrSign(message, secretKey, auxRand = randomBytes(32)) {
    const { Fn, BASE } = Pointk1;
    const m = copyBytes(abytes3(message, undefined, "message"));
    const { bytes: px, scalar: d } = schnorrGetExtPubKey(secretKey);
    const a = abytes3(auxRand, 32, "auxRand");
    const t = Fn.toBytes(d ^ num(taggedHash("BIP0340/aux", a)));
    const rand = taggedHash("BIP0340/nonce", t, px, m);
    const k_ = Fn.create(num(rand));
    if (k_ === _0n6)
      throw new Error("sign failed: k is zero");
    const p = BASE.multiply(k_);
    const affine = p.toAffine();
    const k = hasEven(affine.y) ? k_ : Fn.neg(k_);
    const rx = affineXToBytes(affine);
    const e = challenge(rx, px, m);
    const sig = new Uint8Array(64);
    sig.set(rx, 0);
    sig.set(Fn.toBytes(Fn.create(k + e * d)), 32);
    if (!schnorrVerify(sig, m, px))
      throw new Error("sign: Invalid signature produced");
    return sig;
  }
  function schnorrVerify(signature, message, publicKey) {
    const { Fp, Fn, BASE } = Pointk1;
    const sig = abytes3(signature, 64, "signature");
    const m = abytes3(message, undefined, "message");
    const pub = abytes3(publicKey, 32, "publicKey");
    try {
      const P = lift_x(num(pub));
      const rBytes = sig.subarray(0, 32);
      const r = num(rBytes);
      if (!Fp.isValidNot0(r))
        return false;
      const s = num(sig.subarray(32, 64));
      if (!Fn.isValidNot0(s))
        return false;
      const e = challenge(rBytes, pointToBytes(P), m);
      const R = BASE.mulAddUnsafe(s, P, Fn.neg(e));
      const { x, y } = R.toAffine();
      if (R.is0() || !hasEven(y) || !Fp.eql(x, r))
        return false;
      return true;
    } catch (error) {
      return false;
    }
  }
  var schnorr = /* @__PURE__ */ (() => {
    const size = 32;
    const seedLength = 48;
    const randomSecretKey = (seed) => {
      seed = seed === undefined ? randomBytes(seedLength) : seed;
      return mapHashToField(abytes3(seed, seedLength, "seed"), secp256k1_CURVE.n);
    };
    return Object.freeze({
      keygen: createKeygen(randomSecretKey, schnorrGetPublicKey),
      getPublicKey: schnorrGetPublicKey,
      sign: schnorrSign,
      verify: schnorrVerify,
      Point: Pointk1,
      utils: Object.freeze({
        randomSecretKey,
        taggedHash,
        lift_x,
        pointToBytes
      }),
      lengths: Object.freeze({
        secretKey: size,
        publicKey: size,
        publicKeyHasPrefix: false,
        signature: size * 2,
        seed: seedLength
      })
    });
  })();

  // node_modules/@noble/hashes/legacy.js
  var Rho160 = /* @__PURE__ */ Uint8Array.from([
    7,
    4,
    13,
    1,
    10,
    6,
    15,
    3,
    12,
    0,
    9,
    5,
    2,
    14,
    11,
    8
  ]);
  var Id160 = /* @__PURE__ */ (() => Uint8Array.from(new Array(16).fill(0).map((_, i) => i)))();
  var Pi160 = /* @__PURE__ */ (() => Id160.map((i) => (9 * i + 5) % 16))();
  var idxLR = /* @__PURE__ */ (() => {
    const L = [Id160];
    const R = [Pi160];
    const res = [L, R];
    for (let i = 0;i < 4; i++)
      for (let j of res)
        j.push(j[i].map((k) => Rho160[k]));
    return res;
  })();
  var idxL = /* @__PURE__ */ (() => idxLR[0])();
  var idxR = /* @__PURE__ */ (() => idxLR[1])();
  var shifts160 = /* @__PURE__ */ [
    [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8],
    [12, 13, 11, 15, 6, 9, 9, 7, 12, 15, 11, 13, 7, 8, 7, 7],
    [13, 15, 14, 11, 7, 7, 6, 8, 13, 14, 13, 12, 5, 5, 6, 9],
    [14, 11, 12, 14, 8, 6, 5, 5, 15, 12, 15, 14, 9, 9, 8, 6],
    [15, 12, 13, 13, 9, 5, 8, 6, 14, 11, 12, 11, 8, 6, 5, 5]
  ].map((i) => Uint8Array.from(i));
  var shiftsL160 = /* @__PURE__ */ idxL.map((idx, i) => idx.map((j) => shifts160[i][j]));
  var shiftsR160 = /* @__PURE__ */ idxR.map((idx, i) => idx.map((j) => shifts160[i][j]));
  var Kl160 = /* @__PURE__ */ Uint32Array.from([
    0,
    1518500249,
    1859775393,
    2400959708,
    2840853838
  ]);
  var Kr160 = /* @__PURE__ */ Uint32Array.from([
    1352829926,
    1548603684,
    1836072691,
    2053994217,
    0
  ]);
  function ripemd_f(group, x, y, z) {
    if (group === 0)
      return x ^ y ^ z;
    if (group === 1)
      return x & y | ~x & z;
    if (group === 2)
      return (x | ~y) ^ z;
    if (group === 3)
      return x & z | y & ~z;
    return x ^ (y | ~z);
  }
  var BUF_160 = /* @__PURE__ */ new Uint32Array(16);

  class _RIPEMD160 extends HashMD {
    h0 = 1732584193 | 0;
    h1 = 4023233417 | 0;
    h2 = 2562383102 | 0;
    h3 = 271733878 | 0;
    h4 = 3285377520 | 0;
    constructor() {
      super(64, 20, 8, true);
    }
    get() {
      const { h0, h1, h2, h3, h4 } = this;
      return [h0, h1, h2, h3, h4];
    }
    set(h0, h1, h2, h3, h4) {
      this.h0 = h0 | 0;
      this.h1 = h1 | 0;
      this.h2 = h2 | 0;
      this.h3 = h3 | 0;
      this.h4 = h4 | 0;
    }
    _cloneInto(to) {
      (to ||= new this.constructor).set(...this.get());
      return this._cloneIntoMeta(to);
    }
    process(view, offset) {
      for (let i = 0;i < 16; i++, offset += 4)
        BUF_160[i] = view.getUint32(offset, true);
      let al = this.h0 | 0, ar = al, bl = this.h1 | 0, br = bl, cl = this.h2 | 0, cr = cl, dl = this.h3 | 0, dr = dl, el = this.h4 | 0, er = el;
      for (let group = 0;group < 5; group++) {
        const rGroup = 4 - group;
        const hbl = Kl160[group], hbr = Kr160[group];
        const rl = idxL[group], rr = idxR[group];
        const sl = shiftsL160[group], sr = shiftsR160[group];
        for (let i = 0;i < 16; i++) {
          const tl = rotl(al + ripemd_f(group, bl, cl, dl) + BUF_160[rl[i]] + hbl, sl[i]) + el | 0;
          al = el, el = dl, dl = rotl(cl, 10) | 0, cl = bl, bl = tl;
        }
        for (let i = 0;i < 16; i++) {
          const tr = rotl(ar + ripemd_f(rGroup, br, cr, dr) + BUF_160[rr[i]] + hbr, sr[i]) + er | 0;
          ar = er, er = dr, dr = rotl(cr, 10) | 0, cr = br, br = tr;
        }
      }
      this.set(this.h1 + cl + dr | 0, this.h2 + dl + er | 0, this.h3 + el + ar | 0, this.h4 + al + br | 0, this.h0 + bl + cr | 0);
    }
    roundClean() {
      clean(BUF_160);
    }
    destroy() {
      this.destroyed = true;
      clean(this.buffer);
      this.set(0, 0, 0, 0, 0);
    }
  }
  var ripemd160 = /* @__PURE__ */ createHasher(() => new _RIPEMD160);

  // node_modules/@scure/bip32/index.js
  /*! scure-bip32 - MIT License (c) 2022 Patricio Palladino, Paul Miller (paulmillr.com) */
  var Point = /* @__PURE__ */ (() => secp256k1.Point)();
  var Fn = /* @__PURE__ */ (() => Point.Fn)();
  var base58check = /* @__PURE__ */ createBase58check(sha256);
  var MASTER_SECRET = /* @__PURE__ */ (() => {
    return Uint8Array.from("Bitcoin seed".split(""), (char) => char.charCodeAt(0));
  })();
  var BITCOIN_VERSIONS = { private: 76066276, public: 76067358 };
  var HARDENED_OFFSET = 2147483648;
  var MAX_DEPTH = 255;
  var hash160 = (data) => ripemd160(sha256(data));
  var fromU32 = (data) => createView(data).getUint32(0, false);
  var toU32 = (n, title = "number") => {
    if (typeof n !== "number")
      throw new TypeError(`"${title}" expected number, got type=${typeof n}`);
    if (!Number.isSafeInteger(n) || n < 0 || n > 2 ** 32 - 1)
      throw new RangeError(`"${title}" expected integer in range 0..2**32-1, got ${n}`);
    const buf = new Uint8Array(4);
    createView(buf).setUint32(0, n, false);
    return buf;
  };
  var validateVersions = (versions, title = "versions") => {
    if (!(typeof versions === "object" && versions !== null))
      throw new Error("versions must be an object");
    toU32(versions.private, `${title}.private`);
    toU32(versions.public, `${title}.public`);
    return versions;
  };

  class HDKey {
    get fingerprint() {
      if (!this._pubHash) {
        throw new Error("No publicKey set!");
      }
      return fromU32(this._pubHash);
    }
    get identifier() {
      return this._pubHash ? Uint8Array.from(this._pubHash) : undefined;
    }
    get pubKeyHash() {
      return this._pubHash ? Uint8Array.from(this._pubHash) : undefined;
    }
    get privateKey() {
      return this._privateKey ? Uint8Array.from(this._privateKey) : null;
    }
    get publicKey() {
      return this._publicKey ? Uint8Array.from(this._publicKey) : null;
    }
    get chainCode() {
      return this._chainCode ? Uint8Array.from(this._chainCode) : null;
    }
    get privateExtendedKey() {
      const priv = this._privateKey;
      if (!priv) {
        throw new Error("No private key");
      }
      return base58check.encode(this.serialize(this.versions.private, concatBytes(Uint8Array.of(0), priv)));
    }
    get publicExtendedKey() {
      if (!this._publicKey) {
        throw new Error("No public key");
      }
      return base58check.encode(this.serialize(this.versions.public, this._publicKey));
    }
    static fromMasterSeed(seed, versions = BITCOIN_VERSIONS) {
      abytes(seed);
      versions = validateVersions(versions);
      if (8 * seed.length < 128 || 8 * seed.length > 512) {
        throw new RangeError("HDKey: seed length must be between 128 and 512 bits; 256 bits is advised, got " + seed.length);
      }
      const I = hmac(sha512, MASTER_SECRET, seed);
      const privateKey = I.slice(0, 32);
      const chainCode = I.slice(32);
      return new HDKey({ versions, chainCode, privateKey });
    }
    static fromExtendedKey(base58key, versions = BITCOIN_VERSIONS) {
      versions = validateVersions(versions);
      const keyBuffer = base58check.decode(base58key);
      if (keyBuffer.length !== 78) {
        throw new Error(`HDKey: invalid extended key length: expected 78 bytes, got ${keyBuffer.length}`);
      }
      const keyView = createView(keyBuffer);
      const version = keyView.getUint32(0, false);
      const opt = {
        versions,
        depth: keyBuffer[4],
        parentFingerprint: keyView.getUint32(5, false),
        index: keyView.getUint32(9, false),
        chainCode: keyBuffer.slice(13, 45)
      };
      const key = keyBuffer.slice(45);
      const isPriv = key[0] === 0;
      if (version !== versions[isPriv ? "private" : "public"]) {
        throw new Error("Version mismatch");
      }
      if (isPriv) {
        return new HDKey({ ...opt, privateKey: key.slice(1) });
      } else {
        return new HDKey({ ...opt, publicKey: key });
      }
    }
    static fromJSON(json) {
      return HDKey.fromExtendedKey("xpriv" in json ? json.xpriv : json.xpub);
    }
    versions;
    depth = 0;
    index = 0;
    parentFingerprint = 0;
    _chainCode = null;
    _privateKey;
    _publicKey;
    _pubHash;
    constructor(opt) {
      if (!opt || typeof opt !== "object") {
        throw new Error("HDKey.constructor must not be called directly");
      }
      const depth = opt.depth ?? 0;
      const index = opt.index ?? 0;
      const parentFingerprint = opt.parentFingerprint ?? 0;
      if (!Number.isSafeInteger(depth) || depth < 0 || depth > MAX_DEPTH) {
        throw new RangeError("HDKey: depth must be an integer in range 0..255");
      }
      toU32(index, "index");
      toU32(parentFingerprint, "parentFingerprint");
      if (depth === 0 && (index !== 0 || parentFingerprint !== 0)) {
        throw new Error("HDKey: zero depth with non-zero index/parent fingerprint");
      }
      this.versions = opt.versions ? validateVersions(opt.versions) : BITCOIN_VERSIONS;
      this.depth = depth;
      if (opt.chainCode)
        abytes(opt.chainCode, 32);
      this._chainCode = opt.chainCode ? Uint8Array.from(opt.chainCode) : null;
      this.index = index;
      this.parentFingerprint = parentFingerprint;
      if (opt.publicKey && opt.privateKey) {
        throw new Error("HDKey: publicKey and privateKey at same time.");
      }
      if (opt.privateKey) {
        if (!secp256k1.utils.isValidSecretKey(opt.privateKey))
          throw new Error("Invalid private key");
        this._privateKey = Uint8Array.from(opt.privateKey);
        this._publicKey = secp256k1.getPublicKey(this._privateKey, true);
      } else if (opt.publicKey) {
        this._publicKey = Point.fromBytes(opt.publicKey).toBytes(true);
      } else {
        throw new Error("HDKey: no public or private key provided");
      }
      this._pubHash = hash160(this._publicKey);
    }
    derive(path) {
      if (!/^[mM]'?/.test(path)) {
        throw new Error('Path must start with "m" or "M"');
      }
      if (/^[mM]'?$/.test(path)) {
        return this;
      }
      const parts = path.replace(/^[mM]'?\//, "").split("/");
      if (parts.length > MAX_DEPTH - this.depth) {
        throw new Error("HDKey: path exceeds the serializable depth 255");
      }
      let child = this;
      for (const c of parts) {
        const m = /^(\d+)('?)$/.exec(c);
        const m1 = m && m[1];
        if (!m || m.length !== 3 || typeof m1 !== "string")
          throw new Error("invalid child index: " + c);
        let idx = +m1;
        if (!Number.isSafeInteger(idx) || idx >= HARDENED_OFFSET) {
          throw new Error("Invalid index");
        }
        if (m[2] === "'") {
          idx += HARDENED_OFFSET;
        }
        child = child.deriveChild(idx);
      }
      return child;
    }
    deriveChild(index) {
      return this._deriveChild(index);
    }
    _deriveChild(index, _I) {
      if (!this._publicKey || !this._chainCode) {
        throw new Error("No publicKey or chainCode set");
      }
      let data = toU32(index, "index");
      if (index >= HARDENED_OFFSET) {
        const priv = this._privateKey;
        if (!priv) {
          throw new Error("Could not derive hardened child key");
        }
        data = concatBytes(Uint8Array.of(0), priv, data);
      } else {
        data = concatBytes(this._publicKey, data);
      }
      const out = _I || hmac(sha512, this._chainCode, data);
      abytes(out, 64);
      const childTweak = out.slice(0, 32);
      const chainCode = out.slice(32);
      const opt = {
        versions: this.versions,
        chainCode,
        depth: this.depth + 1,
        parentFingerprint: this.fingerprint,
        index
      };
      if (opt.depth > MAX_DEPTH) {
        throw new Error("HDKey: depth exceeds the serializable value 255");
      }
      const retry = () => {
        const maxIndex = this._privateKey ? 2 ** 32 - 1 : HARDENED_OFFSET - 1;
        if (index >= maxIndex) {
          throw new Error(`HDKey: cannot retry child derivation at index ${index}`);
        }
        return this.deriveChild(index + 1);
      };
      const ctweak = Fn.fromBytes(childTweak, true);
      if (!Fn.isValid(ctweak))
        return retry();
      if (this._privateKey) {
        const added = Fn.create(Fn.fromBytes(this._privateKey) + ctweak);
        if (!Fn.isValidNot0(added))
          return retry();
        opt.privateKey = Fn.toBytes(added);
      } else {
        const point = Point.fromBytes(this._publicKey);
        const added = ctweak === 0n ? point : point.add(Point.BASE.multiply(ctweak));
        if (added.equals(Point.ZERO))
          return retry();
        opt.publicKey = added.toBytes(true);
      }
      return new HDKey(opt);
    }
    sign(hash) {
      if (!this._privateKey) {
        throw new Error("No privateKey set!");
      }
      abytes(hash, 32);
      return secp256k1.sign(hash, this._privateKey, { prehash: false });
    }
    verify(hash, signature) {
      abytes(hash, 32);
      abytes(signature, 64);
      if (!this._publicKey) {
        throw new Error("No publicKey set!");
      }
      return secp256k1.verify(signature, hash, this._publicKey, { prehash: false });
    }
    wipePrivateData() {
      if (this._privateKey) {
        this._privateKey.fill(0);
        this._privateKey = undefined;
      }
      return this;
    }
    toJSON() {
      return this.toPrivateJSON();
    }
    toPrivateJSON() {
      return {
        xpriv: this.privateExtendedKey,
        xpub: this.publicExtendedKey
      };
    }
    serialize(version, key) {
      if (!this._chainCode) {
        throw new Error("No chainCode set");
      }
      abytes(key, 33);
      return concatBytes(toU32(version, "version"), new Uint8Array([this.depth]), toU32(this.parentFingerprint, "parentFingerprint"), toU32(this.index, "index"), this._chainCode, key);
    }
  }

  // node_modules/@cashu/cashu-ts/lib/cashu-ts.es.js
  var S = class e extends Error {
    constructor(t, n) {
      super(t), this.name = "CTSError", n?.cause !== undefined && Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: n.cause,
        writable: true
      }), Object.setPrototypeOf(this, e.prototype);
    }
  };
  var C = class e extends S {
    constructor(t, n, r) {
      super(t, r), this.status = n, this.name = "HttpResponseError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var w = class e extends S {
    constructor(t, n) {
      super(t, n), this.name = "NetworkError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var T = class e extends w {
    constructor(t) {
      super(t), this.name = "CallerAbortError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var E = class e extends w {
    constructor(t, n) {
      super(t, n), this.name = "UncancellableReadError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var D = class e extends S {
    constructor(t) {
      super(t), this.name = "AmountError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var ee = class e extends S {
    constructor(t) {
      super(t), this.name = "AmountWithUnitError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var te = class e extends S {
    constructor(t, n) {
      let r = n?.refreshed ?? false, i = n?.cause === undefined ? r ? `Keyset '${t}' is not a keyset of this mint` : `Keyset '${t}' is not in the wallet snapshot and no refresh was attempted; call loadMint(true), or retry once the repair cooldown clears` : `Could not resolve unknown keyset '${t}': mint refresh failed`;
      super(i, n), this.keysetId = t, this.refreshed = r, this.name = "UnknownKeysetError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var ne = class e extends S {
    constructor(t, n, r) {
      super("Melt completed but its change could not be reconstructed; recover the proofs with this error's outputData and createMeltChangeProofs()", r), this.outputData = t, this.quote = n, this.name = "MeltChangeError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var re = class e extends S {
    constructor(t, n) {
      super(t ? "Mint rejected a stale keyset; the snapshot has been refreshed, re-prepare the operation" : "Mint rejected a stale keyset; refresh the snapshot (loadMint(true)) and re-prepare", n), this.repaired = t, this.name = "StaleKeysetError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var ie = class e extends C {
    constructor(t, n) {
      super(t, 429), this.retryAfterMs = n, this.name = "RateLimitError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  var ae = class e extends C {
    constructor(t, n) {
      super(n || "Unknown mint operation error", 400), this.code = t, this.name = "MintOperationError", Object.setPrototypeOf(this, e.prototype);
    }
  };
  function oe(e) {
    return e instanceof ae || e instanceof Error && e.name === "MintOperationError" && "code" in e;
  }
  var O = {
    error() {},
    warn() {},
    info() {},
    debug() {},
    trace() {},
    log() {}
  };
  function se(e, t = O, n) {
    throw t.error(e, n), new S(e);
  }
  function k(e, t, n = O, r) {
    e && se(t, n, r);
  }
  function ce(e, t, n = O, r) {
    e ?? se(t, n, r);
  }
  function A(e, t, n = O, r) {
    if (e)
      try {
        let i = e(t);
        i && typeof i.then == "function" && i.catch((t) => {
          try {
            n.warn("callback failed", {
              ...r ?? {},
              error: t,
              cb: e.name ?? ""
            });
          } catch {}
        });
      } catch (t) {
        try {
          n.warn("callback failed", {
            ...r ?? {},
            error: t,
            cb: e.name ?? ""
          });
        } catch {}
      }
  }
  var le = 8192;
  var ue = 1e4;
  var de = 1024;
  var fe = 1024;
  var pe = 16384;
  var me = 2147483647;
  var he = 2n ** 64n - 1n;
  function Ce() {
    let e = Date.now();
    return { elapsed: () => Date.now() - e };
  }
  var we = new TextDecoder("utf-8", {
    ignoreBOM: true,
    fatal: true
  });
  function Te(e) {
    try {
      return we.decode(e);
    } catch (e) {
      throw new S("Malformed UTF-8 sequence", { cause: e });
    }
  }
  var Ee = new TextDecoder("utf-8", { fatal: true });
  function De(e) {
    let t;
    try {
      t = Ee.decode(e);
    } catch (e) {
      throw new S("Malformed UTF-8 sequence", { cause: e });
    }
    return t.charCodeAt(0) === 65279 ? t.slice(1) : t;
  }
  var Oe = /[\uD800-\uDFFF]/u;
  function ke(e) {
    return Oe.test(e);
  }
  function Ae(e, t) {
    if (t.has(e))
      throw TypeError("Cannot initialize the same private elements twice on an object");
  }
  function je(e, t, n) {
    Ae(e, t), t.set(e, n);
  }
  function Me(e) {
    "@babel/helpers - typeof";
    return Me = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
      return typeof e;
    } : function(e) {
      return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
    }, Me(e);
  }
  function Ne(e) {
    if (Object(e) !== e)
      throw TypeError("right-hand side of 'in' should be an object, got " + (e === null ? "null" : Me(e)));
    return e;
  }
  var Pe;
  var Fe = false;
  var Ie = /* @__PURE__ */ new WeakMap;
  Pe = Symbol.toPrimitive;
  var j = class e {
    constructor(e) {
      if (je(this, Ie, true), e < 0n)
        throw new D(`Amount must be >= 0, got ${e}`);
      if (e > he)
        throw new D(`Amount exceeds u64 max, got ${e}`);
      this.value = e, Object.freeze(this);
    }
    static from(t) {
      if (t instanceof e) {
        if (!Ie.has(Ne(t)))
          throw new D("Invalid Amount instance");
        return t;
      }
      if (typeof t == "bigint") {
        if (t < 0n)
          throw new D(`Amount must be >= 0, got ${t}`);
        return new e(t);
      }
      if (typeof t == "number") {
        if (!Number.isFinite(t) || !Number.isInteger(t))
          throw new D(`Invalid number amount: ${t}`);
        if (t < 0)
          throw new D(`Amount must be >= 0, got ${t}`);
        if (!Number.isSafeInteger(t))
          throw new D(`Unsafe integer amount: ${t}. Use bigint or decimal string.`);
        return new e(BigInt(t));
      }
      if (typeof t == "string") {
        if (t.length > 20)
          throw new D(`Amount exceeds u64 max: "${t.slice(0, 20)}..."`);
        if (!/^(0|[1-9]\d*)$/.test(t))
          throw new D(`Invalid amount string "${t}". Expected non-negative decimal integer.`);
        return new e(BigInt(t));
      }
      if (typeof t == "object" && t && typeof t.value == "bigint")
        return new e(t.value);
      throw new D("Unsupported amount input type");
    }
    static zero() {
      return new e(0n);
    }
    static one() {
      return new e(1n);
    }
    toBigInt() {
      return this.value;
    }
    toNumber() {
      if (!this.isSafeNumber())
        throw new D(`Amount ${this.value} exceeds Number.MAX_SAFE_INTEGER; use toBigInt/toString/toJSON.`);
      return Number(this.value);
    }
    toNumberUnsafe() {
      return Number(this.value);
    }
    toString() {
      return this.value.toString(10);
    }
    toJSON() {
      return this.toString();
    }
    [Pe](e) {
      return e === "string" ? this.toString() : (Fe || (Fe = true, console.warn("Implicit numeric coercion of Amount is deprecated and throws in cashu-ts v5; use .add()/.subtract()/.compareTo(), .toBigInt() or .toNumber(), or .toString() for display.")), this.toNumberUnsafe());
    }
    add(t) {
      let n = e.from(t);
      return new e(this.value + n.value);
    }
    subtract(t) {
      let n = e.from(t), r = this.value - n.value;
      if (r < 0n)
        throw new D(`Amount underflow: ${this.value} - ${n.value} would be negative`);
      return new e(r);
    }
    multiplyBy(t) {
      let n = e.from(t).value;
      return new e(this.value * n);
    }
    divideBy(t) {
      let n = e.from(t).value;
      if (n <= 0n)
        throw new D(`Divisor must be > 0, got ${n}`);
      return new e(this.value / n);
    }
    modulo(t) {
      let n = e.from(t).value;
      if (n <= 0n)
        throw new D(`Divisor must be > 0, got ${n}`);
      return new e(this.value % n);
    }
    ceilPercent(t, n = 100) {
      if (!Number.isSafeInteger(t) || t < 0)
        throw new D(`ceilPercent: numerator must be a non-negative integer, got ${t}`);
      if (!Number.isSafeInteger(n) || n <= 0)
        throw new D(`ceilPercent: denominator must be a positive integer, got ${n}`);
      let r = BigInt(t), i = BigInt(n);
      return new e((this.value * r + (i - 1n)) / i);
    }
    floorPercent(t, n = 100) {
      if (!Number.isSafeInteger(t) || t < 0)
        throw new D(`floorPercent: numerator must be a non-negative integer, got ${t}`);
      if (!Number.isSafeInteger(n) || n <= 0)
        throw new D(`floorPercent: denominator must be a positive integer, got ${n}`);
      let r = BigInt(t), i = BigInt(n);
      return new e(this.value * r / i);
    }
    inRange(t, n) {
      let r = e.from(t), i = e.from(n);
      if (r.greaterThan(i))
        throw new D(`inRange: min (${r.toString()}) must be <= max (${i.toString()})`);
      return this.greaterThanOrEqual(r) && this.lessThanOrEqual(i);
    }
    clamp(t, n) {
      let r = e.from(t), i = e.from(n);
      if (r.greaterThan(i))
        throw new D(`clamp: min (${r.toString()}) must be <= max (${i.toString()})`);
      return e.max(r, e.min(i, this));
    }
    scaledBy(t, n) {
      let r = e.from(t).value, i = e.from(n).value;
      if (i === 0n)
        throw new D("scaledBy: denominator must be > 0");
      return r === 0n ? e.zero() : new e((2n * this.value * r + i) / (2n * i));
    }
    isSafeNumber() {
      let e = BigInt(2 ** 53 - 1);
      return this.value <= e;
    }
    isZero() {
      return this.value === 0n;
    }
    equals(t) {
      return this.value === e.from(t).value;
    }
    compareTo(t) {
      let n = e.from(t).value;
      return this.value < n ? -1 : +(this.value > n);
    }
    lessThan(e) {
      return this.compareTo(e) < 0;
    }
    lessThanOrEqual(e) {
      return this.compareTo(e) <= 0;
    }
    greaterThan(e) {
      return this.compareTo(e) > 0;
    }
    greaterThanOrEqual(e) {
      return this.compareTo(e) >= 0;
    }
    static min(t, n) {
      let r = e.from(t), i = e.from(n);
      return r.compareTo(i) <= 0 ? r : i;
    }
    static max(t, n) {
      let r = e.from(t), i = e.from(n);
      return r.compareTo(i) >= 0 ? r : i;
    }
    static sum(t) {
      let n = 0n;
      for (let r of t)
        n += e.from(r).value;
      return new e(n);
    }
    withUnit(e) {
      return new Le(this, e);
    }
  };
  var Le = class e {
    constructor(e, t) {
      if (typeof t != "string" || t.length === 0)
        throw new ee("unit required");
      this._amount = e, this.unit = t, Object.freeze(this);
    }
    static from(t, n) {
      return new e(j.from(t), n);
    }
    static zero(t) {
      return new e(j.zero(), t);
    }
    static one(t) {
      return new e(j.one(), t);
    }
    toAmount() {
      return this._amount;
    }
    toBigInt() {
      return this._amount.toBigInt();
    }
    toNumber() {
      return this._amount.toNumber();
    }
    toString() {
      return `[${this.unit}]: ${this._amount.toString()}`;
    }
    toJSON() {
      return {
        amount: this._amount.toString(),
        unit: this.unit
      };
    }
    [Symbol.toPrimitive](e) {
      if (e === "string")
        return this.toString();
      throw new ee(`Implicit ${e === "number" ? "numeric" : "default"} coercion of AmountWithUnit is unsafe; use .toAmount() then explicit arithmetic, or .toString() for display.`);
    }
    isZero() {
      return this._amount.isZero();
    }
    isSafeNumber() {
      return this._amount.isSafeNumber();
    }
    requireSameUnit(e) {
      if (this.unit !== e.unit)
        throw new ee(`unit mismatch: ${this.unit} vs ${e.unit}`);
    }
    add(t) {
      return this.requireSameUnit(t), new e(this._amount.add(t._amount), this.unit);
    }
    subtract(t) {
      return this.requireSameUnit(t), new e(this._amount.subtract(t._amount), this.unit);
    }
    equals(e) {
      return this.requireSameUnit(e), this._amount.equals(e._amount);
    }
    compareTo(e) {
      return this.requireSameUnit(e), this._amount.compareTo(e._amount);
    }
    lessThan(e) {
      return this.compareTo(e) < 0;
    }
    lessThanOrEqual(e) {
      return this.compareTo(e) <= 0;
    }
    greaterThan(e) {
      return this.compareTo(e) > 0;
    }
    greaterThanOrEqual(e) {
      return this.compareTo(e) >= 0;
    }
    inRange(e, t) {
      return this.requireSameUnit(e), this.requireSameUnit(t), this._amount.inRange(e._amount, t._amount);
    }
    clamp(t, n) {
      return this.requireSameUnit(t), this.requireSameUnit(n), new e(this._amount.clamp(t._amount, n._amount), this.unit);
    }
    multiplyBy(t) {
      return new e(this._amount.multiplyBy(t), this.unit);
    }
    divideBy(t) {
      return new e(this._amount.divideBy(t), this.unit);
    }
    modulo(t) {
      return new e(this._amount.modulo(t), this.unit);
    }
    ceilPercent(t, n) {
      return new e(this._amount.ceilPercent(t, n), this.unit);
    }
    floorPercent(t, n) {
      return new e(this._amount.floorPercent(t, n), this.unit);
    }
    scaledBy(t, n) {
      return new e(this._amount.scaledBy(t, n), this.unit);
    }
    static min(e, t) {
      return e.requireSameUnit(t), e.compareTo(t) <= 0 ? e : t;
    }
    static max(e, t) {
      return e.requireSameUnit(t), e.compareTo(t) >= 0 ? e : t;
    }
    static sum(t, n) {
      let r = n, i = 0n, a = false;
      for (let e of t) {
        if (r === undefined)
          r = e.unit;
        else if (e.unit !== r)
          throw new ee(`unit mismatch: ${r} vs ${e.unit}`);
        i += e._amount.toBigInt(), a = true;
      }
      if (r === undefined)
        throw new ee("cannot infer unit from empty sum");
      return new e(a ? j.from(i) : j.zero(), r);
    }
  };
  var M = Object.freeze({
    parse: Ke,
    stringify: Xe
  });
  var Re = 64;
  var ze;
  function Be(e) {
    return typeof e == "object" && !!e && !Array.isArray(e);
  }
  function Ve() {
    let e = globalThis.BigInt;
    return typeof e == "function" ? e : undefined;
  }
  function He(e) {
    if (!ze) {
      let t = e(String(2 ** 53 - 1));
      ze = {
        max: t,
        min: -t
      };
    }
    return ze;
  }
  var Ue = class {
    constructor(e, t, n, r) {
      this.src = e, this.strict = t, this.fallbackTo = n, this.bigIntCtor = r, this.i = 0;
    }
    parse() {
      let e = this.parseValue(0);
      if (this.skipWhitespace(), !this.isEnd())
        throw this.syntaxError("Unexpected trailing input");
      return e;
    }
    parseValue(e) {
      if (e > Re)
        throw this.syntaxError("JSON nesting exceeds the maximum depth");
      this.skipWhitespace();
      let t = this.peek();
      if (t === "{")
        return this.parseObject(e);
      if (t === "[")
        return this.parseArray(e);
      if (t === '"')
        return this.parseString();
      if (t === "-" || this.isDigit(t))
        return this.parseNumber();
      if (t === "t")
        return this.parseLiteral("true", true);
      if (t === "f")
        return this.parseLiteral("false", false);
      if (t === "n")
        return this.parseLiteral("null", null);
      throw this.syntaxError(`Unexpected token '${t || "EOF"}'`);
    }
    parseObject(e) {
      this.expect("{"), this.skipWhitespace();
      let t = {}, n = /* @__PURE__ */ new Set;
      if (this.peek() === "}")
        return this.expect("}"), t;
      for (;!this.isEnd(); ) {
        let r = this.parseString();
        if (this.strict && n.has(r))
          throw this.syntaxError(`Duplicate key "${r}"`);
        if (n.add(r), this.skipWhitespace(), this.expect(":"), Object.defineProperty(t, r, {
          value: this.parseValue(e + 1),
          writable: true,
          enumerable: true,
          configurable: true
        }), this.skipWhitespace(), this.peek() === "}")
          return this.expect("}"), t;
        this.expect(","), this.skipWhitespace();
      }
      throw this.syntaxError("Unterminated object");
    }
    parseArray(e) {
      this.expect("["), this.skipWhitespace();
      let t = [];
      if (this.peek() === "]")
        return this.expect("]"), t;
      for (;!this.isEnd(); ) {
        if (t.push(this.parseValue(e + 1)), this.skipWhitespace(), this.peek() === "]")
          return this.expect("]"), t;
        this.expect(","), this.skipWhitespace();
      }
      throw this.syntaxError("Unterminated array");
    }
    parseString() {
      this.expect('"');
      let e = "";
      for (;!this.isEnd(); ) {
        let t = this.next();
        if (t === '"')
          return e;
        if (t === "\\") {
          let t = this.next();
          switch (t) {
            case '"':
            case "\\":
            case "/":
              e += t;
              break;
            case "b":
              e += "\b";
              break;
            case "f":
              e += "\f";
              break;
            case "n":
              e += `
`;
              break;
            case "r":
              e += "\r";
              break;
            case "t":
              e += "\t";
              break;
            case "u": {
              let t = this.src.slice(this.i, this.i + 4);
              if (!/^[0-9a-fA-F]{4}$/.test(t))
                throw this.syntaxError("Invalid unicode escape");
              this.i += 4, e += String.fromCharCode(parseInt(t, 16));
              break;
            }
            default:
              throw this.syntaxError(`Invalid escape '\\${t}'`);
          }
          continue;
        }
        if (t < " ")
          throw this.syntaxError("Invalid control character in string");
        e += t;
      }
      throw this.syntaxError("Unterminated string");
    }
    parseNumber() {
      let e = this.i;
      this.peek() === "-" && (this.i += 1), this.peek() === "0" ? this.i += 1 : this.readDigits(), this.peek() === "." && (this.i += 1, this.readDigits());
      let t = this.peek();
      if (t === "e" || t === "E") {
        this.i += 1;
        let e = this.peek();
        (e === "+" || e === "-") && (this.i += 1), this.readDigits();
      }
      let n = this.src.slice(e, this.i);
      if (!(n.indexOf(".") === -1 && n.indexOf("e") === -1 && n.indexOf("E") === -1)) {
        let e = Number(n);
        if (!Number.isFinite(e))
          throw this.syntaxError("Bad number");
        return e;
      }
      if (!this.bigIntCtor)
        switch (this.fallbackTo) {
          case "number": {
            let e = Number(n);
            if (!Number.isFinite(e))
              throw this.syntaxError("Bad number");
            return e;
          }
          case "string":
            return n;
          case "error":
            throw new S("BigInt is not available in this runtime");
        }
      let r = this.bigIntCtor(n), { max: i, min: a } = He(this.bigIntCtor);
      return r > i || r < a ? r : Number(n);
    }
    parseLiteral(e, t) {
      if (this.src.slice(this.i, this.i + e.length) !== e)
        throw this.syntaxError(`Unexpected token near '${this.src.slice(this.i, this.i + 8)}'`);
      return this.i += e.length, t;
    }
    readDigits() {
      let e = this.i;
      for (;this.isDigit(this.peek()); )
        this.i += 1;
      if (this.i === e)
        throw this.syntaxError("Bad number");
    }
    skipWhitespace() {
      for (;!this.isEnd(); ) {
        let e = this.peek();
        if (e === " " || e === `
` || e === "\r" || e === "\t") {
          this.i += 1;
          continue;
        }
        break;
      }
    }
    expect(e) {
      if (this.next() !== e)
        throw this.syntaxError(`Expected '${e}'`);
    }
    peek() {
      return this.src.charAt(this.i);
    }
    next() {
      let e = this.src.charAt(this.i);
      return this.i += 1, e;
    }
    isDigit(e) {
      return e >= "0" && e <= "9";
    }
    isEnd() {
      return this.i >= this.src.length;
    }
    syntaxError(e) {
      return /* @__PURE__ */ SyntaxError(`${e} at position ${this.i}`);
    }
  };
  function We(e, t, n) {
    Reflect.defineProperty(e, t, {
      value: n,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  function Ge(e, t, n) {
    let r = Array.isArray(e) ? e[Number(t)] : e[t];
    if (Array.isArray(r))
      for (let e = 0;e < r.length; e += 1) {
        let t = Ge(r, String(e), n);
        t === undefined ? Reflect.deleteProperty(r, e) : We(r, String(e), t);
      }
    else if (Be(r))
      for (let e of Object.keys(r)) {
        let t = Ge(r, e, n);
        t === undefined ? delete r[e] : We(r, e, t);
      }
    return n.call(e, t, r);
  }
  function Ke(e, t, n) {
    let r = n?.strict === true, i = n?.fallbackTo ?? "number";
    if (i !== "number" && i !== "string" && i !== "error")
      throw new S(`Incorrect value for fallbackTo option, must be "number", "string", "error" or undefined but passed ${String(n?.fallbackTo)}`);
    let a = new Ue(String(e), r, i, Ve()).parse();
    return typeof t == "function" ? Ge({ "": a }, "", t) : a;
  }
  function qe(e) {
    let t = JSON.stringify(e);
    if (typeof t != "string")
      throw new S("Failed to stringify string value");
    return t;
  }
  function Je(e) {
    return typeof e == "object" && !!e && "toJSON" in e && typeof e.toJSON == "function";
  }
  function Ye(e) {
    return e instanceof Number || e instanceof String || e instanceof Boolean ? e.valueOf() : e;
  }
  function Xe(e, t, n) {
    let r = "", i = "", a = /* @__PURE__ */ new WeakSet;
    if (typeof n == "number" ? i = " ".repeat(Math.min(10, Math.max(0, Math.floor(n)))) : typeof n == "string" && (i = n.slice(0, 10)), t && typeof t != "function" && !Array.isArray(t))
      throw new S("stringify: replacer must be a function or array");
    let o = Array.isArray(t) ? Array.from(new Set(t.filter((e) => typeof e == "string" || typeof e == "number").map((e) => String(e)))) : undefined, s = (e, n) => {
      let c = e[n];
      switch (c instanceof j ? c = c.toBigInt() : Je(c) && (c = c.toJSON(n)), typeof t == "function" && (c = t.call(e, n, c)), c = Ye(c), typeof c) {
        case "string":
          return qe(c);
        case "number":
          return Number.isFinite(c) ? String(c) : "null";
        case "boolean":
          return c ? "true" : "false";
        case "bigint":
          return String(c);
        case "undefined":
          return;
        case "object": {
          if (c === null)
            return "null";
          if (a.has(c))
            throw TypeError("Converting circular structure to JSON");
          a.add(c);
          let e = r;
          r += i;
          try {
            if (Array.isArray(c)) {
              let t = [], n = c;
              for (let e = 0;e < c.length; e += 1) {
                let r = s(n, String(e));
                t.push(r ?? "null");
              }
              let i = t.length === 0 ? "[]" : r ? `[
${r}${t.join(`,
${r}`)}
${e}]` : `[${t.join(",")}]`;
              return r = e, i;
            }
            let t = c, n = o ?? Object.keys(t), i = [];
            for (let e of n) {
              let n = s(t, e);
              n !== undefined && i.push(`${qe(e)}${r ? ": " : ":"}${n}`);
            }
            let a = i.length === 0 ? "{}" : r ? `{
${r}${i.join(`,
${r}`)}
${e}}` : `{${i.join(",")}}`;
            return r = e, a;
          } finally {
            a.delete(c);
          }
        }
        default:
          return;
      }
    };
    return s({ "": e }, "");
  }
  function Ze(e) {
    return e.trim().replace(/[\t\n\f\r ]+/g, "").replace(/={1,2}$/, "");
  }
  function Qe(e) {
    return base64.encode(e);
  }
  function $e(e) {
    return base64urlnopad.encode(e);
  }
  function et(e) {
    return base64url.encode(e);
  }
  function tt(e) {
    try {
      return base64urlnopad.decode(Ze(e));
    } catch (e) {
      throw new S("Invalid base64url string", { cause: e });
    }
  }
  function nt(e) {
    try {
      return base64nopad.decode(Ze(e));
    } catch (e) {
      throw new S("Invalid base64 string", { cause: e });
    }
  }
  function rt(e) {
    try {
      return tt(e);
    } catch (t) {
      try {
        return nt(e);
      } catch {
        throw t;
      }
    }
  }
  function it(e) {
    let t = De(rt(e));
    return M.parse(t, undefined, { strict: true });
  }
  function at(e) {
    if (typeof e != "string" || e.length === 0)
      return false;
    let t = Ze(e);
    if (t.length === 0)
      return false;
    let n = /[-_]/.test(t) ? base64urlnopad : base64nopad;
    try {
      return n.encode(n.decode(t)) === t;
    } catch {
      return false;
    }
  }
  function dt(e) {
    return typeof e == "number" || typeof e == "bigint" || typeof e == "string";
  }
  function wt(e) {
    return Et(new DataView(e.buffer, e.byteOffset, e.byteLength), 0).value;
  }
  var Tt = 64;
  function Et(e, t, n = 0, r = { nodes: 0 }) {
    if (n > Tt)
      throw new S("CBOR nesting exceeds the maximum depth");
    if (t >= e.byteLength)
      throw new S("Unexpected end of data");
    let i = e.getUint8(t++), a = i >> 5, o = i & 31;
    switch (a) {
      case 0:
        return Ot(e, t, o);
      case 1:
        return kt(e, t, o);
      case 2:
        return At(e, t, o);
      case 3:
        return jt(e, t, o);
      case 4:
        return Nt(e, t, o, n, r);
      case 5:
        return Pt(e, t, o, n, r);
      case 7:
        return It(e, t, o);
      default:
        throw new S(`Unsupported major type: ${a}`);
    }
  }
  function N(e, t, n) {
    if (t + n > e.byteLength)
      throw new S("Unexpected end of data");
  }
  function Dt(e, t, n) {
    if (n < 24)
      return {
        value: n,
        offset: t
      };
    if (n === 24)
      return N(e, t, 1), {
        value: e.getUint8(t++),
        offset: t
      };
    if (n === 25) {
      N(e, t, 2);
      let n = e.getUint16(t, false);
      return t += 2, {
        value: n,
        offset: t
      };
    }
    if (n === 26) {
      N(e, t, 4);
      let n = e.getUint32(t, false);
      return t += 4, {
        value: n,
        offset: t
      };
    }
    if (n === 27) {
      N(e, t, 8);
      let n = e.getUint32(t, false), r = e.getUint32(t + 4, false);
      t += 8;
      let i = n * 2 ** 32 + r;
      return i > 2 ** 53 - 1 ? {
        value: BigInt(n) << 32n | BigInt(r),
        offset: t
      } : {
        value: i,
        offset: t
      };
    }
    throw new S(`Unsupported length: ${n}`);
  }
  function Ot(e, t, n) {
    let { value: r, offset: i } = Dt(e, t, n);
    return {
      value: r,
      offset: i
    };
  }
  function kt(e, t, n) {
    let { value: r, offset: i } = Dt(e, t, n);
    if (typeof r == "bigint")
      return {
        value: -1n - r,
        offset: i
      };
    let a = -1 - r;
    return Number.isSafeInteger(a) ? {
      value: a,
      offset: i
    } : {
      value: -1n - BigInt(r),
      offset: i
    };
  }
  function At(e, t, n) {
    let { value: r, offset: i } = Dt(e, t, n), a = Number(r);
    if (i + a > e.byteLength)
      throw new S("Byte string length exceeds data length");
    return {
      value: new Uint8Array(e.buffer, e.byteOffset + i, a),
      offset: i + a
    };
  }
  function jt(e, t, n) {
    let { value: r, offset: i } = Dt(e, t, n), a = Number(r);
    if (i + a > e.byteLength)
      throw new S("String length exceeds data length");
    return {
      value: Te(new Uint8Array(e.buffer, e.byteOffset + i, a)),
      offset: i + a
    };
  }
  function Mt(e) {
    if (e.nodes++, e.nodes > 262144)
      throw new S("CBOR payload exceeds the maximum item/entry budget");
  }
  function Nt(e, t, n, r, i) {
    let { value: a, offset: o } = Dt(e, t, n), s = Number(a), c = [], l = o;
    for (let t = 0;t < s; t++) {
      Mt(i);
      let t = Et(e, l, r + 1, i);
      c.push(t.value), l = t.offset;
    }
    return {
      value: c,
      offset: l
    };
  }
  function Pt(e, t, n, r, i) {
    let { value: a, offset: o } = Dt(e, t, n), s = Number(a), c = {}, l = o;
    for (let t = 0;t < s; t++) {
      Mt(i);
      let t = Et(e, l, r + 1, i);
      if (!dt(t.value))
        throw new S("Invalid key type");
      let n = String(t.value);
      if (Object.prototype.hasOwnProperty.call(c, n))
        throw new S(`Duplicate map key "${n}"`);
      let a = Et(e, t.offset, r + 1, i);
      Object.defineProperty(c, n, {
        value: a.value,
        writable: true,
        enumerable: true,
        configurable: true
      }), l = a.offset;
    }
    return {
      value: c,
      offset: l
    };
  }
  function Ft(e) {
    let t = (e & 31744) >> 10, n = e & 1023, r = e & 32768 ? -1 : 1;
    return t === 0 ? r * 2 ** -14 * (n / 1024) : t === 31 ? n ? NaN : r * Infinity : r * 2 ** (t - 15) * (1 + n / 1024);
  }
  function It(e, t, n) {
    if (n < 24)
      switch (n) {
        case 20:
          return {
            value: false,
            offset: t
          };
        case 21:
          return {
            value: true,
            offset: t
          };
        case 22:
          return {
            value: null,
            offset: t
          };
        case 23:
          return {
            value: undefined,
            offset: t
          };
        default:
          throw new S(`Unknown simple value: ${n}`);
      }
    if (n === 24) {
      N(e, t, 1);
      let n = e.getUint8(t++);
      if (n < 32)
        throw new S(`Invalid extended simple value: ${n}`);
      return {
        value: n,
        offset: t
      };
    }
    if (n === 25) {
      N(e, t, 2);
      let n = Ft(e.getUint16(t, false));
      return t += 2, {
        value: n,
        offset: t
      };
    }
    if (n === 26) {
      N(e, t, 4);
      let n = e.getFloat32(t, false);
      return t += 4, {
        value: n,
        offset: t
      };
    }
    if (n === 27) {
      N(e, t, 8);
      let n = e.getFloat64(t, false);
      return t += 8, {
        value: n,
        offset: t
      };
    }
    throw new S(`Unknown simple or float value: ${n}`);
  }
  var zt = utf8ToBytes("Secp256k1_HashToCurve_Cashu_");
  function Bt(t) {
    let i = sha256(concatBytes(zt, t)), a = 0, o = new Uint8Array(4), s = new DataView(o.buffer), c = 2 ** 16;
    for (let t = 0;t < c; t++) {
      s.setUint32(0, a, true);
      let t = sha256(concatBytes(i, o));
      try {
        return P(bytesToHex(concatBytes(new Uint8Array([2]), t)));
      } catch {
        a++;
      }
    }
    throw new S("No valid point found");
  }
  function Vt(t) {
    let n = t.map((e) => e.toHex(false)).join("");
    return sha256(new TextEncoder().encode(n));
  }
  function P(e) {
    return secp256k1.Point.fromHex(e);
  }
  var Gt = (e) => {
    let t, n = (e) => bytesToNumberBE(rt(e)) % BigInt(2 ** 31 - 1);
    if (e.length === 12 && at(e))
      t = n(e);
    else if (U(e))
      t = Bi(e) % BigInt(2 ** 31 - 1);
    else if (at(e))
      t = n(e);
    else
      throw new S("Invalid keyset id: neither hex nor base64");
    return t;
  };
  function Kt() {
    return secp256k1.utils.randomSecretKey();
  }
  function Yt(e, t) {
    let n = Bt(e);
    if (t === undefined)
      t = secp256k1.Point.Fn.fromBytes(Kt());
    else if (t === 0n)
      throw new S("Blinding factor r must be non-zero");
    let r = secp256k1.Point.BASE.multiply(t);
    return {
      B_: n.add(r),
      r: t,
      secret: e
    };
  }
  function Xt(e, t, n) {
    return e.subtract(n.multiply(t));
  }
  function Zt(e, t, n, r) {
    let i = Xt(e.C_, t, r);
    return {
      id: e.id,
      secret: n,
      C: i
    };
  }
  function Qt(t, r = false) {
    if (ke(t))
      throw new S("Message must be well-formed UTF-16");
    let i = sha256(new TextEncoder().encode(t));
    return r ? bytesToHex(i) : i;
  }
  var $t = (e, t) => {
    let r = typeof e == "string" ? hexToBytes(e) : e, a = typeof t == "string" ? hexToBytes(t) : t;
    return bytesToHex(schnorr.sign(r, a));
  };
  var en = (e, t) => $t(Qt(e), t);
  var tn = (e, t, n, r = false) => {
    try {
      return nn(e, Qt(t), n, r);
    } catch (e) {
      if (r)
        throw e;
    }
    return false;
  };
  var nn = (e, t, n, r = false) => {
    try {
      let r = typeof t == "string" ? hexToBytes(t) : t;
      return schnorr.verify(hexToBytes(e), r, hexToBytes(rn(n)));
    } catch (e) {
      if (r)
        throw e;
    }
    return false;
  };
  function rn(e) {
    if (typeof e != "string")
      return e;
    let t = e.toLowerCase();
    return t.length === 66 && (t.startsWith("02") || t.startsWith("03")) ? t.slice(2) : t;
  }
  function an(e, t) {
    let r = Array.isArray(t) ? t : [t], a = e.toLowerCase();
    for (let e of r) {
      let t = bytesToHex(secp256k1.getPublicKey(hexToBytes(e), true));
      if (t === a)
        return e;
      if (t.slice(2) === a.slice(2)) {
        let t = secp256k1.Point.Fn.fromBytes(hexToBytes(e));
        return bytesToHex(secp256k1.Point.Fn.toBytes(secp256k1.Point.Fn.neg(t)));
      }
    }
    throw new S(`No private key matches quote pubkey ${e}`);
  }
  function dn(e) {
    return secp256k1.getPublicKey(e, true);
  }
  function F(e) {
    let t;
    if (typeof e == "string" && ke(e))
      throw new S("Invalid NUT-10 secret Unicode");
    try {
      t = typeof e == "string" ? JSON.parse(e) : e;
    } catch (e) {
      throw new S("Can't parse secret", { cause: e });
    }
    if (!Array.isArray(t) || t.length !== 2 || typeof t[0] != "string" || typeof t[1] != "object" || t[0].trim().length === 0 || t[1] === null)
      throw new S("Invalid NUT-10 secret");
    let [n, r] = t;
    if (typeof r.nonce != "string" || typeof r.data != "string")
      throw new S("Invalid NUT-10 secret nonce / data");
    if (r.tags != null) {
      if (!Array.isArray(r.tags))
        throw new S("Invalid NUT-10 secret tags");
      if (r.tags.some((e) => !Array.isArray(e) || e.length === 0 || e.some((e) => typeof e != "string" || !e.length)))
        throw new S("Invalid NUT-10 tag(s)");
    }
    return [n, {
      nonce: r.nonce,
      data: r.data,
      tags: r.tags ?? undefined
    }];
  }
  function hn(e, t) {
    let n = Array.isArray(e) ? e : [e], r = F(t), i = r[0];
    if (!n.includes(i))
      throw new S(`Invalid secret kind: ${i} Allowed: ${n.join(", ")}`);
    return r;
  }
  function gn(e) {
    return F(e)[0];
  }
  function _n(e) {
    return F(e)[1];
  }
  function vn(e) {
    let { data: t } = _n(e);
    return t;
  }
  function yn(e) {
    let { tags: t } = _n(e);
    return t ?? [];
  }
  function xn(e, t) {
    let n = yn(e).find((e) => e[0] === t);
    if (!(!n || n.length <= 1))
      return n.slice(1);
  }
  function Sn(e, t) {
    let n = xn(e, t);
    if (n !== undefined) {
      if (n.length !== 1)
        throw new S(`Invalid NUT-10 tag "${t}": must carry a single value`);
      return n[0];
    }
  }
  function I(e, t) {
    let n = Sn(e, t);
    if (n === undefined)
      return;
    let r = /^-?\d+$/.test(n) ? Number(n) : NaN;
    if (!Number.isSafeInteger(r))
      throw new S(`Invalid NUT-10 tag "${t}": must be an integer`);
    return r;
  }
  var Cn = utf8ToBytes("Cashu_P2BK_v1");
  var wn = Cn.slice();
  function Tn(e, t, r = true) {
    let i = +!r, a = e.length + i;
    if (a > 11)
      throw new S(`Too many pubkeys, ${a} slots provided, maximum allowed is 11 in total`);
    if (!e.length)
      return {
        blinded: [],
        Ehex: ""
      };
    t = t ?? secp256k1.utils.randomSecretKey();
    let o = secp256k1.Point.Fn.fromBytes(t), s = secp256k1.getPublicKey(t, true);
    return {
      blinded: e.map((e, t) => {
        let n = P(e), r = On(n, o, t + i), a = n.add(secp256k1.Point.BASE.multiply(r));
        if (a.equals(secp256k1.Point.ZERO))
          throw new S("Blinded key at infinity");
        return a.toHex(true);
      }),
      Ehex: bytesToHex(s)
    };
  }
  function En(e, t, n, r = true) {
    let a = +!r, o = Array.isArray(t) ? t : [t], s = Array.isArray(n) ? n : [n], c = /* @__PURE__ */ new Set, l = secp256k1.Point.fromHex(e);
    for (let e of o) {
      let t = secp256k1.Point.Fn.fromBytes(hexToBytes(e)), n = secp256k1.getPublicKey(hexToBytes(e), true);
      s.forEach((r, o) => {
        let s = Dn(e, On(l, t, o + a), hexToBytes(r), n);
        s && c.add(s);
      });
    }
    return Array.from(c);
  }
  function Dn(e, t, r, i) {
    let a = secp256k1.Point.CURVE().n, o = typeof e == "string" ? Bi(e) : e, s = typeof t == "string" ? Bi(t) : t;
    if (o <= 0n || o >= a)
      throw new S("Invalid private key");
    if (s <= 0n || s >= a)
      throw new S("Invalid scalar r");
    if (i = i ?? secp256k1.Point.BASE.multiply(o).toBytes(true), i.length !== 33)
      throw new S("naturalPub must be 33 bytes");
    let c = (o + s) % a, l = (a - o + s) % a;
    if (!r) {
      if (c === 0n)
        throw new S("Derived secret key is zero");
      return Vi(c);
    }
    if (r.length !== 33)
      throw new S("blindPubkey must be 33 bytes");
    let u = secp256k1.Point.fromHex(bytesToHex(r)), d = secp256k1.Point.BASE.multiply(s), f = u.subtract(d);
    if (f.equals(secp256k1.Point.ZERO) || !equalBytes(f.toBytes(true).slice(1), i.slice(1)))
      return null;
    let p = (f.toBytes(true)[0] & 1) == (i[0] & 1) ? c : l;
    if (p === 0n)
      throw new S("Derived secret key is zero");
    return Vi(p);
  }
  function On(t, n, i) {
    if (!Number.isInteger(i) || i < 0 || i > 255)
      throw new S("P2BK: slot index must be an integer in [0, 255]");
    let a = t.multiply(n).toBytes(true).slice(1), o = new Uint8Array([i & 255]), s = bytesToNumberBE(sha256(concatBytes(Cn, a, o)));
    if ((s === 0n || s >= secp256k1.Point.CURVE().n) && (s = bytesToNumberBE(sha256(concatBytes(Cn, a, o, new Uint8Array([255])))), s === 0n || s >= secp256k1.Point.CURVE().n))
      throw new S("P2BK: tweak derivation failed");
    return s;
  }
  var kn = {
    SIG_INPUTS: "SIG_INPUTS",
    SIG_ALL: "SIG_ALL"
  };
  var An = new Set(Object.values(kn));
  var jn = new Set([
    "locktime",
    "pubkeys",
    "n_sigs",
    "refund",
    "n_sigs_refund",
    "sigflag"
  ]);
  function Mn(e) {
    return jn.has(e);
  }
  function L(e) {
    if (typeof e == "string" && e.length > 1024)
      throw new S(`Secret too long (${e.length} characters), maximum is ${fe}`);
    let t = hn(["P2PK", "HTLC"], e);
    Zn(yn(t));
    let n = Sn(t, "sigflag");
    return n !== undefined && Qn(n), t;
  }
  function Pn(e) {
    let t = e.toLowerCase();
    if (t.length === 66 && (t.startsWith("02") || t.startsWith("03")))
      return t;
    if (t.length === 64)
      return `02${t}`;
    throw new S(`Invalid pubkey, expected 33 byte compressed or 32 byte x only, got length ${t.length}`);
  }
  function R(e) {
    let t = /* @__PURE__ */ new Set, n = [];
    for (let r of e) {
      let e = Pn(r), i = e.slice(-64);
      t.has(i) || (t.add(i), n.push(e));
    }
    return n;
  }
  function Fn2(e) {
    let t = R(Array.isArray(e.pubkey) ? e.pubkey : [e.pubkey]), n = R(e.refundKeys ?? []), r = typeof e.hashlock == "string" && e.hashlock.length > 0;
    if (t.length === 0 && !r)
      throw new S("P2PK requires at least one pubkey");
    let i = +!!r + t.length + n.length;
    if (i > 11)
      throw new S(`Too many pubkeys, ${i} slots provided, maximum allowed is 11 in total`);
    e.sigFlag !== undefined && Qn(e.sigFlag);
    let a = t.length > 0 ? e.requiredSignatures ?? 1 : e.requiredSignatures, o = e.requiredRefundSignatures;
    return er({
      mainKeyCount: t.length,
      refundKeyCount: n.length,
      nSigs: a,
      nSigsRefund: o,
      hasLocktime: e.locktime !== undefined
    }), {
      pubkey: t.length === 1 ? t[0] : t,
      ...e.locktime === undefined ? {} : { locktime: e.locktime },
      ...n.length > 0 ? { refundKeys: n } : {},
      ...a !== undefined && a > 1 ? { requiredSignatures: a } : {},
      ...o !== undefined && o > 1 ? { requiredRefundSignatures: o } : {},
      ...e.additionalTags?.length ? { additionalTags: e.additionalTags } : {},
      ...e.blindKeys ? { blindKeys: true } : {},
      ...e.sigFlag === undefined ? {} : { sigFlag: e.sigFlag },
      ...e.hashlock ? { hashlock: e.hashlock } : {}
    };
  }
  function In(e) {
    let t = L(e), n = ir(rr(t)), r = tr(t), i = nr(t);
    return n === "ACTIVE" || n === "PERMANENT" ? r : n === "EXPIRED" && i.length ? Array.from(new Set([...r, ...i])) : [];
  }
  function Ln(e, t, r = Math.floor(Date.now() / 1000)) {
    let a = L(e.secret), o = tr(a), s = nr(a), c = rr(a);
    er({
      mainKeyCount: o.length,
      refundKeyCount: s.length,
      nSigs: I(a, "n_sigs"),
      nSigsRefund: I(a, "n_sigs_refund"),
      hasLocktime: Number.isFinite(c)
    });
    let l = e.p2pk_e === undefined ? t : qn(t, e), u = new Set(l.map((e) => bytesToHex(dn(hexToBytes(e))).slice(2))), d = (e) => e.filter((e) => u.has(e.slice(2))).length, f = (e, t) => t.length ? Math.max(I(a, e) ?? 1, 1) : 0;
    return gn(a) !== "HTLC" && d(o) >= f("n_sigs", o) ? true : Number.isFinite(c) && r > c && d(s) >= f("n_sigs_refund", s);
  }
  function Rn(e) {
    return Sn(L(e), "sigflag") ?? "SIG_INPUTS";
  }
  function zn(e) {
    let t = Bn(e)?.signatures ?? [];
    if (t.length > 64)
      throw new S(`Too many witness signatures: ${t.length}`);
    return t;
  }
  function Bn(e) {
    if (!e)
      return;
    if (typeof e == "string" && e.length > 16384)
      throw new S(`Witness too long (${e.length} characters), maximum is ${pe}`);
    let t;
    try {
      t = typeof e == "string" ? JSON.parse(e) : e;
    } catch {
      return;
    }
    if (!t || typeof t != "object")
      return;
    let n = { signatures: Array.isArray(t.signatures) ? t.signatures : [] };
    return typeof t.preimage == "string" && t.preimage.length > 0 && (n.preimage = t.preimage), n;
  }
  function Vn(e, t, r = O, i) {
    let a = (e) => typeof e == "string" ? e : bytesToHex(e), o = Array.isArray(t) ? t.map(a) : a(t);
    return e.map((e, t) => {
      let n = qn(o, e), a = e;
      for (let e of n)
        try {
          a = Un(a, e, i);
        } catch (e) {
          let n = e instanceof Error ? e.message : "Unknown error";
          r.warn(`Proof #${t + 1}: ${n}`);
        }
      return a;
    });
  }
  function Hn(e, t) {
    let r = typeof t == "string" ? hexToBytes(t) : t, a = bytesToHex(schnorr.getPublicKey(r));
    if (!In(e).some((e) => e.slice(2) === a))
      throw new S(`Signature not required from [02|03]${a}`);
    return a;
  }
  function Un(e, t, n) {
    let r = L(e.secret), i = Rn(r) === "SIG_ALL";
    if (i && n === undefined)
      throw new S("Cannot sign a SIG_ALL proof without the message to sign");
    if (!i && n !== undefined)
      throw new S("A message override is only valid for SIG_ALL proofs");
    n = n ?? e.secret;
    let a = Hn(r, t), o = zn(e.witness);
    if (o.some((e) => tn(e, n, a)))
      throw new S(`Proof already signed by [02|03]${a}`);
    if (o.length >= 64)
      throw new S("Cannot sign: witness already at the 64-signature limit");
    let s = en(n, t), c = Bn(e.witness), l = {
      ...c && c.preimage !== undefined ? { preimage: c.preimage } : {},
      signatures: [...c?.signatures ?? [], s]
    };
    return {
      ...e,
      witness: l
    };
  }
  function qn(e, t) {
    let n = Array.isArray(e) ? e : [e], r = t?.p2pk_e;
    if (!r)
      return Array.from(new Set(n));
    let i = L(t.secret), a = [...tr(i), ...nr(i)], o = gn(i) === "P2PK", s = En(r, n, a, o);
    return !o && !s.length ? En(r, n, a) : s;
  }
  function Jn(e) {
    if (e.length === 0)
      throw new S("No proofs");
    let t = L(e[0].secret);
    if (Rn(t) !== "SIG_ALL")
      throw new S("First proof is not SIG_ALL");
    let n = t[1].data, r = JSON.stringify(t[1].tags ?? []);
    for (let i = 1;i < e.length; i++) {
      let a = L(e[i].secret);
      if (a[0] !== t[0])
        throw new S(`Proof #${i + 1} is not ${t[0]}`);
      if (Rn(a) !== "SIG_ALL")
        throw new S(`Proof #${i + 1} is not SIG_ALL`);
      if (a[1].data !== n)
        throw new S("SIG_ALL inputs must share identical Secret.data");
      if (JSON.stringify(a[1].tags ?? []) !== r)
        throw new S("SIG_ALL inputs must share identical Secret.tags");
    }
  }
  function Yn(e, t, n) {
    let r = [];
    for (let t of e)
      r.push(t.secret, t.C);
    for (let e of t)
      r.push(String(e.blindedMessage.amount), e.blindedMessage.B_);
    return n && r.push(n), r.join("");
  }
  function Xn(e) {
    return e.some((e) => {
      try {
        return Rn(e.secret) === "SIG_ALL";
      } catch {
        return false;
      }
    });
  }
  function Zn(e) {
    let t = /* @__PURE__ */ new Set;
    for (let n of e) {
      let e = n[0];
      if (Mn(e)) {
        if (t.has(e))
          throw new S(`Duplicate P2PK tag "${e}"`);
        t.add(e);
      }
    }
  }
  function Qn(e) {
    if (!An.has(e))
      throw new S(`Invalid sigflag "${e}": must be "SIG_INPUTS" or "SIG_ALL"`);
  }
  function $n(e, t) {
    if (!Number.isInteger(e) || e < 1)
      throw new S(`${t} must be a positive integer, got ${e}`);
    return e;
  }
  function er(e) {
    let { mainKeyCount: t, refundKeyCount: n, nSigs: r, nSigsRefund: i, hasLocktime: a } = e;
    if (r !== undefined && ($n(r, "requiredSignatures (n_sigs)"), r > t))
      throw new S(`requiredSignatures (n_sigs) (${r}) exceeds available pubkeys (${t})`);
    if (i !== undefined) {
      if ($n(i, "requiredRefundSignatures (n_sigs_refund)"), n === 0)
        throw new S("requiredRefundSignatures (n_sigs_refund) requires refund keys");
      if (i > n)
        throw new S(`requiredRefundSignatures (n_sigs_refund) (${i}) exceeds available refund keys (${n})`);
    }
    if (n > 0 && !a)
      throw new S("refund keys require a locktime");
  }
  function tr(e) {
    let t = gn(e) === "P2PK" ? vn(e) : "", n = xn(e, "pubkeys") ?? [];
    if (n.length > 16)
      throw new S(`Too many pubkeys: ${n.length}`);
    let r = (t ? [t, ...n] : n).map((e) => Pn(e));
    if (R(r).length !== r.length)
      throw new S("Duplicate main pubkeys are not allowed");
    return r;
  }
  function nr(e) {
    let t = xn(e, "refund") ?? [];
    if (t.length > 16)
      throw new S(`Too many refund pubkeys: ${t.length}`);
    let n = t.map((e) => Pn(e));
    if (R(n).length !== n.length)
      throw new S("Duplicate refund pubkeys are not allowed");
    return n;
  }
  function rr(e) {
    let t = Sn(e, "locktime"), n = t !== undefined && /^\d+$/.test(t) ? Number(t) : NaN;
    return Number.isSafeInteger(n) ? n : Infinity;
  }
  function ir(e, t = Math.floor(Date.now() / 1000)) {
    return Number.isFinite(e) ? t <= e ? "ACTIVE" : "EXPIRED" : "PERMANENT";
  }
  var sr = utf8ToBytes("Cashu_DLEQ_R_v1");
  var lr = (e, t, n, r) => {
    let i = secp256k1.Point.Fn.fromBytes(e.s), a = secp256k1.Point.Fn.fromBytes(e.e), o = secp256k1.Point.BASE.multiply(i), s = r.multiply(a), c = t.multiply(i), l = n.multiply(a);
    return equalBytes(Vt([
      o.subtract(s),
      c.subtract(l),
      r,
      n
    ]), e.e);
  };
  var ur = (e, t, n, r) => {
    if (t.r === undefined)
      throw new S("verifyDLEQProof_reblind: Undefined blinding factor");
    let i = Bt(e), a = n.add(r.multiply(t.r)), o = secp256k1.Point.BASE.multiply(t.r);
    return lr(t, i.add(o), a, r);
  };
  var fr = "m/129372'/0'";
  var pr = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
  var mr = /* @__PURE__ */ function(e) {
    return e[e.SECRET = 0] = "SECRET", e[e.BLINDING_FACTOR = 1] = "BLINDING_FACTOR", e;
  }(mr || {});
  var hr = /* @__PURE__ */ function(e) {
    return e[e.DEPRECATED_BIP32 = 0] = "DEPRECATED_BIP32", e[e.HMAC_SHA256 = 1] = "HMAC_SHA256", e;
  }(hr || {});
  function vr(e, t, n) {
    return yr(e, t)(n);
  }
  function yr(e, t) {
    switch (xr(e), br(t)) {
      case hr.DEPRECATED_BIP32: {
        let n = Gt(t), r = HDKey.fromMasterSeed(e).derive(`${fr}/${n}'`);
        return (e) => Sr(r, e);
      }
      case hr.HMAC_SHA256:
        return (n) => Cr(e, t, n);
    }
  }
  function br(e) {
    if (e.length === 12 && at(e))
      return hr.DEPRECATED_BIP32;
    let t = /^[a-fA-F0-9]+$/.test(e), n = e.startsWith("01");
    if (t && n && e.length % 2 != 0)
      throw new S("Invalid hex string: odd length.");
    if (!t && at(e) || t && e.startsWith("00"))
      return hr.DEPRECATED_BIP32;
    if (t && n)
      return hr.HMAC_SHA256;
    throw new S(`Unrecognized keyset ID version ${e.slice(0, 2)}`);
  }
  function xr(e) {
    if (!(e instanceof Uint8Array) || e.length < 16 || e.length > 64)
      throw new S("seed must be a 16 to 64 byte Uint8Array");
  }
  function Sr(e, t) {
    if (!Number.isInteger(t) || t < 0 || t >= 2147483648)
      throw new S("Counter must be an integer in the range 0 <= counter < 2^31");
    let n = e.deriveChild(HARDENED_OFFSET + t), r = n.deriveChild(0).privateKey, i = n.deriveChild(1).privateKey;
    if (r === null || i === null)
      throw new S("Could not derive private key");
    return {
      secret: r,
      blindingFactor: i
    };
  }
  function Cr(e, t, n) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new S("Counter must be an integer in the range 0 <= counter <= 2^53 - 1");
    return {
      secret: wr(e, t, n, mr.SECRET),
      blindingFactor: wr(e, t, n, mr.BLINDING_FACTOR)
    };
  }
  function wr(t, n, a, s) {
    let c = concatBytes(utf8ToBytes("Cashu_KDF_HMAC_SHA256"), hexToBytes(n), numberToBytesBE(a, 8));
    switch (s) {
      case mr.SECRET:
        c = concatBytes(c, hexToBytes("00"));
        break;
      case mr.BLINDING_FACTOR:
        c = concatBytes(c, hexToBytes("01"));
    }
    let l = hmac(sha256, t, c);
    if (s === mr.BLINDING_FACTOR) {
      let e = bytesToNumberBE(l), t = e >= pr ? e - pr : e;
      if (t === 0n)
        throw new S("Derived invalid blinding scalar r == 0");
      return numberToBytesBE(t, 32);
    }
    return l;
  }
  var Mr = utf8ToBytes("Cashu_MintQuoteSig_v1");
  function Nr(e) {
    let t = j.from(e.amount).toBigInt();
    if (t === 0n)
      return new Uint8Array;
    let n = t.toString(16);
    return hexToBytes(n.length % 2 == 1 ? "0" + n : n);
  }
  function Pr(t, n) {
    let r = sha256.create();
    r.update(Mr);
    let a = utf8ToBytes(t);
    r.update(numberToBytesBE(a.length, 4)), r.update(a);
    for (let e of n) {
      let t = Nr(e);
      r.update(numberToBytesBE(t.length, 4)), r.update(t);
      let n = hexToBytes(e.B_);
      r.update(numberToBytesBE(n.length, 4)), r.update(n);
    }
    return r.digest();
  }
  function Fr(t, n) {
    let r = t;
    for (let e of n)
      r += e.B_;
    return sha256(utf8ToBytes(r));
  }
  function Lr(e, t, n) {
    return $t(Fr(t, n), e);
  }
  function zr(e, t, n) {
    return $t(Pr(t, n), e);
  }
  function Fi(e) {
    let t = e?.kind === "HTLC";
    if (!e || e.kind !== "P2PK" && !t)
      return;
    if (!e.data)
      throw new S(`NUT-10 ${e.kind} option is missing its data field`);
    let n = L([e.kind, {
      nonce: "",
      data: e.data,
      tags: e.tags ?? []
    }]), r = xn(n, "pubkeys") ?? [], i = [e.data, ...r], a = t ? {
      hashlock: e.data.toLowerCase(),
      pubkey: r
    } : { pubkey: i.length === 1 ? i[0] : i };
    a.locktime = I(n, "locktime"), a.refundKeys = xn(n, "refund"), a.requiredSignatures = I(n, "n_sigs"), a.requiredRefundSignatures = I(n, "n_sigs_refund"), Sn(n, "sigflag") === "SIG_ALL" && (a.sigFlag = "SIG_ALL");
    let o = (e.tags ?? []).filter((e) => e.length > 0 && !Mn(e[0]));
    return o.length > 0 && (a.additionalTags = o), a;
  }
  function H(e, t, n, r) {
    let i = zi(e, "splitAmount.value", true), a = n?.map((e) => zi(e, "splitAmount.split", true));
    if (a) {
      if (a.length > 8192)
        throw new S(`Cannot split amount: split would exceed ${le} outputs`);
      let e = j.sum(a);
      if (i.isZero() && e.isZero())
        return a;
      let n = a.filter((e) => !e.isZero()), r = j.sum(n);
      if (r.greaterThan(i))
        throw new S(`Split is greater than total amount: ${r.toString()} > ${i.toString()}`);
      if (n.some((e) => !Ri(e, t)))
        throw new S("Provided amount preferences do not match the amounts of the mint keyset.");
      if (r.equals(i))
        return n;
      a = n, i = i.subtract(r);
    } else
      a = [];
    let o = Li(t, "desc");
    if (o.length === 0)
      throw new S("Cannot split amount, keyset is inactive or contains no keys");
    for (let e of o) {
      if (e.isZero())
        continue;
      let t = i.divideBy(e), n = le - a.length;
      if (n <= 0 || t.greaterThan(n))
        throw new S(`Cannot split amount: fill would exceed ${le} outputs`);
      let r = t.toNumber();
      for (let t = 0;t < r; t++)
        a.push(e);
      if (i = i.subtract(e.multiplyBy(t)), i.isZero())
        break;
    }
    if (!i.isZero())
      throw new S(`Unable to split remaining amount: ${i.toString()}`);
    return r && (a = a.sort((e, t) => r === "desc" ? t.compareTo(e) : e.compareTo(t))), a;
  }
  function Li(e, t) {
    let n = Object.keys(e).map((e) => j.from(e));
    return n.sort((e, n) => t === "desc" ? n.compareTo(e) : e.compareTo(n)), n;
  }
  function Ri(e, t) {
    let n = zi(e, "hasCorrespondingKey.amount", true).toString();
    return Object.prototype.hasOwnProperty.call(t, n);
  }
  function zi(e, t, n = false) {
    let r = j.from(e);
    if (!n && r.isZero())
      throw new S(`Amount must be positive: ${r.toString()}, op: ${t}`);
    return r;
  }
  function Bi(e) {
    return e ? BigInt(`0x${e}`) : 0n;
  }
  function Vi(e) {
    return e.toString(16).padStart(64, "0");
  }
  function U(e) {
    return typeof e == "string" && e.length % 2 == 0 && /^[a-f0-9]+$/i.test(e);
  }
  function Yi(e, t) {
    if (!(e instanceof Uint8Array) || e.length === 0)
      throw new S(`Invalid token: ${t} must be a non-empty byte string`);
    return bytesToHex(e);
  }
  function Xi(e, t) {
    if (typeof e != "string" || e.length === 0)
      throw new S(`Invalid token: ${t} must be a non-empty string`);
    return e;
  }
  function Zi(e) {
    return e != null && e.e != null && e.s != null && e.r != null;
  }
  function Qi(e) {
    if (!e || !Array.isArray(e.t))
      throw new S("Invalid token");
    let t = Xi(e.m, "mint"), n = e.u ? Xi(e.u, "unit") : "sat", r = e.d ? Xi(e.d, "memo") : undefined, i = [];
    return e.t.forEach((e) => {
      if (!e || !Array.isArray(e.p))
        throw new S("Invalid token");
      e.p.forEach((t) => {
        let n = Yi(e.i, "keyset id"), r = Xi(t.s, "secret"), a = t.w ? Xi(t.w, "witness") : undefined;
        i.push({
          secret: r,
          C: Yi(t.c, "proof C"),
          amount: j.from(t.a),
          id: n,
          ...Zi(t.d) && { dleq: {
            r: Yi(t.d.r, "dleq r"),
            s: Yi(t.d.s, "dleq s"),
            e: Yi(t.d.e, "dleq e")
          } },
          ...t.pe && { p2pk_e: Yi(t.pe, "p2pk_e") },
          ...a && { witness: a }
        });
      });
    }), {
      mint: t,
      proofs: i,
      unit: n,
      ...r && { memo: r }
    };
  }
  function $i(e, t) {
    if (!Array.isArray(t))
      throw new S("getDecodedToken requires keysetIds (the wallet keyset id list) as its second argument; see the v4 migration guide, or use wallet.decodeToken()");
    let n = ta(ya(e));
    return n.proofs = ma(n.proofs, t), n;
  }
  function ta(e) {
    let t = e.slice(0, 1), n = e.slice(1);
    if (t === "A") {
      let e = it(n);
      if (!e || !Array.isArray(e.token))
        throw new S("Invalid token");
      if (e.token.length > 1)
        throw new S("Multi entry token are not supported");
      let t = e.token[0];
      if (!t || !Array.isArray(t.proofs))
        throw new S("Invalid token");
      let r = t.proofs.map((e) => {
        let { dleq: t, ...n } = e;
        return {
          ...n,
          amount: j.from(e.amount),
          ...t?.r && t.s && t.e && { dleq: t }
        };
      }), i = {
        mint: t.mint,
        proofs: r,
        unit: e.unit || "sat"
      };
      return e.memo && (i.memo = e.memo), i;
    } else if (t === "B")
      return Qi(wt(rt(n)));
    throw new S("Token version is not supported");
  }
  var na = /^[a-z0-9_-]+$/;
  var ia = (e) => `v${e + 1}`;
  function W(e, t) {
    let n = U(e) ? Number.parseInt(e.slice(0, 2), 16) : -1;
    k(n > 1, `Keyset '${e}' is a ${ia(n)} keyset; this build of cashu-ts supports up to ${ia(1)}. Upgrade to use this keyset.`, t, {
      keysetId: e,
      versionByte: n,
      supported: 1
    });
  }
  function aa(t, r) {
    for (let e of Object.keys(t))
      if (e.length > 20)
        throw new S("Invalid keyset denomination: exceeds 20 digits");
    let a = r?.unit ?? "sat", s = r?.expiry, c = r?.versionByte ?? 1, l = r?.input_fee_ppk;
    if (r?.isDeprecatedBase64 ?? false)
      return Qe(sha256(utf8ToBytes(Object.entries(t).sort(([e], [t]) => j.from(e).compareTo(t)).map(([, e]) => e).reduce((e, t) => e + t, "")))).slice(0, 12);
    switch (c) {
      case 0:
        return "00" + bytesToHex(sha256(oa(...Object.entries(t).sort(([e], [t]) => j.from(e).compareTo(t)).map(([, e]) => hexToBytes(e))))).slice(0, 14);
      case 1: {
        if (!a)
          throw new S("Cannot compute keyset ID version 01: unit is required.");
        if (!na.test(a.toLowerCase()))
          throw new S(`Invalid keyset unit: ${a}`);
        let r = Object.entries(t).sort(([e], [t]) => j.from(e).compareTo(t)).map(([e, t]) => `${e}:${t}`).join(",");
        return r += `|unit:${a}`, l && (r += `|input_fee_ppk:${l}`), s && (r += `|final_expiry:${s}`), "01" + bytesToHex(sha256(utf8ToBytes(r)));
      }
      default:
        throw new S(`Unrecognized keyset ID version: ${c}`);
    }
  }
  function oa(...e) {
    let t = e.reduce((e, t) => e + t.length, 0), n = new Uint8Array(t), r = 0;
    for (let t of e)
      n.set(t, r), r += t.length;
    return n;
  }
  function G(e) {
    return typeof e == "object" && !!e;
  }
  function K(e) {
    return G(e) && !Array.isArray(e);
  }
  function ca(e, ...t) {
    for (let n of t)
      e[n] === undefined && (e[n] = null);
  }
  function q(...e) {
    return e.map((e) => e.replace(/(^\/+|\/+$)/g, "")).join("/");
  }
  function la(e) {
    let t;
    try {
      t = new URL(e);
    } catch (t) {
      throw new S(`Invalid mint URL: ${e}`, { cause: t });
    }
    if (t.protocol !== "http:" && t.protocol !== "https:")
      throw new S(`Invalid mint URL scheme: ${t.protocol}`);
    if (t.username || t.password)
      throw new S("Mint URL must not contain credentials");
    if (t.search || t.href.includes("?"))
      throw new S("Mint URL must not contain query parameters");
    if (t.hash || t.href.includes("#"))
      throw new S("Mint URL must not contain a fragment");
    if (/%[0-9a-f]{2}/i.test(t.pathname))
      throw new S("Mint URL path must not contain percent-encoded characters");
    return t.href.replace(/\/+$/, "");
  }
  function J(e) {
    return j.sum(e.map((e) => e.amount));
  }
  function Y(e) {
    return e.map((e) => ({
      ...e,
      amount: j.from(e.amount)
    }));
  }
  function ua(e) {
    return (Array.isArray(e) ? e : [e]).map((e) => M.stringify(e));
  }
  function ma(e, t) {
    let n = [...new Set(t.map((e) => e.toLowerCase()))], r = [];
    for (let t of e) {
      let e;
      try {
        e = hexToBytes(t.id);
      } catch {
        r.push(t);
        continue;
      }
      if (e[0] === 0)
        r.push(t);
      else if (e[0] === 1) {
        if (!n.length)
          throw new S("A short keyset ID v2 was encountered, but got no keysets to map it to.");
        let e = t.id.toLowerCase(), i = n.filter((t) => e === t.slice(0, e.length));
        if (i.length > 1)
          throw new S(`Short keyset ID ${t.id} is ambiguous.`);
        if (i.length === 0)
          throw new S(`Couldn't map short keyset ID ${t.id} to any known keysets of the current Mint`);
        t.id = i[0], r.push(t);
      } else
        throw new S(`Unknown keyset ID version: ${e[0]}`);
    }
    return r;
  }
  function ha(e, t, n) {
    let r = n?.require ?? true;
    if (!Ri(e.amount, t.keys))
      throw new S(Object.keys(t.keys).length === 0 ? `No keys loaded for keyset ${t.id}` : `Undefined key for amount ${e.amount.toString()} in keyset ${t.id}`);
    if (e?.dleq == null)
      return !r;
    if (e.dleq.r == null)
      return false;
    let a = t.keys[e.amount.toString()];
    try {
      let t = {
        e: hexToBytes(e.dleq.e),
        s: hexToBytes(e.dleq.s),
        r: Bi(e.dleq.r)
      };
      return ur(new TextEncoder().encode(e.secret), t, P(e.C), P(a));
    } catch {
      return false;
    }
  }
  function ga(e, t) {
    return ha(e, t, { require: false });
  }
  function ya(e) {
    for (let t of [
      "web+cashu://",
      "cashu://",
      "cashu:"
    ])
      if (e.startsWith(t)) {
        e = e.slice(t.length);
        break;
      }
    return e.startsWith("cashu") && (e = e.slice(5)), e;
  }
  function ba(e) {
    try {
      return Ca(e) !== null;
    } catch {
      return false;
    }
  }
  var xa = {
    m: 100000000n,
    u: 100000n,
    n: 100n
  };
  var Sa = 100000000000n;
  function Ca(e) {
    if (typeof e != "string")
      throw new S("BOLT11 invoice must be a string");
    let t = e.toLowerCase(), n = t.lastIndexOf("1");
    if (!t.startsWith("ln") || n < 3 || n > 100 || n === t.length - 1)
      throw new S("Invalid BOLT11 invoice");
    let r = /^ln[a-z]+?(\d*)([munp]?)$/.exec(t.slice(0, n));
    if (!r)
      throw new S("Invalid BOLT11 invoice");
    let [, i, a] = r;
    if (i === "")
      return null;
    if (i.startsWith("0"))
      throw new S("Invalid BOLT11 amount");
    let o = BigInt(i);
    if (a === "")
      return o * Sa;
    if (a === "p") {
      if (o % 10n != 0n)
        throw new S("Invalid BOLT11 amount");
      return o / 10n;
    }
    return o * xa[a];
  }
  function wa(e) {
    if (typeof e != "string")
      throw new S("BOLT11 invoice must be a string");
    let t;
    try {
      ({ words: t } = bech32.decode(e.toLowerCase(), false));
    } catch (e) {
      throw new S("Invalid BOLT11 invoice", { cause: e });
    }
    let r = t.length - 104;
    for (let e = 7;e + 3 <= r; ) {
      let i = t[e], a = t[e + 1] << 5 | t[e + 2], o = e + 3 + a;
      if (o > r)
        break;
      if (i === 1 && a === 52)
        try {
          return bytesToHex(bech32.fromWords(t.slice(e + 3, o)));
        } catch (e) {
          throw new S("Invalid BOLT11 payment hash", { cause: e });
        }
      e = o;
    }
    throw new S("BOLT11 invoice has no payment hash");
  }
  function Ta(t, r) {
    let a = wa(t);
    return /^[0-9a-fA-F]{64}$/.test(r) && bytesToHex(sha256(hexToBytes(r))) === a;
  }
  function Ea(e) {
    let t = e ?? 32;
    if (!Number.isSafeInteger(t) || t < 1)
      throw new S("chunkSize must be a positive safe integer");
    return t;
  }
  function Da(e) {
    let t = e ?? 50;
    if (!Number.isFinite(t) || t < 0)
      throw new S("budgetMs must be a finite, non-negative number");
    return t;
  }
  async function Oa() {
    let e = globalThis;
    if (typeof e.scheduler?.yield == "function")
      return e.scheduler.yield();
    if (typeof e.MessageChannel == "function") {
      await new Promise((t) => {
        let { port1: n, port2: r } = new e.MessageChannel;
        n.onmessage = () => {
          n.close(), t();
        }, r.postMessage(null);
      });
      return;
    }
    await new Promise((e) => setTimeout(e, 0));
  }
  async function ka(e, t, n) {
    let r = Ea(n?.chunkSize), i = Da(n?.budgetMs), a = e.length, o = Array(a), s = () => {
      if (n?.signal?.aborted)
        throw new T("Operation aborted by caller");
    };
    s();
    let c = performance.now(), l = 0;
    for (let u = 0;u < a; u++)
      o[u] = t(e[u], u), l++, u + 1 !== a && (l >= r || performance.now() - c >= i) && (n?.onProgress?.(u + 1, a), await Oa(), s(), c = performance.now(), l = 0);
    return n?.onProgress?.(a, a), o;
  }
  function Aa(e) {
    return e instanceof Error ? e.message : String(e);
  }
  function ja(e, t, n) {
    let r;
    try {
      r = {
        ...e,
        amount: j.from(e.amount)
      };
    } catch (t) {
      return new S(`Invalid amount ${String(e.amount)} in keyset ${e.id}`, { cause: t });
    }
    let a;
    try {
      a = t(r.id);
    } catch (e) {
      return new S(Aa(e), { cause: e });
    }
    if (Object.keys(a.keys).length === 0)
      return new S(`No keys loaded for keyset ${a.id}`);
    let o = a.keys[r.amount.toString()];
    if (!o)
      return new S(`Undefined key for amount ${r.amount.toString()} in keyset ${a.id}`);
    let s = () => new S(`${n ? "Token contains proofs with invalid or missing DLEQ" : "Token contains a proof with an invalid DLEQ"} (keyset ${r.id}, amount ${r.amount.toString()})`);
    if (r.dleq == null)
      return n ? s() : undefined;
    if (r.dleq.r == null)
      return s();
    try {
      return ur(new TextEncoder().encode(r.secret), {
        e: hexToBytes(r.dleq.e),
        s: hexToBytes(r.dleq.s),
        r: Bi(r.dleq.r)
      }, P(r.C), P(o)) ? undefined : s();
    } catch {
      return s();
    }
  }
  async function Ma(e, t, n) {
    if (e.length > 1e4)
      throw new S(`Token contains too many proofs: ${e.length}, maximum is ${ue}`);
    let r = n?.require ?? false, i = await ka(e, (e) => ja(e, t, r), {
      chunkSize: Ea(n?.chunkSize),
      budgetMs: Da(n?.budgetMs),
      signal: n?.signal,
      onProgress: n?.onProgress
    }), a = {
      valid: [],
      invalid: []
    };
    return i.forEach((t, n) => {
      t ? a.invalid.push({
        proof: e[n],
        error: t
      }) : a.valid.push(e[n]);
    }), a;
  }
  function Na(e, t, n) {
    return Ma(e, t, n);
  }
  function Fa(e, t, n, r) {
    let i = e.payment_preimage ?? null;
    if (typeof i != "string") {
      i !== null && n.warn("Mint returned a payment_preimage that is not a string", { op: r }), e.payment_preimage = null;
      return;
    }
    e.payment_preimage = t === "bolt11" && typeof e.request == "string" ? Ia(e.request, i, n, r) : i;
  }
  function Ia(e, t, n, r) {
    let i;
    try {
      i = Ta(e, t);
    } catch (e) {
      return n.debug("Melt quote request is not a parseable BOLT11 invoice", {
        op: r,
        err: e
      }), t;
    }
    return i ? t : (n.warn("Mint returned a payment_preimage that does not match the invoice", { op: r }), null);
  }
  function X(e, t, n) {
    if (e == null) {
      if (arguments.length >= 3)
        return n;
      throw new S(`Invalid ${t}: missing value`);
    }
    try {
      return j.from(e).toNumber();
    } catch (e) {
      throw new S(`Invalid ${t}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
  function La(e) {
    return {
      ...e,
      input_fee_ppk: X(e.input_fee_ppk, "keyset.input_fee_ppk", undefined),
      final_expiry: X(e.final_expiry, "keyset.final_expiry", undefined)
    };
  }
  function Ra(e) {
    return {
      ...e,
      input_fee_ppk: X(e.input_fee_ppk, "keys.input_fee_ppk", undefined),
      final_expiry: X(e.final_expiry, "keys.final_expiry", undefined)
    };
  }
  function za(e, t) {
    let n;
    try {
      n = new URL(e).protocol;
    } catch {
      throw new S(`OIDCAuth: ${t} is not a valid URL`);
    }
    if (n !== "https:" && n !== "http:")
      throw new S(`OIDCAuth: ${t} must be an http(s) URL`);
    return n;
  }
  var Ba = class t {
    static fromMintInfo(e, n) {
      let r = e?.nuts?.["21"];
      if (!r?.openid_discovery)
        throw new S("OIDCAuth: mint does not advertise NUT-21 openid_discovery");
      let i = n?.clientId ?? r.client_id ?? "cashu-client";
      return new t(r.openid_discovery, {
        ...n,
        clientId: i
      });
    }
    constructor(e, t) {
      this.tokenListeners = [], this.inflightRefreshes = /* @__PURE__ */ new Map, this.discoveryUrl = e, this.secureDiscovery = e.startsWith("https:"), this.logger = t?.logger ?? O, this.clientId = t?.clientId ?? "cashu-client", this.scope = t?.scope ?? "openid", this.onTokens = t?.onTokens;
    }
    setClient(e) {
      this.clientId = e;
    }
    setScope(e) {
      this.scope = e ?? "openid";
    }
    addTokenListener(e) {
      this.tokenListeners = [...this.tokenListeners, e];
    }
    removeTokenListener(e) {
      this.tokenListeners = this.tokenListeners.filter((t) => t !== e);
    }
    async loadConfig() {
      if (this.config)
        return this.config;
      let e = await fetch(this.discoveryUrl, {
        method: "GET",
        headers: { Accept: "application/json" }
      }), t = await e.text(), n, r;
      try {
        n = t ? JSON.parse(t) : undefined;
      } catch (e) {
        r = e, this.logger.warn("OIDCAuth: bad discovery JSON", { err: e });
      }
      if (!e.ok || !n)
        throw new S("OIDCAuth: invalid discovery document", { cause: r });
      let i = n;
      if (typeof i.token_endpoint != "string" || i.token_endpoint.length === 0)
        throw new S("OIDCAuth: invalid discovery document, missing token_endpoint");
      return this.assertEndpoint(i.token_endpoint, "token_endpoint"), this.config = i, i;
    }
    assertEndpoint(e, t) {
      let n = za(e, t);
      this.secureDiscovery && n !== "https:" && this.logger.warn(`OIDCAuth: ${t} is not https although discovery is; v5 rejects this`, { label: t });
    }
    generatePKCE() {
      let t = $e(randomBytes(48));
      return {
        verifier: t,
        challenge: $e(sha256(utf8ToBytes(t)))
      };
    }
    async buildAuthCodeUrl(e) {
      let t = await this.loadConfig(), n = e.scope ?? this.scope, r = e.codeChallengeMethod;
      r !== undefined && r !== "S256" && this.logger.warn(`OIDCAuth: codeChallengeMethod '${typeof r == "string" ? r : typeof r}' is not supported by cashu-ts v5, which accepts S256 only.`);
      let i = new URLSearchParams({
        response_type: "code",
        client_id: this.clientId,
        redirect_uri: e.redirectUri,
        scope: n,
        code_challenge_method: e.codeChallengeMethod ?? "S256",
        code_challenge: e.codeChallenge
      });
      if (e.state && i.set("state", e.state), !t.authorization_endpoint)
        throw new S("OIDCAuth: discovery lacks authorization_endpoint");
      return this.assertEndpoint(t.authorization_endpoint, "authorization_endpoint"), `${t.authorization_endpoint}?${i.toString()}`;
    }
    async exchangeAuthCode(e) {
      let t = await this.loadConfig(), n = this.toForm({
        grant_type: "authorization_code",
        code: e.code,
        redirect_uri: e.redirectUri,
        client_id: this.clientId,
        code_verifier: e.codeVerifier
      }), r = await this.postFormStrict(t.token_endpoint, n);
      return this.handleTokens(r, "signin"), r;
    }
    async deviceStart() {
      let e = (await this.loadConfig()).device_authorization_endpoint;
      if (!e)
        throw new S("OIDCAuth: provider lacks device_authorization_endpoint");
      this.assertEndpoint(e, "device_authorization_endpoint");
      let t = this.toForm({
        client_id: this.clientId,
        scope: this.scope
      }), n = await this.postFormStrict(e, t);
      return za(n.verification_uri, "verification_uri"), n.verification_uri_complete !== undefined && za(n.verification_uri_complete, "verification_uri_complete"), n;
    }
    async devicePoll(e, t = 5) {
      let n = await this.loadConfig(), r = Number(t), i = Number.isFinite(r) ? Math.max(1, r) : 5;
      for (;; ) {
        await this.sleep(i * 1000);
        let t = this.toForm({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: e,
          client_id: this.clientId
        }), r = await this.postFormLoose(n.token_endpoint, t);
        if (r.access_token)
          return this.handleTokens(r, "signin", this.tokenListeners), r;
        let a = (r.error ?? "").toString();
        if (a !== "authorization_pending") {
          if (a === "slow_down") {
            i = Math.max(i + 5, i * 2);
            continue;
          }
          throw new S(`OIDCAuth: ${r.error_description || a || "device authorization failed"}`);
        }
      }
    }
    async startDeviceAuth(e = 5) {
      let t = await this.deviceStart(), n = Number(t.interval), r = Number.isFinite(n) && n > 0 ? n : 1, i = Number(e), a = Math.max(r, Number.isFinite(i) ? i : 5), o = new AbortController, s, c = new Promise((e) => {
        s = e;
      }), l = /* @__PURE__ */ new Set, u = () => {
        if (o.signal.aborted)
          throw new S("OIDCAuth: device polling cancelled");
      }, d = async () => {
        let e = await this.loadConfig(), n = Math.max(1, a);
        for (;; ) {
          u();
          let r;
          await this.sleep(n * 1000, (e) => {
            r = e, l.add(e);
          }), l.delete(r), u();
          let i = this.toForm({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: t.device_code,
            client_id: this.clientId
          }), a = await this.postFormLoose(e.token_endpoint, i, o.signal);
          if (u(), a.access_token)
            return this.handleTokens(a, "signin"), a;
          let s = (a.error ?? "").toString();
          if (s !== "authorization_pending") {
            if (s === "slow_down") {
              n = Math.max(n + 5, n * 2);
              continue;
            }
            throw new S(`OIDCAuth: ${a.error_description || s || "device authorization failed"}`);
          }
        }
      }, f = () => {
        o.abort(), s();
        for (let e of l)
          e();
        l.clear();
      };
      return {
        ...t,
        poll: () => Promise.race([d(), c.then(() => {
          throw new S("OIDCAuth: device polling cancelled");
        })]),
        cancel: f
      };
    }
    async refresh(e) {
      let t = this.clientId, n = this.tokenListeners, r = this.inflightRefreshes.get(e);
      if (r?.listeners === n && r.clientId === t)
        return r.promise;
      let i = (async () => {
        let r = await this.loadConfig(), i = this.toForm({
          grant_type: "refresh_token",
          refresh_token: e,
          client_id: t
        }), a = await this.postFormStrict(r.token_endpoint, i);
        return a.refresh_token || (a.refresh_token = e), this.handleTokens(a, "refresh", n), a;
      })();
      this.inflightRefreshes.set(e, {
        clientId: t,
        listeners: n,
        promise: i
      });
      try {
        return await i;
      } finally {
        this.inflightRefreshes.get(e)?.promise === i && this.inflightRefreshes.delete(e);
      }
    }
    async passwordGrant(e, t) {
      let n = await this.loadConfig(), r = this.toForm({
        grant_type: "password",
        client_id: this.clientId,
        username: e,
        password: t,
        scope: this.scope
      }), i = await this.postFormStrict(n.token_endpoint, r);
      return this.handleTokens(i, "signin"), i;
    }
    handleTokens(e, t, n = this.tokenListeners) {
      if (!e.access_token)
        throw new S(`OIDCAuth: ${e.error_description || e.error || "token response missing access_token"}`);
      queueMicrotask(() => A((e) => this.onTokens?.(e, t), e, this.logger, { where: "OIDCAuth.handleTokens" }));
      let r = new Set(this.tokenListeners);
      for (let i of n)
        r.has(i) && queueMicrotask(() => A((e) => i(e, t), e, this.logger, { where: "OIDCAuth.handleTokens.listener" }));
    }
    toForm(e) {
      let t = (e) => encodeURIComponent(e).replace(/%20/g, "+");
      return Object.entries(e).map(([e, n]) => `${t(e)}=${t(n)}`).join("&");
    }
    async postFormStrict(e, t) {
      try {
        let n = await fetch(e, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: t,
          redirect: "error"
        }), r = await n.text(), i, a;
        try {
          i = r ? JSON.parse(r) : undefined;
        } catch (e) {
          a = e, this.logger.warn("OIDCAuth: bad JSON (strict)", { err: e });
        }
        if (!n.ok) {
          let e = i ?? {};
          throw new S(`OIDCAuth: ${e.error_description || e.error || `HTTP ${n.status}`}`, { cause: a });
        }
        return this.logger.debug("OIDCAuth Response", { status: n.status }), i ?? {};
      } catch (e) {
        throw this.logger.error("OIDCAuth: postFormStrict failed", { err: e }), e;
      }
    }
    async postFormLoose(e, t, n) {
      try {
        let r = await fetch(e, {
          method: "POST",
          signal: n,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: t,
          redirect: "error"
        }), i = await r.text(), a;
        try {
          a = i ? JSON.parse(i) : undefined;
        } catch (e) {
          this.logger.warn("OIDCAuth: bad JSON (loose)", { err: e });
        }
        return this.logger.debug("OIDCAuth Response", { status: r.status }), a ?? {};
      } catch (e) {
        return this.logger.error("OIDCAuth: postFormLoose network error", { err: e }), {
          error: "network_error",
          error_description: String(e)
        };
      }
    }
    sleep(e, t) {
      let n = Math.min(e, me);
      return new Promise((e) => {
        let r = setTimeout(e, n);
        t?.(() => {
          clearTimeout(r), e();
        });
      });
    }
  };
  var Z = class e {
    constructor(t, n) {
      let r = n ?? O;
      this._mintInfo = e.normalizeInfo(t, r), this._maxArrayLength = e.resolveMaxArrayLength(t.max_array_length, r);
      let i = this.toEndpoints(this._mintInfo?.nuts?.[22]?.protected_endpoints, r);
      this._protected22 = this.buildIndex(i);
      let a = this.toEndpoints(this._mintInfo?.nuts?.[21]?.protected_endpoints, r);
      this._protected21 = this.buildIndex(a);
    }
    static normalizeInfo(t, n = O) {
      if (!K(t) || !K(t.nuts))
        throw n.error("MintInfo: malformed info response", { op: "normalizeInfo" }), new S("Invalid response from mint");
      return {
        ...t,
        ...Array.isArray(t.contact) ? { contact: e.capList(t.contact, "contact", n) } : {},
        ...Array.isArray(t.urls) ? { urls: e.capList(t.urls, "urls", n) } : {},
        nuts: {
          ...t.nuts,
          ...t.nuts[4] ? { 4: e.normalizeSwapSection(t.nuts[4], "nuts.4", n) } : {},
          ...t.nuts[5] ? { 5: e.normalizeSwapSection(t.nuts[5], "nuts.5", n) } : {},
          ...t.nuts[15] ? { 15: e.normalizeNut15(t.nuts[15], n) } : {},
          ...t.nuts[17] ? { 17: e.normalizeNut17(t.nuts[17], n) } : {},
          ...t.nuts[19] ? { 19: e.normalizeNut19(t.nuts[19], n) } : {},
          ...t.nuts[21] ? { 21: e.normalizeNut21(t.nuts[21], n) } : {},
          ...t.nuts[22] ? { 22: e.normalizeNut22(t.nuts[22], n) } : {},
          ...t.nuts[29] ? { 29: e.normalizeNut29(t.nuts[29], n) } : {}
        }
      };
    }
    static dropSection(e, t) {
      t.warn(`MintInfo: ${e} is malformed and was omitted`);
    }
    static normalizeSwapSection(t, n, r) {
      if (!K(t))
        throw r.error("MintInfo: malformed info response", { op: n }), new S("Invalid response from mint");
      return {
        ...t,
        methods: e.normalizeSwapMethods(t.methods, r)
      };
    }
    static normalizeSwapMethods(t, n) {
      return Array.isArray(t) ? e.capList(t, "nuts.4/5.methods", n).filter((e) => K(e)).map((e) => {
        let t = { ...e };
        return ca(t, "min_amount", "max_amount"), t;
      }) : (n.warn("MintInfo: nuts.4/5.methods is malformed and was omitted"), []);
    }
    static resolveMaxArrayLength(e, t) {
      if (e == null)
        return 500;
      let n;
      try {
        n = X(e, "max_array_length");
      } catch {
        return t.warn("MintInfo: max_array_length is malformed, defaulting to internal default", { value: e }), 500;
      }
      if (n < 1 || n > 1e4) {
        let e = Math.min(Math.max(n, 1), ue);
        return t.warn("MintInfo: max_array_length is out of range and was clamped", {
          advertised: n,
          clampedTo: e
        }), e;
      }
      return n;
    }
    static normalizeNut15(t, n) {
      return K(t) ? Array.isArray(t.methods) ? {
        ...t,
        methods: e.capList(t.methods, "nuts.15.methods", n)
      } : t : e.dropSection("nuts.15", n);
    }
    static normalizeNut17(t, n) {
      return K(t) ? Array.isArray(t.supported) ? {
        ...t,
        supported: e.capList(t.supported, "nuts.17.supported", n)
      } : t : e.dropSection("nuts.17", n);
    }
    static normalizeNut19(t, n) {
      return K(t) ? {
        ...t,
        ...Array.isArray(t.cached_endpoints) ? { cached_endpoints: e.capList(t.cached_endpoints, "nuts.19.cached_endpoints", n) } : {},
        ttl: X(t.ttl, "nuts.19.ttl", null)
      } : e.dropSection("nuts.19", n);
    }
    static normalizeNut21(t, n) {
      return K(t) ? Array.isArray(t.protected_endpoints) ? {
        ...t,
        protected_endpoints: e.capList(t.protected_endpoints, "nuts.21.protected_endpoints", n)
      } : t : e.dropSection("nuts.21", n);
    }
    static normalizeNut22(t, n) {
      if (!K(t))
        return e.dropSection("nuts.22", n);
      let r = 100;
      try {
        r = X(t.bat_max_mint, "nuts.22.bat_max_mint", 100);
      } catch {
        n.warn("MintInfo: nuts.22.bat_max_mint is malformed, defaulting to internal cap", { value: t.bat_max_mint });
      }
      return r > 100 && (n.warn("MintInfo: nuts.22.bat_max_mint exceeds internal cap and was clamped", {
        advertised: r,
        clampedTo: 100
      }), r = 100), {
        ...t,
        ...Array.isArray(t.protected_endpoints) ? { protected_endpoints: e.capList(t.protected_endpoints, "nuts.22.protected_endpoints", n) } : {},
        bat_max_mint: r
      };
    }
    static normalizeNut29(t, n) {
      if (!K(t))
        return e.dropSection("nuts.29", n);
      let r = 100;
      try {
        r = X(t.max_batch_size, "nuts.29.max_batch_size", 100);
      } catch {
        n.warn("MintInfo: nuts.29.max_batch_size is malformed, defaulting to internal cap", { value: t.max_batch_size });
      }
      return r > 100 && (n.warn("MintInfo: nuts.29.max_batch_size exceeds internal cap and was clamped", {
        advertised: r,
        clampedTo: 100
      }), r = 100), {
        methods: Array.isArray(t.methods) ? e.capList(t.methods, "nuts.29.methods", n) : t.methods,
        max_batch_size: r
      };
    }
    isSupported(e) {
      switch (e) {
        case 4:
        case 5:
          return this.checkMintMelt(e);
        case 7:
        case 8:
        case 9:
        case 10:
        case 11:
        case 12:
        case 14:
        case 20:
          return this.checkGenericNut(e);
        case 17:
          return this.checkNut17();
        case 15:
          return this.checkNut15();
        case 19:
          return this.checkNut19();
        case 29:
          return this.checkNut29();
        default:
          throw new S("nut is not supported by cashu-ts");
      }
    }
    requiresBlindAuthToken(e, t) {
      return this.matchesProtected(this._protected22, e, t);
    }
    requiresClearAuthToken(e, t) {
      return this.matchesProtected(this._protected21, e, t);
    }
    matchesProtected(e, t, n) {
      if (!e)
        return false;
      let r = e.exact[t], i = e.prefix[t];
      if (!r || !i)
        return false;
      if (e.exact[t].has(n))
        return true;
      for (let r of e.prefix[t])
        if (n.startsWith(r))
          return true;
      return false;
    }
    checkGenericNut(e) {
      return { supported: this._mintInfo.nuts[e]?.supported === true };
    }
    checkMintMelt(t) {
      let n = this._mintInfo.nuts[t];
      return n && n.methods.length > 0 && !n.disabled ? {
        disabled: false,
        params: e.snapshot(n.methods)
      } : {
        disabled: true,
        params: e.snapshot(n?.methods ?? [])
      };
    }
    checkNut17() {
      return this._mintInfo.nuts[17] && this._mintInfo.nuts[17].supported.length > 0 ? {
        supported: true,
        params: e.snapshot(this._mintInfo.nuts[17].supported)
      } : { supported: false };
    }
    checkNut15() {
      return this._mintInfo.nuts[15] && this._mintInfo.nuts[15].methods.length > 0 ? {
        supported: true,
        params: e.snapshot(this._mintInfo.nuts[15].methods)
      } : { supported: false };
    }
    checkNut19() {
      let t = this._mintInfo.nuts?.[19];
      if (t && (t?.cached_endpoints?.length || 0) > 0) {
        let n = X(t.ttl, "nuts.19.ttl", null);
        return {
          supported: true,
          params: {
            ttl: n === null ? Infinity : Math.max(n, 0) * 1000,
            cached_endpoints: e.snapshot(t.cached_endpoints)
          }
        };
      }
      return { supported: false };
    }
    checkNut29() {
      let t = this._mintInfo.nuts?.[29];
      return t ? {
        supported: true,
        params: e.snapshot(t)
      } : { supported: false };
    }
    static capList(e, t, n) {
      return e.length <= 1024 ? e : (n.warn(`MintInfo: ${t} exceeds internal cap and was truncated`, {
        advertised: e.length,
        cap: de
      }), e.slice(0, de));
    }
    toEndpoints(t, n) {
      if (!Array.isArray(t))
        return [];
      let r = e.capList(t, "nuts.21/22.protected_endpoints", n), i = [];
      for (let e of r)
        if (e && typeof e == "object") {
          let t = e, { method: n, path: r } = t;
          if (typeof n == "string" && typeof r == "string") {
            let e = n.toUpperCase();
            (e === "GET" || e === "POST") && i.push({
              method: e,
              path: r
            });
          }
        }
      return i;
    }
    buildIndex(e) {
      if (!e?.length)
        return;
      let t = {
        GET: /* @__PURE__ */ new Set,
        POST: /* @__PURE__ */ new Set
      }, n = {
        GET: [],
        POST: []
      };
      for (let r of e) {
        let e = r.path;
        if (e.startsWith("^") && (e = e.slice(1)), e.endsWith("$") && (e = e.slice(0, -1)), e.endsWith(".*")) {
          n[r.method].push(e.slice(0, -2));
          continue;
        }
        if (e.endsWith("*")) {
          n[r.method].push(e.slice(0, -1));
          continue;
        }
        t[r.method].add(e);
      }
      return n.GET.sort((e, t) => t.length - e.length), n.POST.sort((e, t) => t.length - e.length), {
        exact: t,
        prefix: n
      };
    }
    static snapshot(t, n = 0) {
      if (typeof t != "object" || !t || t instanceof j)
        return t;
      if (n > 64)
        throw new S("Mint info nesting exceeds 64 levels");
      if (Array.isArray(t))
        return t.map((t) => e.snapshot(t, n + 1));
      let r = {};
      for (let [i, a] of Object.entries(t))
        r[i] = e.snapshot(a, n + 1);
      return r;
    }
    get cache() {
      return e.snapshot(this._mintInfo);
    }
    get contact() {
      return e.snapshot(this._mintInfo.contact);
    }
    get description() {
      return this._mintInfo.description;
    }
    get description_long() {
      return this._mintInfo.description_long;
    }
    get name() {
      return this._mintInfo.name;
    }
    get pubkey() {
      return this._mintInfo.pubkey;
    }
    get nuts() {
      return e.snapshot(this._mintInfo.nuts);
    }
    get version() {
      return this._mintInfo.version;
    }
    get motd() {
      return this._mintInfo.motd;
    }
    get icon_url() {
      return this._mintInfo.icon_url;
    }
    get urls() {
      return e.snapshot(this._mintInfo.urls);
    }
    get time() {
      return this._mintInfo.time;
    }
    get tos_url() {
      return this._mintInfo.tos_url;
    }
    get maxArrayLength() {
      return this._maxArrayLength;
    }
    supportsNut04Description(e, t) {
      return this._mintInfo.nuts[4]?.methods.some((n) => n.method === e && (t ? n.unit === t : true) && (n.options?.description === true || n.description === true));
    }
    supportsMintMeltMethod(e, t, n) {
      let { disabled: r, params: i } = this.isSupported(e === "mint" ? 4 : 5);
      return r ? false : i.some((e) => e.method === t && e.unit === n);
    }
    supportsAmountless(e = "bolt11", t = "sat") {
      let n = this._mintInfo?.nuts?.[5]?.methods ?? [];
      return Array.isArray(n) ? n.some((n) => n.method === e && n.unit === t && n.options?.amountless === true) : false;
    }
  };
  var Va = {
    UNPAID: "UNPAID",
    PAID: "PAID",
    ISSUED: "ISSUED"
  };
  var Ha = {
    UNPAID: "UNPAID",
    PENDING: "PENDING",
    PAID: "PAID"
  };
  var Ua = {
    UNSPENT: "UNSPENT",
    PENDING: "PENDING",
    SPENT: "SPENT"
  };
  function Wa(e) {
    return e.window !== undefined && e.window.document !== undefined ? true : e.WorkerGlobalScope !== undefined && e.self !== undefined && e.self instanceof e.WorkerGlobalScope;
  }
  var Ga = Wa(globalThis);
  function Ka(e, t, n = Ga) {
    return _o({
      Accept: "application/json, text/plain, */*",
      ...e ? { "Content-Type": "application/json" } : undefined,
      ...n ? undefined : { "User-Agent": "Mozilla/5.0" }
    }, t);
  }
  function qa(e, t) {
    return e instanceof Error ? e.message : t;
  }
  function Ja(e, t, n) {
    let r = e;
    for (;; ) {
      let e = r.cause;
      if (!(e instanceof Error) || e === r)
        break;
      r = e;
    }
    let i = "";
    if (r instanceof Error && r !== e && r.message) {
      let e = r.code;
      i = ` (${r.message}${typeof e == "string" ? `, ${e}` : ""})`;
    }
    return `${qa(e, t)}${i} at ${Ya(n)}`;
  }
  function Ya(e) {
    try {
      return new URL(e).origin;
    } catch {
      return e;
    }
  }
  function Xa(e, t, n, r) {
    if (t?.signal.aborted)
      return new E(`Request timed out after ${n}ms`, { cause: e });
    if (r?.aborted)
      return new T(qa(e, "Request aborted by caller"));
  }
  async function Za(e, t) {
    if (t?.aborted)
      throw new S("response body read aborted");
    let n = e.text();
    if (!t)
      return n;
    n.catch(() => {
      return;
    });
    let r, i = new Promise((e, n) => {
      r = () => n(new S("response body read aborted")), t.aborted ? r() : t.addEventListener("abort", r, { once: true });
    });
    i.catch(() => {
      return;
    });
    try {
      return await Promise.race([n, i]);
    } finally {
      r && t.removeEventListener("abort", r);
    }
  }
  function Qa(e) {
    if (e === null)
      return;
    let t = e.trim();
    if (t !== "") {
      if (/^\d+$/.test(t))
        return Math.max(Number(t) * 1000, 0);
      if (/[a-zA-Z]/.test(t)) {
        let e = new Date(t).getTime();
        if (!Number.isNaN(e))
          return Math.max(e - Date.now(), 0);
      }
    }
  }
  var $a = {
    endpoint: true,
    requestBody: true,
    logger: true,
    ttl: true,
    cached_endpoints: true,
    requestTimeout: true,
    onResponseMeta: true
  };
  var eo = {};
  var to = O;
  function ro(e) {
    to = e;
  }
  var io = 9;
  var ao = 1000;
  var oo = 300000;
  var so = 100;
  var co = ["blind-auth", "clear-auth"];
  function lo(e) {
    return e instanceof T || e instanceof E ? false : e instanceof w ? true : e instanceof C && e.status >= 500;
  }
  function uo(e, t) {
    return t ? new Promise((n, r) => {
      if (t.aborted) {
        r(new T("Request aborted by caller"));
        return;
      }
      let i = () => {
        clearTimeout(a), t.removeEventListener("abort", i), r(new T("Request aborted by caller"));
      };
      t.addEventListener("abort", i, { once: true });
      let a = setTimeout(() => {
        t.removeEventListener("abort", i), n();
      }, e);
    }) : new Promise((t) => setTimeout(t, e));
  }
  function fo(e) {
    try {
      return new URL(e).pathname;
    } catch {
      return e.startsWith("/") ? e.split(/[?#]/, 1)[0] : undefined;
    }
  }
  function po(e, t) {
    return e === t ? true : e.endsWith(t);
  }
  async function mo(e) {
    let { ttl: t, cached_endpoints: n, endpoint: r } = e, i = e.logger ?? to;
    if (Object.keys(e.headers ?? {}).some((e) => e.toLowerCase() === "blind-auth"))
      return await ho(e);
    let a = fo(r), o = e.method?.toUpperCase() ?? "GET";
    if (!(a !== undefined && n?.some((e) => po(a, e.path) && e.method === o) && t))
      return await ho(e);
    let s = 0, c = Date.now(), l = async () => {
      try {
        return await ho(e);
      } catch (n) {
        if (lo(n)) {
          let r = Date.now() - c;
          if (s < io && (!t || r < t)) {
            let a = Math.min(2 ** s * so, ao) / 2, o = a + Math.random() * a;
            if (r + o > t)
              throw i.warn(`Network Error: request abandoned after ${s} retries`, {
                e: n,
                retries: s
              }), n;
            return s++, i.info(`Network Error: attempting retry ${s} in ${o}ms`, {
              e: n,
              retries: s,
              delay: o
            }), await uo(o, e.signal), l();
          }
        }
        throw i.debug("Request failed and could not be retried", { e: n }), n;
      }
    };
    return l();
  }
  async function ho(e) {
    let { endpoint: t, requestBody: n, headers: r, requestTimeout: i, onResponseMeta: a, cached_endpoints: o, ttl: s, logger: c, ...l } = e, u = c ?? to, d = n ? M.stringify(n) : undefined, f = Ka(d, r), p = Object.keys(f).some((e) => co.includes(e.toLowerCase())), m = e.signal ?? undefined;
    if (m?.aborted)
      throw new T("Request aborted by caller");
    let h = i !== undefined && Number.isFinite(i) ? new AbortController : undefined, g = m, _, v;
    if (h)
      if (_ = setTimeout(() => h.abort(), i), !m)
        g = h.signal;
      else {
        let e = new AbortController, t = () => e.abort();
        m.addEventListener("abort", t, { once: true }), h.signal.addEventListener("abort", t, { once: true }), v = () => {
          m.removeEventListener("abort", t), h.signal.removeEventListener("abort", t);
        }, g = e.signal;
      }
    try {
      let e;
      try {
        e = await fetch(t, {
          body: d,
          headers: f,
          cache: "no-store",
          credentials: "omit",
          referrer: "",
          referrerPolicy: "no-referrer",
          ...d === undefined ? undefined : { redirect: "error" },
          ...l,
          ...p ? { redirect: "error" } : undefined,
          signal: g
        });
      } catch (e) {
        let n = !!h?.signal.aborted, r = !!m?.aborted;
        throw n ? new w(`Request timed out after ${i}ms at ${Ya(t)}`, { cause: e }) : r ? new T(qa(e, "Request aborted by caller")) : e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError") ? new w(Ja(e, e.message, t), { cause: e }) : new w(Ja(e, "Network request failed", t), { cause: e });
      }
      let n = Qa(e.headers.get("Retry-After"));
      if (a && e.headers && A(a, {
        endpoint: t,
        status: e.status,
        retryAfterMs: n,
        rateLimit: e.headers.get("RateLimit") ?? undefined,
        rateLimitPolicy: e.headers.get("RateLimit-Policy") ?? undefined,
        headers: e.headers
      }, u, {
        op: "request.onResponseMeta",
        status: e.status,
        endpoint: t
      }), !e.ok) {
        if (e.status === 429) {
          let t = e.body;
          throw t && typeof t.cancel == "function" && t.cancel().catch(() => {
            return;
          }), new ie("429 Too Many Requests", n);
        }
        let t, r;
        try {
          t = go(await Za(e, g));
        } catch (e) {
          let n = Xa(e, h, i, m);
          if (n)
            throw n;
          r = e, t = { error: "bad response" };
        }
        if (e.status === 400 && "code" in t && typeof t.code == "number" && "detail" in t && typeof t.detail == "string")
          throw new ae(t.code, t.detail);
        let a = "HTTP request failed";
        throw "error" in t && typeof t.error == "string" ? a = t.error : ("detail" in t) && typeof t.detail == "string" && (a = t.detail), new C(a, e.status, { cause: r });
      }
      let r;
      try {
        r = await Za(e, g);
      } catch (t) {
        throw Xa(t, h, i, m) || (u.error("Failed to read HTTP response", { err: t }), new C("bad response", e.status, { cause: t }));
      }
      try {
        if (!r)
          throw new S("Empty response body");
        return M.parse(r, undefined, { strict: true });
      } catch (t) {
        throw u.error("Failed to parse HTTP response", { err: t }), new C("bad response", e.status, { cause: t });
      }
    } finally {
      clearTimeout(_), v?.();
    }
  }
  function go(e) {
    if (!e)
      return { detail: "bad response" };
    let t;
    try {
      t = M.parse(e, undefined, { strict: true });
    } catch {
      return { detail: e };
    }
    return typeof t == "object" && t && (("detail" in t) || ("code" in t) || ("error" in t)) ? t : { detail: t };
  }
  function _o(e, t) {
    let n = /* @__PURE__ */ new Map;
    for (let r of [e, t])
      for (let [e, t] of Object.entries(r ?? {}))
        n.set(e.toLowerCase(), [e, t]);
    return Object.fromEntries(n.values());
  }
  async function vo(e) {
    let t = e.onResponseMeta, n = eo.onResponseMeta, r = {
      ...e,
      ...eo
    };
    for (let t of Object.keys($a))
      e[t] !== undefined && (r[t] = e[t]);
    if (r.requestTimeout === undefined && (r.requestTimeout = oo), r.headers = _o(eo.headers, e.headers), t && n && t !== n) {
      let i = r.logger ?? to;
      r.onResponseMeta = (r) => {
        A(t, r, i, {
          op: "request.onResponseMeta",
          scope: "per-request",
          endpoint: e.endpoint
        }), A(n, r, i, {
          op: "request.onResponseMeta",
          scope: "global",
          endpoint: e.endpoint
        });
      };
    }
    return await mo(r);
  }
  var yo;
  typeof WebSocket < "u" && (yo = WebSocket);
  function xo() {
    if (yo === undefined)
      throw new S("WebSocket implementation not initialized");
    return yo;
  }
  var So = 1006;
  var Co = class {
    constructor(e) {
      this.next = null, this.value = e;
    }
  };
  var wo = class {
    constructor() {
      this._first = null, this._last = null, this.size = 0;
    }
    enqueue(e) {
      let t = new Co(e);
      return this._last ? this._last.next = t : this._first = t, this._last = t, this.size++, true;
    }
    dequeue() {
      if (!this._first)
        return null;
      let e = this._first;
      return this._first = e.next, this._first || (this._last = null), this.size--, e.value;
    }
  };
  var To = class {
    constructor(e, t) {
      this.subListeners = {}, this.rpcListeners = {}, this.rpcId = 0, this.onCloseCallbacks = [], this._WS = xo(), this.url = new URL(e), this.messageQueue = new wo, this._logger = t ?? O;
    }
    setLogger(e) {
      this._logger = e;
    }
    connect(e = 1e4) {
      return this.connectionPromise || (this.connectionPromise = new Promise((t, n) => {
        let r = false, i = false, a = null, o = (e) => {
          i || (i = true, a && clearTimeout(a), this.abandonConnect = undefined, e());
        };
        this.abandonConnect = (e) => o(() => n(e));
        let s = (e) => {
          if (this.ws) {
            try {
              this.ws.onopen = null, this.ws.onerror = null, this.ws.onmessage = null, this.ws.onclose = null;
            } catch {}
            try {
              this.ws.close();
            } catch {}
            this.ws = undefined, this.stopMessageHandling(e);
          }
        }, c = (e) => {
          this.connectionPromise = undefined;
          let t = e instanceof Error ? e : new S(String(e), { cause: e });
          s(t), this.failPendingRpc(t), o(() => n(t));
        }, l;
        try {
          l = new this._WS(this.url.toString()), this.ws = l;
        } catch (e) {
          c(e);
          return;
        }
        let u = () => this.ws === l;
        a = setTimeout(() => {
          c(new S(`WebSocket connect timeout after ${e}ms`));
        }, e), l.onopen = () => {
          u() && (r = true, o(t));
        }, l.onerror = (e) => {
          if (u()) {
            if (!r) {
              c(new S("Failed to open WebSocket"));
              return;
            }
            this._logger.error("WebSocket error after open", { ev: e });
          }
        }, l.onmessage = (e) => {
          if (u()) {
            if (this.messageQueue.size >= 1e4) {
              this._logger.error("WebSocket message queue exceeded its bound, closing connection", { size: this.messageQueue.size });
              let e = new S("WebSocket message queue exceeded its bound");
              c(e), this.onCloseCallbacks.forEach((t) => t({
                code: So,
                reason: e.message,
                wasClean: false
              }));
              return;
            }
            this.messageQueue.enqueue(e.data), this.handlingInterval || (this.handlingInterval = setInterval(this.handleNextMessage.bind(this), 0));
          }
        }, l.onclose = (e) => {
          if (this.ws && this.ws !== l)
            return;
          if (this.connectionPromise = undefined, !r) {
            let t = e?.reason ? `, ${e.reason}` : "";
            c(new S(`WebSocket closed before open (code ${e?.code ?? 0}${t})`));
            return;
          }
          let t = e?.reason ? `, ${e.reason}` : "", n = e?.code ?? 0, i = typeof e.wasClean == "boolean" ? e.wasClean : true, a = new S(`WebSocket closed (code ${n}${t})`);
          this.stopMessageHandling(a), !i || n !== 1000 && n !== 1001 ? this.failPendingRpc(a) : this.rpcListeners = {}, this.onCloseCallbacks.forEach((t) => t(e));
        };
      })), this.connectionPromise;
    }
    sendRequest(e, t) {
      if (this.ws?.readyState !== this._WS.OPEN) {
        if (e === "unsubscribe")
          return;
        throw this._logger.error("Attempted sendRequest, but socket was not open"), new S("Socket not open");
      }
      let n = this.rpcId;
      this.rpcId++, this.sendRpcMessage(e, t, n);
    }
    addSubListener(e, t, n) {
      (this.subListeners[e] = this.subListeners[e] || []).push({
        callback: t,
        errorCallback: n
      });
    }
    stopMessageHandling(e) {
      for (this.handlingInterval && (clearInterval(this.handlingInterval), this.handlingInterval = undefined);this.messageQueue.size > 0; )
        this.messageQueue.dequeue();
      let t = this.subListeners;
      this.subListeners = {};
      for (let n of Object.values(t))
        for (let { errorCallback: t } of n)
          try {
            t?.(e);
          } catch {}
    }
    failPendingRpc(e) {
      let t = this.rpcListeners;
      this.rpcListeners = {};
      for (let n of Object.keys(t))
        try {
          t[n].errorCallback(e);
        } catch {}
    }
    sendRpcMessage(e, t, n) {
      if (this.ws?.readyState !== this._WS.OPEN)
        throw new S("Socket not open");
      let r = JSON.stringify({
        jsonrpc: "2.0",
        method: e,
        params: t,
        id: n
      });
      try {
        this.ws.send(r);
      } catch (e) {
        this._logger.error("WebSocket send failed", { e }), this.connectionPromise = undefined;
        try {
          this.ws.close();
        } catch {}
        this.ws = undefined;
        let t = e instanceof Error ? e : new S(String(e), { cause: e });
        throw this.stopMessageHandling(t), this.failPendingRpc(t), t;
      }
    }
    addRpcListener(e, t, n) {
      this.rpcListeners[n] = {
        callback: e,
        errorCallback: t
      };
    }
    removeRpcListener(e) {
      delete this.rpcListeners[e];
    }
    removeListener(e, t) {
      if (this.subListeners[e]) {
        if (this.subListeners[e].length === 1) {
          delete this.subListeners[e];
          return;
        }
        this.subListeners[e] = this.subListeners[e].filter((e) => e.callback !== t);
      }
    }
    async ensureConnection(e) {
      this.ws?.readyState !== this._WS.OPEN && await this.connect(e);
    }
    handleNextMessage() {
      for (;this.messageQueue.size > 0; ) {
        let e = this.messageQueue.dequeue();
        try {
          let t = M.parse(e, undefined, { strict: true });
          if ("result" in t && t.id != null)
            this.rpcListeners[t.id] && (this.rpcListeners[t.id].callback(), this.removeRpcListener(t.id));
          else if ("error" in t && t.id != null)
            this.rpcListeners[t.id] && (this.rpcListeners[t.id].errorCallback(new S(t.error.message)), this.removeRpcListener(t.id));
          else if ("method" in t && !("id" in t)) {
            let e = t.params?.subId;
            if (!e)
              continue;
            if (this.subListeners[e]?.length > 0) {
              let n = t;
              this.subListeners[e].forEach(({ callback: e }) => {
                try {
                  let t = e(n.params?.payload);
                  t && typeof t.then == "function" && Promise.resolve(t).catch((e) => {
                    this._logger.error("Subscription handler threw", { e });
                  });
                } catch (e) {
                  this._logger.error("Subscription handler threw", { e });
                }
              });
            }
          }
        } catch (e) {
          this._logger.error("Error doing handleNextMessage", { e });
        }
      }
      this.handlingInterval && (clearInterval(this.handlingInterval), this.handlingInterval = undefined);
    }
    createSubscription(e, t, n) {
      if (this.ws?.readyState !== this._WS.OPEN)
        throw this._logger.error("Attempted createSubscription, but socket was not open"), new S("Socket is not open");
      let r = (Math.random() + 1).toString(36).substring(7), i = this.rpcId;
      this.addRpcListener(() => {
        this.addSubListener(r, t, n);
      }, n, i);
      try {
        this.sendRequest("subscribe", {
          ...e,
          subId: r
        });
      } catch (e) {
        throw this.removeRpcListener(i), e;
      }
      return r;
    }
    cancelSubscription(e, t, n) {
      if (this.removeListener(e, t), this.ws?.readyState !== this._WS.OPEN) {
        this._logger.info("Socket not open, removed listener locally {subId}", { subId: e });
        return;
      }
      let r = this.rpcId;
      this.rpcId++, this.addRpcListener(() => {
        this._logger.info("Unsubscribed {subId}", { subId: e });
      }, n || ((e) => this._logger.info("Unsubscribe failed", { e })), r);
      try {
        this.sendRpcMessage("unsubscribe", { subId: e }, r);
      } catch (e) {
        throw this.removeRpcListener(r), e;
      }
    }
    get activeSubscriptions() {
      return Object.keys(this.subListeners);
    }
    close() {
      let e = new S("WebSocket closed");
      if (this.abandonConnect?.(e), this.ws) {
        try {
          this.ws.close();
        } catch {}
        this.ws = undefined;
      }
      this.connectionPromise = undefined, this.failPendingRpc(e), this.stopMessageHandling(e);
    }
    onClose(e) {
      this.onCloseCallbacks.push(e);
    }
  };
  function Eo(e) {
    return Array.isArray(e) ? "array" : typeof e;
  }
  var Do = class {
    constructor(e, t) {
      this._lastResponseMetadata = undefined, this._captureResponseMetadata = (e) => {
        this._lastResponseMetadata = e;
      }, this._mintUrl = la(e), this._request = t?.customRequest ?? vo, this._authProvider = t?.authProvider, this._logger = t?.logger ?? O, ro(this._logger);
    }
    get mintUrl() {
      return this._mintUrl;
    }
    get lastResponseMetadata() {
      return this._lastResponseMetadata;
    }
    async oidcAuth(e) {
      let t = (await this.getLazyMintInfo()).nuts[21];
      if (!t?.openid_discovery)
        throw new S("Mint: no NUT-21 openid_discovery");
      return new Ba(t.openid_discovery, {
        ...e,
        clientId: e?.clientId ?? t.client_id ?? "cashu-client"
      });
    }
    async getInfo(e) {
      let t = await (e ?? this._request)({
        endpoint: q(this._mintUrl, "/v1/info"),
        onResponseMeta: this._captureResponseMetadata,
        logger: this._logger
      });
      return Z.normalizeInfo(t, this._logger);
    }
    async getLazyMintInfo(e) {
      if (this._mintInfo)
        return this._mintInfo;
      let t = await this.getInfo(e);
      return this._mintInfo = new Z(t, this._logger), this._mintInfo;
    }
    setMintInfo(e) {
      this._mintInfo = e instanceof Z ? e : new Z(e, this._logger);
    }
    async swap(e, t) {
      k(!Array.isArray(e?.inputs), "swap: inputs must be an array of proofs", this._logger);
      let n = await this.requestWithAuth("POST", "/v1/swap", { requestBody: {
        ...e,
        inputs: this.stripWalletFields(e.inputs)
      } }, t);
      if (!G(n) || !Array.isArray(n?.signatures))
        throw this._logger.error("Invalid response from mint...", {
          data: n,
          op: "swap"
        }), new S("Invalid response from mint");
      return this.assertSignatureCount(n.signatures, e.outputs, "swap"), n.signatures = this.normalizeSignatureAmounts(n.signatures), n;
    }
    async createMintQuote(e, t, n) {
      k(!this.isValidMethodString(e), `Invalid mint quote method: ${e}`, this._logger);
      let r = await this.requestWithAuth("POST", `/v1/mint/quote/${e}`, { requestBody: t }, n?.customRequest);
      return this.normalizeMintQuoteResponse(e, r, n?.normalize);
    }
    async createMintQuoteBolt11(e, t) {
      return this.createMintQuote("bolt11", {
        ...e,
        amount: j.from(e.amount).toBigInt()
      }, { customRequest: t });
    }
    async createMintQuoteBolt12(e, t) {
      let n = { ...e };
      return e.amount !== undefined && (n.amount = j.from(e.amount).toBigInt()), this.createMintQuote("bolt12", n, { customRequest: t });
    }
    async createMintQuoteOnchain(e, t) {
      return this.createMintQuote("onchain", e, { customRequest: t });
    }
    async checkMintQuote(e, t, n) {
      k(!this.isValidMethodString(e), `Invalid mint quote method: ${e}`, this._logger);
      let r = await this.requestWithAuth("GET", `/v1/mint/quote/${e}/${t}`, {}, n?.customRequest), i = this.normalizeMintQuoteResponse(e, r, n?.normalize);
      if (i.quote !== t)
        throw this._logger.error("Invalid response from mint...", { op: `checkMintQuote.${e}` }), new S("Mint quote response is for a different quote");
      return i;
    }
    async checkMintQuoteBolt11(e, t) {
      return this.checkMintQuote("bolt11", e, { customRequest: t });
    }
    async checkMintQuoteBolt12(e, t) {
      return this.checkMintQuote("bolt12", e, { customRequest: t });
    }
    async checkMintQuoteOnchain(e, t) {
      return this.checkMintQuote("onchain", e, { customRequest: t });
    }
    async checkMintQuoteBatch(e, t, n) {
      k(!this.isValidMethodString(e), `Invalid mint quote method: ${e}`, this._logger), k(t.length === 0, "checkMintQuoteBatch: no quote ids provided", this._logger), k(new Set(t).size !== t.length, "checkMintQuoteBatch: duplicate quote ids provided", this._logger);
      let r = await this.requestWithAuth("POST", `/v1/mint/quote/${e}/check`, { requestBody: { quotes: t } }, n?.customRequest);
      if (!Array.isArray(r) || r.length !== t.length)
        throw this._logger.error("Invalid response from mint...", {
          expectedCount: t.length,
          actualCount: Array.isArray(r) ? r.length : undefined,
          op: `checkMintQuoteBatch.${e}`
        }), new S("Invalid response from mint");
      return r.map((r, i) => {
        if (r.quote !== t[i])
          throw this._logger.error("Invalid response from mint...", {
            index: i,
            op: `checkMintQuoteBatch.${e}`
          }), new S("Invalid response from mint");
        return this.normalizeMintQuoteResponse(e, r, n?.normalize);
      });
    }
    async checkMintQuoteBatchBolt11(e, t) {
      return this.checkMintQuoteBatch("bolt11", e, { customRequest: t });
    }
    async checkMintQuoteBatchBolt12(e, t) {
      return this.checkMintQuoteBatch("bolt12", e, { customRequest: t });
    }
    async mintBolt11(e, t) {
      return this.mint("bolt11", e, { customRequest: t });
    }
    async mintBolt12(e, t) {
      return this.mint("bolt12", e, { customRequest: t });
    }
    async mintOnchain(e, t) {
      return this.mint("onchain", e, { customRequest: t });
    }
    async mint(e, t, n) {
      k(!this.isValidMethodString(e), `Invalid mint method: ${e}`, this._logger);
      let r = await this.requestWithAuth("POST", `/v1/mint/${e}`, { requestBody: t }, n?.customRequest);
      if (!G(r) || !Array.isArray(r?.signatures))
        throw this._logger.error("Invalid response from mint...", {
          data: r,
          op: `mint.${e}`
        }), new S("Invalid response from mint");
      return this.assertSignatureCount(r.signatures, t.outputs, `mint.${e}`), r.signatures = this.normalizeSignatureAmounts(r.signatures), n?.normalize ? n.normalize(r) : r;
    }
    async mintBatchBolt11(e, t) {
      return this.mintBatch("bolt11", e, { customRequest: t });
    }
    async mintBatchBolt12(e, t) {
      return this.mintBatch("bolt12", e, { customRequest: t });
    }
    async mintBatch(e, t, n) {
      k(!this.isValidMethodString(e), `Invalid mint method: ${e}`, this._logger);
      let r = {
        ...t,
        quote_amounts: t.quote_amounts.map((e) => j.from(e).toBigInt())
      }, i = await this.requestWithAuth("POST", `/v1/mint/${e}/batch`, { requestBody: r }, n?.customRequest);
      if (!G(i) || !Array.isArray(i?.signatures))
        throw this._logger.error("Invalid response from mint...", {
          data: i,
          op: `mintBatch.${e}`
        }), new S("Invalid response from mint");
      return this.assertSignatureCount(i.signatures, t.outputs, `mintBatch.${e}`), i.signatures = this.normalizeSignatureAmounts(i.signatures), n?.normalize ? n.normalize(i) : i;
    }
    async createMeltQuote(e, t, n) {
      k(!this.isValidMethodString(e), `Invalid melt quote method: ${e}`, this._logger);
      let r = await this.requestWithAuth("POST", `/v1/melt/quote/${e}`, { requestBody: t }, n?.customRequest);
      return this.normalizeMeltQuoteResponse(e, r, n?.normalize);
    }
    async createMeltQuoteBolt11(e, t) {
      let n = await this.createMeltQuote("bolt11", this.normalizeMeltQuoteRequestOptions(e), { customRequest: t });
      return k(n.request !== "" && n.request.toLowerCase() !== e.request.toLowerCase(), "Melt quote is for a different payment request", this._logger), n;
    }
    async createMeltQuoteBolt12(e, t) {
      return this.createMeltQuote("bolt12", this.normalizeMeltQuoteRequestOptions(e), { customRequest: t });
    }
    async createMeltQuoteOnchain(e, t) {
      return this.createMeltQuote("onchain", {
        ...e,
        amount: j.from(e.amount).toBigInt()
      }, { customRequest: t });
    }
    async checkMeltQuote(e, t, n) {
      k(!this.isValidMethodString(e), `Invalid melt quote method: ${e}`, this._logger);
      let r = await this.requestWithAuth("GET", `/v1/melt/quote/${e}/${t}`, {}, n?.customRequest), i = this.normalizeMeltQuoteResponse(e, r, n?.normalize);
      if (i.quote !== t)
        throw this._logger.error("Invalid response from mint...", { op: `checkMeltQuote.${e}` }), new S("Melt quote response is for a different quote");
      return i;
    }
    async checkMeltQuoteBolt11(e, t) {
      return this.checkMeltQuote("bolt11", e, { customRequest: t });
    }
    async checkMeltQuoteBolt12(e, t) {
      return this.checkMeltQuote("bolt12", e, { customRequest: t });
    }
    async checkMeltQuoteOnchain(e, t) {
      return this.checkMeltQuote("onchain", e, { customRequest: t });
    }
    async melt(e, t, n) {
      k(!this.isValidMethodString(e), `Invalid melt method: ${e}`, this._logger), k(!Array.isArray(t?.inputs), "melt: inputs must be an array of proofs", this._logger);
      let r = await this.requestWithAuth("POST", `/v1/melt/${e}`, { requestBody: {
        ...t,
        inputs: this.stripWalletFields(t.inputs)
      } }, n?.customRequest), i = this.normalizeMeltQuoteResponse(e, r, n?.normalize, true);
      return i.quote !== t.quote && (this._logger.warn("Melt response reports a different quote id", {
        op: `melt.${e}`,
        expected: t.quote,
        received: i.quote
      }), i.quote = t.quote), i;
    }
    async meltBolt11(e, t) {
      return this.melt("bolt11", e, t);
    }
    async meltBolt12(e, t) {
      return this.melt("bolt12", e, t);
    }
    async meltOnchain(e, t) {
      return this.melt("onchain", e, t);
    }
    async check(e, t) {
      let n = await this.requestWithAuth("POST", "/v1/checkstate", { requestBody: e }, t);
      if (!G(n) || !Array.isArray(n?.states) || n.states.length > e.Ys.length)
        throw this._logger.error("Invalid response from mint...", {
          data: n,
          op: "check"
        }), new S("Invalid response from mint");
      this.assertRecordEntries(n.states, "check");
      for (let e of n.states)
        ca(e, "witness");
      return n;
    }
    async getKeys(e, t, n) {
      let r = t || this._mintUrl;
      e && (e = e.replace(/\//g, "_").replace(/\+/g, "-"));
      let i = await (n ?? this._request)({
        endpoint: e ? q(r, "/v1/keys", e) : q(r, "/v1/keys"),
        onResponseMeta: this._captureResponseMetadata,
        logger: this._logger
      });
      if (!G(i) || !Array.isArray(i.keysets))
        throw this._logger.error("Invalid response from mint...", {
          data: i,
          op: "getKeys"
        }), new S("Invalid response from mint");
      return this.assertKeysetList(i.keysets, "getKeys"), {
        ...i,
        keysets: i.keysets.map((e) => Ra(e))
      };
    }
    async getKeySets(e) {
      let t = await (e ?? this._request)({
        endpoint: q(this._mintUrl, "/v1/keysets"),
        onResponseMeta: this._captureResponseMetadata,
        logger: this._logger
      });
      if (!G(t) || !Array.isArray(t.keysets))
        throw this._logger.error("Invalid response from mint...", {
          data: t,
          op: "getKeySets"
        }), new S("Invalid response from mint");
      return this.assertKeysetList(t.keysets, "getKeySets"), {
        ...t,
        keysets: t.keysets.map((e) => La(e))
      };
    }
    async restore(e, t) {
      let n = await (t ?? this._request)({
        endpoint: q(this._mintUrl, "/v1/restore"),
        method: "POST",
        requestBody: e,
        onResponseMeta: this._captureResponseMetadata,
        logger: this._logger
      });
      if (!G(n) || !Array.isArray(n?.outputs) || !Array.isArray(n?.signatures) || n.outputs.length !== n.signatures.length || n.outputs.length > e.outputs.length)
        throw this._logger.error("Invalid response from mint...", {
          data: n,
          op: "restore"
        }), new S("Invalid response from mint");
      return n.outputs = this.normalizeMessageAmounts(n.outputs), n.signatures = this.normalizeSignatureAmounts(n.signatures), n;
    }
    async connectWebSocket() {
      try {
        let e = new URL(this._mintUrl), t = "v1/ws";
        e.pathname.endsWith("/") ? e.pathname += t : e.pathname += "/" + t, e.protocol = e.protocol === "https:" ? "wss:" : "ws:";
        let n = e.toString();
        this.ws || (this.ws = new To(n, this._logger)), await this.ws.ensureConnection();
      } catch (e) {
        this._logger.error("Failed to connect to WebSocket...", { e });
        try {
          this.ws?.close();
        } catch {}
        throw this.ws = undefined, new S("Failed to connect to WebSocket...", { cause: e });
      }
    }
    disconnectWebSocket() {
      this.ws && this.ws.close();
    }
    get webSocketConnection() {
      return this.ws;
    }
    async handleClearAuth(e, t, n) {
      if (this._authProvider && (n ?? await this.getLazyMintInfo()).requiresClearAuthToken(e, t))
        return this._authProvider.ensureCAT ? this._authProvider.ensureCAT() : this._authProvider.getCAT();
    }
    async handleBlindAuth(e, t, n) {
      if (this._authProvider && (n ?? await this.getLazyMintInfo()).requiresBlindAuthToken(e, t))
        return await this._authProvider.getBlindAuthToken({
          method: e,
          path: t
        });
    }
    async requestWithAuth(e, t, n = {}, r) {
      let i = r ?? this._request, a = this._mintInfo;
      this._authProvider && (a = await this.getLazyMintInfo(r));
      let o = await this.handleBlindAuth(e, t, a), s = await this.handleClearAuth(e, t, a), c = {
        ...n.headers ?? {},
        ...o ? { "Blind-auth": o } : {},
        ...s ? { "Clear-auth": s } : {}
      }, l = a?.isSupported(19);
      return i({
        ...n,
        endpoint: q(this._mintUrl, t),
        method: e,
        headers: c,
        ...o || s || n.requestBody ? { redirect: "error" } : {},
        ...l?.supported && l.params ? l.params : {},
        onResponseMeta: this._captureResponseMetadata,
        logger: n.logger ?? this._logger
      });
    }
    normalizeMeltQuoteRequestOptions(e) {
      if (!e.options)
        return { ...e };
      let t = { ...e.options };
      return e.options.amountless && (t.amountless = { amount_msat: j.from(e.options.amountless.amount_msat).toBigInt() }), "mpp" in e.options && e.options.mpp && (t.mpp = { amount: j.from(e.options.mpp.amount).toBigInt() }), {
        ...e,
        options: t
      };
    }
    isValidMethodString(e) {
      return !!(typeof e == "string" && /^[a-z0-9_-]+$/.test(e));
    }
    normalizeSignatureAmounts(e) {
      return this.assertRecordEntries(e, "signatures"), e.map((e) => ({
        ...e,
        amount: j.from(e.amount)
      }));
    }
    normalizeMessageAmounts(e) {
      return this.assertRecordEntries(e, "outputs"), e.map((e) => ({
        ...e,
        amount: j.from(e.amount)
      }));
    }
    stripWalletFields(e) {
      return e.map((e) => {
        let { dleq: t, p2pk_e: n, ...r } = e;
        return r;
      });
    }
    assertRecordEntries(e, t) {
      if (!e.every((e) => K(e)))
        throw this._logger.error("Invalid response from mint...", {
          entries: e.length,
          op: t
        }), new S("Invalid response from mint");
    }
    assertSignatureCount(e, t, n) {
      if (!(e.length <= t.length))
        throw this._logger.error("Invalid response from mint...", {
          signatures: e.length,
          outputs: t.length,
          op: n
        }), new S(`Invalid response from mint: ${e.length} signatures, expected ${t.length}. The operation may already have been applied; if the wallet is seeded, try restoring (NUT-09) to recover.`);
    }
    assertKeysetList(e, t) {
      if (e.length > 1e4)
        throw this._logger.error("Invalid response from mint...", {
          keysets: e.length,
          op: t
        }), new S("Invalid response from mint");
      this.assertRecordEntries(e, t);
    }
    normalizeMintQuoteResponse(e, t, n) {
      let r = `${e} mint quote`;
      if (!K(t))
        throw this._logger.error("Invalid response from mint...", {
          type: Eo(t),
          op: r
        }), new S("Invalid response from mint");
      let i = { ...t };
      return this.normalizeMintBaseFields(i), e === "bolt11" ? this.normalizeMintQuoteBolt11Fields(i) : e === "bolt12" ? this.normalizeMintQuoteBolt12Fields(i) : e === "onchain" && this.normalizeMintQuoteOnchainFields(i), n ? n(i) : i;
    }
    normalizeMintBaseFields(e) {
      e.amount_paid != null && e.amount_issued != null && (e.amount_paid = j.from(e.amount_paid), e.amount_issued = j.from(e.amount_issued)), e.updated_at = X(e.updated_at, "mintQuote.updated_at", null);
    }
    deriveMintQuoteState(e, t) {
      return e.isZero() && t.isZero() ? Va.UNPAID : e.greaterThan(t) ? Va.PAID : Va.ISSUED;
    }
    normalizeMintQuoteBolt11Fields(e) {
      e.amount = j.from(e.amount), e.expiry = X(e.expiry, "mintQuoteBolt11.expiry", null), (typeof e.state != "string" || !Object.values(Va).includes(e.state)) && e.amount_paid instanceof j && e.amount_issued instanceof j && (e.state = this.deriveMintQuoteState(e.amount_paid, e.amount_issued));
    }
    normalizeMintQuoteBolt12Fields(e) {
      ca(e, "amount"), e.amount = e.amount === null ? null : j.from(e.amount), e.expiry = X(e.expiry, "mintQuoteBolt12.expiry", null), e.amount_paid = j.from(e.amount_paid), e.amount_issued = j.from(e.amount_issued);
    }
    normalizeMintQuoteOnchainFields(e) {
      e.expiry = X(e.expiry, "mintQuoteOnchain.expiry", null), e.amount_paid = j.from(e.amount_paid), e.amount_issued = j.from(e.amount_issued);
    }
    normalizeMeltQuoteResponse(e, t, n, r = false) {
      let i = `${e} melt quote`;
      if (!K(t))
        throw this._logger.error("Invalid response from mint...", {
          type: Eo(t),
          op: i
        }), new S("Invalid response from mint");
      let a = { ...t };
      return r && ((a.request == null || a.request === "") && delete a.request, a.fee_reserve ?? delete a.fee_reserve), this.normalizeMeltBaseFields(a, i), e === "bolt11" || e === "bolt12" ? this.normalizeMeltBoltFields(a, e, i, r) : e === "onchain" && this.normalizeMeltOnchainFields(a, r), n ? n(a) : a;
    }
    normalizeMeltBaseFields(e, t) {
      if (e.amount = j.from(e.amount), e.expiry = X(e.expiry, "meltQuote.expiry", undefined), e.change) {
        if (!Array.isArray(e.change) || e.change.length > 1024)
          throw this._logger.error("Invalid response from mint...", {
            type: Eo(e.change),
            op: t
          }), new S("Invalid response from mint");
        e.change = this.normalizeSignatureAmounts(e.change);
      }
      if (!G(e) || typeof e.quote != "string" || !(e.amount instanceof j) || typeof e.unit != "string" || typeof e.state != "string" || typeof e.expiry != "number" || !Object.values(Ha).includes(e.state))
        throw this._logger.error("Invalid response from mint...", { op: t }), new S("Invalid response from mint");
    }
    normalizeMeltBoltFields(e, t, n, r) {
      let i = (t) => r && e[t] === undefined;
      if (!i("fee_reserve") && e.fee_reserve != null && (e.fee_reserve = j.from(e.fee_reserve)), typeof e.request != "string" && !i("request") || !(e.fee_reserve instanceof j) && !i("fee_reserve"))
        throw this._logger.error("Invalid response from mint...", { op: n }), new S("Invalid response from mint");
      Fa(e, t, this._logger, n);
    }
    normalizeMeltOnchainFields(e, t) {
      if (t && e.fee_options === undefined) {
        ca(e, "selected_fee_index", "outpoint");
        return;
      }
      if (!Array.isArray(e.fee_options) || e.fee_options.length === 0 || e.fee_options.length > 1024 || (e.fee_options = e.fee_options.map((e) => {
        let t = e;
        if (!Number.isSafeInteger(t.fee_index))
          throw this._logger.error("Invalid response from mint...", { op: "onchain melt quote" }), new S("Invalid response from mint");
        return {
          ...t,
          fee_index: t.fee_index,
          fee_reserve: j.from(t.fee_reserve),
          estimated_blocks: t.estimated_blocks
        };
      }), ca(e, "selected_fee_index", "outpoint"), typeof e.request != "string" || e.selected_fee_index !== null && !Number.isSafeInteger(e.selected_fee_index) || e.outpoint !== null && typeof e.outpoint != "string"))
        throw this._logger.error("Invalid response from mint...", { op: "onchain melt quote" }), new S("Invalid response from mint");
    }
  };
  var Oo = class e {
    constructor(e, t, n, r, i) {
      this._keys = {}, this._id = e, this._unit = t, this._active = n, this._input_fee_ppk = r, this._final_expiry = i;
    }
    get id() {
      return this._id;
    }
    get unit() {
      return this._unit;
    }
    get isActive() {
      return this._active;
    }
    get fee() {
      return this._input_fee_ppk ?? 0;
    }
    get expiry() {
      return this._final_expiry;
    }
    get hasKeys() {
      return Object.keys(this._keys).length > 0;
    }
    get hasHexId() {
      return U(this._id);
    }
    get version() {
      return this.hasHexId ? hexToBytes(this._id)[0] : -1;
    }
    get keys() {
      return this._keys;
    }
    set keys(e) {
      this._keys = e;
    }
    toMintKeyset() {
      return {
        id: this._id,
        unit: this._unit,
        active: this._active,
        input_fee_ppk: this._input_fee_ppk,
        final_expiry: this._final_expiry
      };
    }
    toMintKeys() {
      return this.hasKeys ? {
        id: this._id,
        unit: this._unit,
        active: this._active,
        input_fee_ppk: this._input_fee_ppk,
        final_expiry: this._final_expiry,
        keys: this._keys
      } : null;
    }
    verify() {
      return this.hasKeys ? e.verifyKeysetId(this.toMintKeys()) : false;
    }
    static verifyKeysetId(e) {
      try {
        let t = e.keys ? Object.keys(e.keys).length : 0;
        if (t === 0 || t > 256 || new Set(Object.values(e.keys).map((e) => e.toLowerCase())).size !== t)
          return false;
        let n = at(e.id) && !U(e.id), r = U(e.id) ? hexToBytes(e.id)[0] : 0;
        return aa(e.keys, {
          input_fee_ppk: e.input_fee_ppk,
          expiry: e.final_expiry,
          unit: e.unit,
          versionByte: r,
          isDeprecatedBase64: n
        }) === e.id;
      } catch {
        return false;
      }
    }
    static fromMintApi(t, n) {
      let r = La(t), i = n ? Ra(n) : undefined, a = new e(r.id, r.unit, r.active, r.input_fee_ppk, r.final_expiry);
      if (i) {
        if (i.id !== r.id)
          throw new S(`Mismatched keyset ids: meta=${r.id}, keys=${i.id}`);
        if (i.unit !== r.unit)
          throw new S(`Mismatched keyset units: meta=${r.unit}, keys=${i.unit}`);
        if (i.final_expiry !== undefined && r.final_expiry !== undefined && i.final_expiry !== r.final_expiry)
          throw new S(`Mismatched keyset expiry for id=${r.id}`);
        a.keys = i.keys;
      }
      return a;
    }
  };
  var ko = class e {
    assertInitialized() {
      k(Object.keys(this.keysets).length === 0, "KeyChain not initialized", this._logger);
    }
    constructor(e, t, n = O) {
      this.keysets = Object.create(null), this.pendingKeyFetches = /* @__PURE__ */ new Map, this.generation = 0, this.refreshSeq = 0, this.mint = typeof e == "string" ? new Do(e) : e, this.unit = t, this._logger = n;
    }
    static fromCache(t, n, r, i) {
      let a = new e(t, n, i);
      return a.loadFromCache(r), a;
    }
    static mintToCacheDTO(e, t, n) {
      let r = new Map(n.map((e) => [e.id, e]));
      return {
        keysets: t.map((e) => {
          let t = r.get(e.id), n = { ...e };
          return t && (n.keys = { ...t.keys }), n;
        }),
        mintUrl: e,
        savedAt: Date.now()
      };
    }
    static cacheToMintDTO(e) {
      return {
        keysets: e.keysets.map((e) => ({
          id: e.id,
          unit: e.unit,
          active: e.active,
          input_fee_ppk: e.input_fee_ppk,
          final_expiry: e.final_expiry
        })),
        keys: e.keysets.filter((e) => !!e.keys).map((e) => ({
          id: e.id,
          unit: e.unit,
          active: e.active,
          input_fee_ppk: e.input_fee_ppk,
          final_expiry: e.final_expiry,
          keys: { ...e.keys }
        }))
      };
    }
    async init(e) {
      if (Object.keys(this.keysets).length > 0 && !e)
        return;
      let t = ++this.refreshSeq, [n, r] = await Promise.all([this.mint.getKeySets(), this.mint.getKeys()]);
      if (t !== this.refreshSeq) {
        this._logger.debug("Discarding keychain refresh superseded by a later one", { seq: t });
        return;
      }
      this.buildKeychain(n.keysets, r.keysets), this.savedAt = Date.now();
    }
    loadFromCache(t) {
      let n;
      try {
        n = la(String(t.mintUrl));
      } catch {
        n = undefined;
      }
      n !== this.mint.mintUrl && this._logger.warn(`KeyChain cache is for a different mint: ${n ?? "unknown"} (expected ${this.mint.mintUrl}). This will become an error in cashu-ts v5.`, {
        cacheMintUrl: t.mintUrl,
        mintUrl: this.mint.mintUrl
      });
      let { keysets: r, keys: i } = e.cacheToMintDTO(t);
      this.buildKeychain(r, i), this.savedAt = t.savedAt;
    }
    buildKeychain(e, t) {
      let n = this.keysets, r = Object.create(null), i = new Map(t.map((e) => [e.id, e]));
      for (let t of e) {
        let e = i.get(t.id), a = e ? Oo.fromMintApi(t, e) : Oo.fromMintApi(t);
        a.verify() || (a.hasKeys && this._logger.warn("Discarding keys that do not derive their keyset id", { id: a.id }), a.keys = {});
        let o = n[t.id];
        !a.hasKeys && o?.hasKeys && o.unit === a.unit && (a.keys = { ...o.keys }, a.verify() || (this._logger.warn("Dropping carried keys: fresh metadata no longer derives the keyset id", { id: a.id }), a.keys = {})), r[a.id] = a;
      }
      this.keysets = r, this.generation++;
    }
    getKeyset(e) {
      let t = e ? this.keysets[e] : this.getCheapestKeyset();
      return ce(t, `Keyset '${e}' not found`, this._logger, { keysetId: e }), t;
    }
    getCheapestKeyset() {
      this.assertInitialized();
      let e = Object.values(this.keysets).filter((e) => e.unit === this.unit && e.isActive && e.hasHexId), t = e.filter((e) => e.hasKeys && e.version <= 1);
      if (t.length === 0) {
        let t = e.filter((e) => e.version > 1);
        if (t.length > 0) {
          let e = Math.min(...t.map((e) => e.version));
          se(`No supported keyset for unit: ${this.unit}. The mint's active keysets are ${ia(e)} or later; this build of cashu-ts supports up to ${ia(1)}. Upgrade to spend on this mint.`, this._logger, {
            unit: this.unit,
            lowestVersionByte: e,
            supported: 1
          });
        }
        se(`No active keyset found for unit: ${this.unit}`, this._logger, { unit: this.unit });
      }
      let n = 2 ** 53 - 1;
      return t.sort((e, t) => t.version - e.version || e.fee - t.fee || (t.expiry ?? n) - (e.expiry ?? n))[0];
    }
    async ensureKeysetKeys(e) {
      let t = this.keysets[e];
      if (ce(t, `Keyset '${e}' not found`, this._logger, { keysetId: e }), W(t.id, this._logger), t.hasKeys)
        return t;
      let n = this.pendingKeyFetches.get(e);
      if (n)
        return await n;
      let r = (async () => {
        let n = this.generation, r = (await this.mint.getKeys(e)).keysets.find((t) => t.id === e);
        k(!r || !r.keys || Object.keys(r.keys).length === 0, `Mint returned no keys for keyset '${e}'`, this._logger, { keysetId: e });
        let i = t.toMintKeyset(), a = Oo.fromMintApi(i, r);
        if (k(!a.verify(), `Keyset verification failed for ID ${e}`, this._logger, { keysetId: e }), this.generation !== n) {
          this._logger.debug("Keychain refreshed during key fetch; returning the live keyset", { id: e });
          let t = this.keysets[e];
          return ce(t, `Keyset '${e}' not found`, this._logger, { keysetId: e }), t;
        }
        return this.keysets[e] = a, a;
      })();
      this.pendingKeyFetches.set(e, r);
      try {
        return await r;
      } finally {
        this.pendingKeyFetches.delete(e);
      }
    }
    getKeysets() {
      this.assertInitialized();
      let e = Object.values(this.keysets).filter((e) => e.unit === this.unit);
      return k(e.length === 0, `No keysets found for unit: ${this.unit}`, this._logger, { unit: this.unit }), e;
    }
    isUnitKeyset(e) {
      if (!e)
        return false;
      let t = this.keysets[e];
      return t !== undefined && t.unit === this.unit;
    }
    hasKeyset(e) {
      return !!e && this.keysets[e] !== undefined;
    }
    getAllKeys() {
      return this.assertInitialized(), Object.values(this.keysets).map((e) => e.toMintKeys()).filter((e) => e !== null);
    }
    getAllKeysetIds() {
      return this.assertInitialized(), Object.keys(this.keysets);
    }
    get cache() {
      let t = Object.values(this.keysets), n = t.map((e) => e.toMintKeyset()), r = t.map((e) => e.toMintKeys()).filter((e) => e !== null), i = e.mintToCacheDTO(this.mint.mintUrl, n, r);
      return i.savedAt = this.savedAt, i;
    }
  };
  var Ao = class {
    constructor(e, t, n) {
      this.amountValue = j.from(e), this.B_ = t, this.id = n;
    }
    get amount() {
      return this.amountValue;
    }
    getSerializedBlindedMessage() {
      return {
        amount: this.amountValue,
        B_: this.B_.toHex(true),
        id: this.id
      };
    }
  };
  var jo = new Set([
    "locktime",
    "pubkeys",
    "n_sigs",
    "refund",
    "n_sigs_refund",
    "sigflag"
  ]);
  function Mo(e) {
    if (!e || typeof e != "string")
      throw new S("tag key must be a non empty string");
    if (jo.has(e))
      throw new S(`additionalTags must not use reserved key "${e}"`);
  }
  var Q = class e {
    constructor(e, t, n, r) {
      if (typeof t != "bigint" || t <= 0n)
        throw new S("OutputData: blindingFactor must be a positive bigint");
      if (!(n instanceof Uint8Array) || n.length === 0)
        throw new S("OutputData: secret must be a non-empty Uint8Array");
      if (e == null)
        throw new S("OutputData: blindedMessage is required");
      this.secret = n, this.blindingFactor = t, this.blindedMessage = e, this.ephemeralE = r;
    }
    toProof(e, t) {
      if (e == null)
        throw new S("Mint response is missing a signature for one of the outputs. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.");
      if (!this.blindedMessage.amount.isZero() && e.id !== this.blindedMessage.id)
        throw new S(`Mint signature keyset id ${e.id} does not match output ${this.blindedMessage.id}`);
      let r;
      e.dleq && (r = {
        s: hexToBytes(e.dleq.s),
        e: hexToBytes(e.dleq.e),
        r: this.blindingFactor
      });
      let a = e.amount.toString(), o = P(t.keys[a]);
      if (r) {
        let t = P(this.blindedMessage.B_), n = P(e.C_);
        if (!lr(r, t, n, o))
          throw new S("DLEQ verification failed on mint response");
      }
      let s = Zt({
        id: e.id,
        C_: P(e.C_)
      }, this.blindingFactor, this.secret, o), c = {
        id: e.id,
        amount: e.amount,
        C: s.C.toHex(true),
        secret: Te(s.secret),
        ...r && { dleq: {
          s: bytesToHex(r.s),
          e: bytesToHex(r.e),
          r: Vi(this.blindingFactor)
        } }
      };
      return this.ephemeralE && (c.p2pk_e = this.ephemeralE), c;
    }
    static createP2PKData(e, t, n, r) {
      let i = H(t, n.keys, r), a = e.blindKeys && e.sigFlag === "SIG_ALL" ? Kt() : undefined;
      return i.map((t) => this.createSingleP2PKData(e, t, n.id, a));
    }
    static createSingleP2PKData(t, r, i, o) {
      let s = j.from(r), c = Fn2(t), l = Array.isArray(c.pubkey) ? c.pubkey : [c.pubkey], u = c.refundKeys ?? [], d = c.requiredSignatures ?? 1, f = c.requiredRefundSignatures ?? 1, p = c.hashlock, m = typeof p == "string" && p.length > 0, h = m ? p : l[0], g = m ? l : l.slice(1), _ = u, v;
      if (t.blindKeys) {
        let { blinded: e, Ehex: t } = Tn([...l, ...u], o, !m);
        m ? g = e.slice(0, l.length) : (h = e[0], g = e.slice(1, l.length)), _ = e.slice(l.length), v = t;
      }
      let y = [], b = c.locktime ?? NaN;
      if (Number.isSafeInteger(b) && b >= 0 && y.push(["locktime", String(b)]), g.length > 0 && (y.push(["pubkeys", ...g]), d > 1 && y.push(["n_sigs", String(d)])), _.length > 0 && (y.push(["refund", ..._]), f > 1 && y.push(["n_sigs_refund", String(f)])), c.sigFlag == "SIG_ALL" && y.push(["sigflag", "SIG_ALL"]), c.additionalTags?.length) {
        let e = c.additionalTags.map(([e, ...t]) => (Mo(e), [e, ...t.map(String)]));
        y.push(...e);
      }
      let x = [m ? "HTLC" : "P2PK", {
        nonce: bytesToHex(randomBytes(32)),
        data: h,
        tags: y
      }], C = JSON.stringify(x), w = [...C].length;
      if (w > 1024)
        throw new S(`Secret too long (${w} characters), maximum is ${fe}`);
      let T = new TextEncoder().encode(C), { r: E, B_: D } = Yt(T);
      return new e(new Ao(s, D, i).getSerializedBlindedMessage(), E, T, v);
    }
    static createRandomData(e, t, n) {
      return H(e, t.keys, n).map((e) => this.createSingleRandomData(e, t.id));
    }
    static createSingleRandomData(t, r) {
      let i = j.from(t), o = bytesToHex(randomBytes(32)), s = new TextEncoder().encode(o), { r: c, B_: l } = Yt(s);
      return new e(new Ao(i, l, r).getSerializedBlindedMessage(), c, s);
    }
    static createDeterministicData(e, t, n, r, i) {
      let a = H(e, r.keys, i), o = yr(t, r.id);
      return a.map((e, t) => No(e, r.id, o(n + t)));
    }
    static createSingleDeterministicData(e, t, n, r) {
      return No(e, r, vr(t, r, n));
    }
    static sumOutputAmounts(e) {
      return j.sum(e.map((e) => e.blindedMessage.amount));
    }
    static serialize(e) {
      return {
        blindedMessage: {
          amount: e.blindedMessage.amount.toString(),
          B_: e.blindedMessage.B_,
          id: e.blindedMessage.id
        },
        blindingFactor: e.blindingFactor.toString(),
        secret: bytesToHex(e.secret),
        ...e.ephemeralE && { ephemeralE: e.ephemeralE }
      };
    }
    static deserialize(t) {
      try {
        if (!/^(0|[1-9]\d*)$/.test(t.blindingFactor))
          throw new S("blindingFactor must be a canonical decimal integer");
        let n = hexToBytes(t.secret);
        Te(n);
        let r = BigInt(t.blindingFactor), { B_: a } = Yt(n, r);
        if (a.toHex(true) !== t.blindedMessage.B_.toLowerCase())
          throw new S("stored output does not match its secret. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.");
        return new e({
          amount: j.from(t.blindedMessage.amount),
          B_: t.blindedMessage.B_,
          id: t.blindedMessage.id
        }, r, n, t.ephemeralE ? P(t.ephemeralE).toHex(true) : undefined);
      } catch (e) {
        throw new S(`Invalid SerializedOutputData: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
  };
  function No(e, t, r) {
    let i = j.from(e), a = bytesToHex(r.secret), o = new TextEncoder().encode(a), { r: s, B_: c } = Yt(o, bytesToNumberBE(r.blindingFactor));
    return new Q(new Ao(i, c, t).getSerializedBlindedMessage(), s, o);
  }
  function Po(e) {
    return e instanceof Date ? Math.floor(e.getTime() / 1000) : Math.floor(e < 1000000000000 ? e : e / 1000);
  }
  var $ = class e {
    constructor() {
      this.lockKeys = [], this.refundKeys = [], this.extraTags = [];
    }
    addMainPubkey(e) {
      let t = Array.isArray(e) ? e : [e];
      return this.lockKeys = R([...this.lockKeys, ...t]), this;
    }
    addLockPubkey(e) {
      return this.addMainPubkey(e);
    }
    addRefundPubkey(e) {
      let t = Array.isArray(e) ? e : [e];
      return this.refundKeys = R([...this.refundKeys, ...t]), this;
    }
    lockUntil(e) {
      return this.locktime = Po(e), this;
    }
    requireMainSignatures(e) {
      if (!Number.isInteger(e) || e < 1)
        throw new S(`requiredSignatures (n_sigs) must be a positive integer, got ${e}`);
      return this.nSigs = e, this;
    }
    requireLockSignatures(e) {
      return this.requireMainSignatures(e);
    }
    requireRefundSignatures(e) {
      if (!Number.isInteger(e) || e < 1)
        throw new S(`requiredRefundSignatures (n_sigs_refund) must be a positive integer, got ${e}`);
      return this.nSigsRefund = e, this;
    }
    addTag(e, t) {
      Mo(e);
      let n = t === undefined ? [] : Array.isArray(t) ? t : [t];
      return this.extraTags.push([e, ...n.map(String)]), this;
    }
    addTags(e) {
      for (let [t, ...n] of e)
        this.addTag(t, n);
      return this;
    }
    blindKeys() {
      return this._blindKeys = true, this;
    }
    sigAll() {
      return this.sigFlag = "SIG_ALL", this;
    }
    addHashlock(e) {
      return this.hashlock = e, this;
    }
    toOptions() {
      let e = this.lockKeys, t = this.refundKeys;
      if (e.length === 0 && !this.hashlock)
        throw new S("At least one lock pubkey is required");
      let n = {
        pubkey: e.length === 1 ? e[0] : e,
        ...this.locktime === undefined ? {} : { locktime: this.locktime },
        ...t.length ? { refundKeys: t } : {},
        ...this.nSigs !== undefined && (this.nSigs > 1 || e.length === 0) ? { requiredSignatures: this.nSigs } : {},
        ...this.nSigsRefund !== undefined && (this.nSigsRefund > 1 || t.length === 0) ? { requiredRefundSignatures: this.nSigsRefund } : {},
        ...this.extraTags.length ? { additionalTags: this.extraTags.slice() } : {},
        ...this._blindKeys ? { blindKeys: true } : {},
        ...this.sigFlag == "SIG_ALL" ? { sigFlag: "SIG_ALL" } : {},
        ...this.hashlock ? { hashlock: this.hashlock } : {}
      };
      return Q.createSingleP2PKData(n, 1, "deedbeef"), n;
    }
    static fromOptions(t) {
      let n = new e;
      if (t.refundKeys !== undefined && !Array.isArray(t.refundKeys))
        throw new S("refundKeys must be an array of pubkeys");
      if (t.blindKeys !== undefined && typeof t.blindKeys != "boolean")
        throw new S("blindKeys must be a boolean");
      let r = Array.isArray(t.pubkey) ? t.pubkey : [t.pubkey];
      return n.addMainPubkey(r), t.locktime !== undefined && n.lockUntil(t.locktime), t.refundKeys?.length && n.addRefundPubkey(t.refundKeys), t.requiredSignatures !== undefined && n.requireMainSignatures(t.requiredSignatures), t.requiredRefundSignatures !== undefined && n.requireRefundSignatures(t.requiredRefundSignatures), t.additionalTags?.length && n.addTags(t.additionalTags), t.blindKeys && n.blindKeys(), t.sigFlag == "SIG_ALL" && n.sigAll(), t.hashlock && n.addHashlock(t.hashlock), n;
    }
  };
  var Fo = $;
  function Io(e, t, n, r = false, i = false, a = O) {
    let o = Y(e), s = j.from(t), c = s.toBigInt(), l = Ce(), u = null, d = null, f = 0n, p = 0n, m = (e) => {
      let t;
      try {
        t = n.getKeyset(e.id).fee;
      } catch (t) {
        let r = `Could not get fee. No keyset found for keyset id: ${e.id}`;
        throw a.error(r, {
          error: t,
          keychain: n.getKeysets()
        }), new S(r, { cause: t });
      }
      return k(!n.isUnitKeyset(e.id), `Proof has unrecognised keyset. '${e.id}' is not a keyset for this wallet unit`, a, { id: e.id }), BigInt(t);
    }, h = (e, t) => e - (r ? (t + 999n) / 1000n : 0n), g = (e) => {
      let t = [...e];
      for (let e = t.length - 1;e > 0; e--) {
        let n = Math.floor(Math.random() * (e + 1));
        [t[e], t[n]] = [t[n], t[e]];
      }
      return t;
    }, _ = (e, t, n) => {
      let r = 0, i = e.length - 1, a = null;
      for (;r <= i; ) {
        let o = Math.floor((r + i) / 2), s = e[o].exFee;
        (n ? s <= t : s >= t) ? (a = o, n ? r = o + 1 : i = o - 1) : n ? i = o - 1 : r = o + 1;
      }
      return n ? a : r < e.length ? r : null;
    }, v = (e, t) => {
      let n = t.exFee, r = 0, i = e.length;
      for (;r < i; ) {
        let t = Math.floor((r + i) / 2);
        e[t].exFee < n ? r = t + 1 : i = t;
      }
      e.splice(r, 0, t);
    }, y = (e, t) => h(e, t) < c ? null : 1000n * e + t - 1000n * c, b = 0n, x = 0n, C = /* @__PURE__ */ new Set, w = o.map((e, t) => {
      k(C.has(e.secret), `Duplicate proof at index ${t}: each proof may appear only once`, a, { index: t }), C.add(e.secret);
      let n = m(e), i = e.amount.toBigInt(), o = r ? i - n / 1000n : i, s = {
        proof: e,
        amountBig: i,
        exFee: o,
        ppkfee: n
      };
      return (!r || o > 0n) && (b += i, x += n), s;
    }), T = r ? w.filter((e) => e.exFee > 0n) : w;
    if (T.sort((e, t) => e.exFee < t.exFee ? -1 : +(e.exFee > t.exFee)), T.length > 0) {
      let e;
      if (i) {
        let t = _(T, c + 1n, true);
        e = t === null ? 0 : t + 1;
      } else {
        let t = _(T, c + 1n, false);
        if (t !== null) {
          let n = T[t].exFee, r = _(T, n, true);
          ce(r, "Unexpected null rightIndex in binary search", a), e = r + 1;
        } else
          e = T.length;
      }
      for (let t = e;t < T.length; t++)
        b -= T[t].amountBig, x -= T[t].ppkfee;
      T = T.slice(0, e);
    }
    let E = h(b, x);
    if (s.isZero() || c > E)
      return {
        keep: o,
        send: []
      };
    let D = c < E ? c : E;
    for (let e = 0;e < 60; e++) {
      let t = [], n = 0n, r = 0n;
      for (let e of g(T)) {
        let a = n + e.amountBig, o = r + e.ppkfee, s = h(a, o);
        if (i && s > c || (t.push(e), n = a, r = o, s >= c))
          break;
      }
      let o = new Set(t), s = T.filter((e) => !o.has(e)), m = g(Array.from({ length: t.length }, (e, t) => t)).slice(0, 5000);
      for (let e of m) {
        let a = h(n, r);
        if (a === c || !i && a >= c && a <= D)
          break;
        let o = t[e], l = n - o.amountBig, u = r - o.ppkfee, d = c - h(l, u), f = _(s, d, i);
        if (f !== null) {
          let a = s[f];
          (!i || a.exFee > o.exFee) && (d >= 0n || a.exFee <= o.exFee) && (t[e] = a, n = l + a.amountBig, r = u + a.ppkfee, s.splice(f, 1), v(s, o));
        }
      }
      let b = y(n, r);
      if (b !== null && (d === null || b < d)) {
        a.debug(`selectProofsToSend: best solution found in trial #${e} - amount: ${n}, delta: ${b}`), u = [...t].sort((e, t) => t.exFee < e.exFee ? -1 : +(t.exFee > e.exFee)), d = b, f = n, p = r;
        let i = [...u];
        for (;i.length > 1 && d > 0n; ) {
          let e = i.pop(), t = n - e.amountBig, a = r - e.ppkfee, o = y(t, a);
          if (o === null)
            break;
          o < d && (u = [...i], d = o, f = t, p = a, n = t, r = a);
        }
      }
      if (u && d !== null) {
        let e = h(f, p);
        if (e === c || !i && e >= c && e <= D)
          break;
      }
      if (l.elapsed() > 1000) {
        k(i, "Proof selection took too long. Try again with a smaller proof set.", a), a.warn("Proof selection took too long. Returning best selection so far.");
        break;
      }
    }
    if (u && d !== null) {
      let e = u.map((e) => e.proof), t = new Set(e), n = o.filter((e) => !t.has(e));
      return a.info(`Proof selection took ${l.elapsed()}ms`), {
        keep: n,
        send: e
      };
    }
    return {
      keep: o,
      send: []
    };
  }
  function Lo(e, t, n, r = false, i = false, a = O) {
    let o = Y(e), s = j.from(t), c = s.toBigInt(), l = (e, t) => e - (r ? (t + 999n) / 1000n : 0n), u = (e) => {
      let t = new Set(e.map((e) => e.secret));
      return {
        keep: o.filter((e) => !t.has(e.secret)),
        send: e
      };
    }, d = /* @__PURE__ */ new Set, f = /* @__PURE__ */ new Map;
    for (let [e, t] of o.entries()) {
      k(d.has(t.secret), `Duplicate proof at index ${e}: each proof may appear only once`, a, { index: e }), d.add(t.secret);
      let r = n.getKeyset(t.id);
      k(!n.isUnitKeyset(t.id), `Proof has unrecognised keyset. '${t.id}' is not a keyset for this wallet unit`, a, { id: t.id });
      let i = (r.hasHexId ? parseInt(t.id.slice(0, 2), 16) + 1 : 0) * 2 + +!!r.isActive, o = f.get(i) ?? {
        proofs: [],
        gross: 0n,
        ppk: 0n
      };
      o.proofs.push(t), o.gross += t.amount.toBigInt(), o.ppk += BigInt(r.fee), f.set(i, o);
    }
    let p = [...f.keys()].sort((e, t) => e - t);
    if (s.isZero() || p.length <= 1)
      return Io(o, s, n, r, i, a);
    let m = [], h = 0n, g = 0n, _ = 0;
    for (;_ < p.length; _++) {
      let e = f.get(p[_]), t = l(h + e.gross, g + e.ppk);
      if (t > c)
        break;
      for (let t of e.proofs)
        m.push(t);
      if (h += e.gross, g += e.ppk, t === c)
        return u(m);
    }
    if (_ < p.length) {
      let e = c - l(h, g), t = f.get(p[_]).proofs, o = p.slice(_ + 1).flatMap((e) => f.get(e).proofs), s = o.length ? [t, t.concat(o)] : [t];
      for (let t of s) {
        let o;
        try {
          o = Io(t, e, n, r, i, a);
        } catch (e) {
          a.debug("selectProofsRotating: biased attempt failed", { error: e });
          continue;
        }
        if (o.send.length === 0)
          continue;
        let s = h, d = g;
        for (let e of o.send)
          s += e.amount.toBigInt(), d += BigInt(n.getKeyset(e.id).fee);
        let f = l(s, d);
        if (i ? f === c : f >= c)
          return u(m.concat(o.send));
      }
    }
    return Io(o, s, n, r, i, a);
  }
  var Vo = class e {
    createP2PKData(t, n, r, i) {
      if (this.createSingleP2PKData === e.prototype.createSingleP2PKData)
        return Q.createP2PKData(t, n, r, i);
      let a = H(n, r.keys, i), o = t.blindKeys && t.sigFlag === "SIG_ALL" ? Kt() : undefined, s = a.map((e) => this.createSingleP2PKData(t, e, r.id, o));
      if (o && new Set(s.map((e) => e.ephemeralE)).size > 1)
        throw new S("createSingleP2PKData override must reuse the shared eBytes ephemeral key for a SIG_ALL split");
      return s;
    }
    createSingleP2PKData(e, t, n, r) {
      return Q.createSingleP2PKData(e, t, n, r);
    }
    createRandomData(e, t, n) {
      return H(e, t.keys, n).map((e) => this.createSingleRandomData(e, t.id));
    }
    createSingleRandomData(e, t) {
      return Q.createSingleRandomData(e, t);
    }
    createDeterministicData(t, n, r, i, a) {
      if (this.createSingleDeterministicData === e.prototype.createSingleDeterministicData)
        return Q.createDeterministicData(t, n, r, i, a);
      let o = H(t, i.keys, a), s = r + (o.length - 1);
      if (!Number.isSafeInteger(r) || r < 0 || o.length > 0 && !Number.isSafeInteger(s))
        throw new S("Counter must be an integer in the range 0 <= counter <= 2^53 - 1");
      return o.map((e, t) => this.createSingleDeterministicData(e, n, r + t, i.id));
    }
    createSingleDeterministicData(e, t, n, r) {
      return Q.createSingleDeterministicData(e, t, n, r);
    }
  };
  function Ho(e) {
    return e <= 1n ? 0 : (e - 1n).toString(2).length;
  }
  function Uo(e) {
    let t = Object.keys(e).map((e) => j.from(e));
    return t.sort((e, t) => e.compareTo(t)), t;
  }
  function Wo(e) {
    if (e > 8192)
      throw new S(`Cannot split amount: optimized split would exceed ${le} outputs`);
  }
  function Go(e, t, n, r) {
    let i = j.from(t), a = [], o = j.zero(), s = e.map((e) => e.amount);
    for (let e of Uo(n)) {
      let t = s.filter((t) => e.equals(t)).length, n = Math.max(r - t, 0);
      for (let t = 0;t < n; ++t) {
        let t = o.add(e);
        if (t.greaterThan(i))
          break;
        Wo(a.length + 1), a.push(e), o = t;
      }
    }
    let c = i.subtract(o);
    if (!c.isZero()) {
      let e = H(c, n);
      Wo(a.length + e.length);
      for (let t of e)
        a.push(t), o = o.add(t);
    }
    return a.sort((e, t) => e.compareTo(t));
  }
  function Ko(e) {
    switch (e.type) {
      case "custom":
        return JSON.stringify({
          type: "custom",
          outputs: e.data.length,
          amounts: e.data.map((e) => e.blindedMessage.amount.toString())
        });
      case "factory":
        return JSON.stringify({
          type: "factory",
          denominations: (e.denominations ?? []).map((e) => j.from(e).toString())
        });
      case "deterministic":
        return JSON.stringify({
          type: "deterministic",
          counter: e.counter,
          denominations: (e.denominations ?? []).map((e) => j.from(e).toString())
        });
      case "p2pk": {
        let t = e.options, n = t.blindKeys ? {
          ...t,
          pubkey: Array.isArray(t.pubkey) ? t.pubkey.map(() => "[redacted]") : "[redacted]",
          refundKeys: t.refundKeys?.map(() => "[redacted]")
        } : t;
        return JSON.stringify({
          type: "p2pk",
          options: n,
          denominations: (e.denominations ?? []).map((e) => j.from(e).toString())
        });
      }
      case "random":
        return JSON.stringify({
          type: "random",
          denominations: (e.denominations ?? []).map((e) => j.from(e).toString())
        });
      default:
        return "Unknown";
    }
  }
  function qo(e) {
    return e.length === 12 ? e : U(e) ? e.toLowerCase() : e;
  }
  function Jo(e, t) {
    if (!Number.isSafeInteger(t))
      throw new S(`Reservation for counter key ${e} would take the cursor to ${t}, outside the safe integer range`);
  }
  var Yo = class {
    constructor(e) {
      if (this.next = /* @__PURE__ */ new Map, this.locks = /* @__PURE__ */ new Map, e)
        for (let [t, n] of Object.entries(e)) {
          let e = qo(t);
          Jo(e, n), this.next.set(e, Math.max(this.next.get(e) ?? 0, n));
        }
    }
    async withLock(e, t) {
      let n = qo(e), r = this.locks.get(n) ?? Promise.resolve(), i, a = new Promise((e) => i = e), o = r.then(() => a);
      this.locks.set(n, o);
      try {
        return await r, await t(n);
      } finally {
        i(), this.locks.get(n) === o && this.locks.delete(n);
      }
    }
    async reserve(e, t) {
      if (t < 0)
        throw new S("reserve called with negative count");
      return this.withLock(e, (e) => {
        let n = this.next.get(e) ?? 0;
        return t === 0 ? {
          start: n,
          count: 0
        } : (Jo(e, n + t), this.next.set(e, n + t), {
          start: n,
          count: t
        });
      });
    }
    async reserveAt(e, t, n) {
      if (t < 0 || n < 0)
        throw new S("reserveAt called with a negative start or count");
      return this.withLock(e, (e) => {
        let r = this.next.get(e) ?? 0;
        if (t < r)
          throw new S(`Counter ${t} for counter key ${e} was already issued (next is ${r})`);
        return Jo(e, t + n), this.next.set(e, t + n), {
          start: t,
          count: n
        };
      });
    }
    async advanceToAtLeast(e, t) {
      await this.withLock(e, (e) => {
        t > (this.next.get(e) ?? 0) && (Jo(e, t), this.next.set(e, t));
      });
    }
    async setNext(e, t) {
      await this.withLock(e, (e) => {
        if (t < 0)
          throw new S("setNext: negative next not allowed");
        Jo(e, t), this.next.set(e, t);
      });
    }
    snapshot() {
      return Promise.resolve(Object.fromEntries(this.next.entries()));
    }
  };
  var Zo = class {
    constructor(e) {
      this.src = e;
    }
    async peekNext(e) {
      return (await this.src.reserve(e, 0)).start;
    }
    async advanceToAtLeast(e, t) {
      await this.src.advanceToAtLeast(e, t);
    }
    async setNext(e, t) {
      if (typeof this.src.setNext == "function") {
        await this.src.setNext(e, t);
        return;
      }
      throw new S("CounterSource does not support setNext()");
    }
    async snapshot() {
      if (typeof this.src.snapshot == "function")
        return await this.src.snapshot();
      throw new S("CounterSource does not support snapshot()");
    }
  };
  function Qo() {}
  function $o(e) {
    let t = /* @__PURE__ */ new WeakSet;
    try {
      return JSON.stringify(e, (e, n) => {
        if (typeof n == "object" && n) {
          if (t.has(n))
            return "[Circular]";
          t.add(n);
        }
        return n;
      });
    } catch {
      return Object.prototype.toString.call(e);
    }
  }
  function es(e) {
    return {
      ...e,
      ...e.amount != null && { amount: j.from(e.amount) },
      ...e.amount_paid != null && { amount_paid: j.from(e.amount_paid) },
      ...e.amount_issued != null && { amount_issued: j.from(e.amount_issued) }
    };
  }
  function ts(e, t) {
    let n = {
      ...e,
      ...e.amount != null && { amount: j.from(e.amount) },
      ...e.fee_reserve != null && { fee_reserve: j.from(e.fee_reserve) },
      ...e.change && { change: e.change.map((e) => ({
        ...e,
        amount: j.from(e.amount)
      })) }
    };
    return Fa(n, "bolt11", t, "bolt11 melt quote update"), n;
  }
  function ns(e) {
    return e instanceof Error ? e : new S(typeof e == "string" ? e : $o(e), { cause: e });
  }
  function rs() {
    let e = /* @__PURE__ */ Error("Aborted");
    return Object.defineProperty(e, "name", { value: "AbortError" }), e;
  }
  function is(e) {
    e && Promise.resolve(e).then((e) => {
      try {
        e();
      } catch {}
    }).catch(() => {});
  }
  var as = class {
    constructor(e) {
      this.wallet = e, this.countersReservedHandlers = /* @__PURE__ */ new Set, this.keychainUpdatedHandlers = /* @__PURE__ */ new Set;
    }
    withAbort(e, t) {
      if (!e)
        return t;
      if (e.aborted)
        return t(), Qo;
      let n = () => t();
      return e.addEventListener("abort", n, { once: true }), () => {
        e.removeEventListener("abort", n), t();
      };
    }
    waitUntilPaid(e, t, n, r = "Timeout waiting for paid") {
      return new Promise((i, a) => {
        let o = null, s = null, c = false, l = (e) => {
          c || (c = true, is(o), s && (clearTimeout(s), s = null), n?.signal && n.signal.removeEventListener("abort", u), e && a(ns(e)));
        }, u = () => l(rs());
        if (n?.signal) {
          if (n.signal.aborted)
            return u();
          n.signal.addEventListener("abort", u, { once: true });
        }
        n?.timeoutMs && n.timeoutMs > 0 && (s = setTimeout(() => l(new S(r)), n.timeoutMs)), o = e(t, (e) => {
          l(), i(e);
        }, (e) => l(e), { signal: n?.signal }), o.catch((e) => l(e));
      });
    }
    countersReserved(e, t) {
      return this.countersReservedHandlers.add(e), this.withAbort(t?.signal, () => this.countersReservedHandlers.delete(e));
    }
    _emitCountersReserved(e) {
      for (let t of this.countersReservedHandlers)
        A(t, e, this.wallet.logger, { event: "countersReserved" });
    }
    keychainUpdated(e, t) {
      return this.keychainUpdatedHandlers.add(e), this.withAbort(t?.signal, () => this.keychainUpdatedHandlers.delete(e));
    }
    _emitKeychainUpdated() {
      if (this.keychainUpdatedHandlers.size === 0)
        return;
      let e = { cache: this.wallet.keyChain.cache };
      for (let t of this.keychainUpdatedHandlers)
        A(t, e, this.wallet.logger, { event: "keychainUpdated" });
    }
    async mintQuoteUpdates(e, t, n, r) {
      if (r?.signal?.aborted || (await this.wallet.mint.connectWebSocket(), r?.signal?.aborted))
        return Qo;
      let i = this.wallet.mint.webSocketConnection;
      if (!i)
        throw new S("Failed to establish WebSocket connection.");
      let a = Array.from(new Set(e)), o = (e) => {
        let r;
        try {
          r = es(e);
        } catch (e) {
          n(ns(e));
          return;
        }
        A(t, r, this.wallet.logger, { event: "bolt11_mint_quote" });
      }, s = i.createSubscription({
        kind: "bolt11_mint_quote",
        filters: a
      }, o, n);
      return this.withAbort(r?.signal, () => i.cancelSubscription(s, o));
    }
    async mintQuotePaid(e, t, n, r) {
      return this.mintQuoteUpdates([e], (e) => {
        e.state === Va.PAID && t(e);
      }, n, r);
    }
    async meltQuoteUpdates(e, t, n, r) {
      if (r?.signal?.aborted || (await this.wallet.mint.connectWebSocket(), r?.signal?.aborted))
        return Qo;
      let i = this.wallet.mint.webSocketConnection;
      if (!i)
        throw new S("Failed to establish WebSocket connection.");
      let a = Array.from(new Set(e)), o = (e) => {
        let r;
        try {
          r = ts(e, this.wallet.logger);
        } catch (e) {
          n(ns(e));
          return;
        }
        A(t, r, this.wallet.logger, { event: "bolt11_melt_quote" });
      }, s = i.createSubscription({
        kind: "bolt11_melt_quote",
        filters: a
      }, o, n);
      return this.withAbort(r?.signal, () => i.cancelSubscription(s, o));
    }
    async meltQuotePaid(e, t, n, r) {
      return this.meltQuoteUpdates([e], (e) => {
        e.state === Ha.PAID && t(e);
      }, n, r);
    }
    async proofStateUpdates(e, t, n, r) {
      if (r?.signal?.aborted)
        return Qo;
      for (let t of e)
        W(t.id, this.wallet.logger);
      if (await this.wallet.mint.connectWebSocket(), r?.signal?.aborted)
        return Qo;
      let i = this.wallet.mint.webSocketConnection;
      if (!i)
        throw new S("Failed to establish WebSocket connection.");
      let a = new TextEncoder, o = Object.create(null);
      for (let t of e) {
        let e = Bt(a.encode(t.secret)).toHex(true);
        if (o[e])
          throw new S("Duplicate proof secret in proofStateUpdates input");
        o[e] = t;
      }
      let s = Object.keys(o), c = (e) => {
        let n = o[e.Y];
        n && A(t, {
          ...e,
          proof: n
        }, this.wallet.logger, { event: "proof_state" });
      }, l = i.createSubscription({
        kind: "proof_state",
        filters: s
      }, c, n);
      return this.withAbort(r?.signal, () => i.cancelSubscription(l, c));
    }
    onceMintPaid(e, t) {
      return this.waitUntilPaid(this.mintQuotePaid.bind(this), e, t, "Timeout waiting for mint paid");
    }
    onceAnyMintPaid(e, t) {
      return new Promise((n, r) => {
        let i = Array.from(new Set(e)), a = /* @__PURE__ */ new Map, o = null, s = null, c = false, l = false, u = (e) => {
          if (!l) {
            l = true;
            for (let e of a.values())
              is(e);
            a.clear(), o && (clearTimeout(o), o = null), t?.signal && t.signal.removeEventListener("abort", d), e && r(ns(e));
          }
        }, d = () => u(rs());
        if (t?.signal) {
          if (t.signal.aborted)
            return d();
          t.signal.addEventListener("abort", d, { once: true });
        }
        if (t?.timeoutMs && t.timeoutMs > 0 && (o = setTimeout(() => u(new S("Timeout waiting for any mint paid")), t.timeoutMs)), i.length === 0)
          return u(new S("No quote ids provided"));
        for (let e of i) {
          let r = this.mintQuotePaid(e, (t) => {
            u(), n({
              id: e,
              quote: t
            });
          }, (n) => {
            if (t?.failOnError) {
              u(n);
              return;
            }
            s = n;
            let r = a.get(e);
            r && (is(r), a.delete(e)), c && a.size === 0 && u(s ?? new S("No subscriptions remaining"));
          });
          a.set(e, r), r.catch((n) => {
            if (t?.failOnError) {
              u(n);
              return;
            }
            s = n;
            let r = a.get(e);
            r && (is(r), a.delete(e)), c && a.size === 0 && u(s ?? new S("No subscriptions remaining"));
          });
        }
        c = true;
      });
    }
    onceMeltPaid(e, t) {
      return this.waitUntilPaid(this.meltQuotePaid.bind(this), e, t, "Timeout waiting for melt paid");
    }
    proofStatesStream(e, t) {
      return async function* () {
        let n = [], r = false, i = null, a = t?.maxBuffer && t.maxBuffer > 0 ? t.maxBuffer : Infinity, o = t?.drop ?? "oldest", s = () => {
          let e = i;
          i = null, e && e();
        }, c = (e) => {
          if (n.length >= a)
            if (o === "oldest") {
              let r = n.shift();
              if (r !== undefined)
                try {
                  t?.onDrop?.(r);
                } catch {}
              n.push(e);
            } else {
              try {
                t?.onDrop?.(e);
              } catch {}
              return;
            }
          else
            n.push(e);
          s();
        }, l = null, u = this.proofStateUpdates(e, c, () => {
          r = true, s();
        }, { signal: t?.signal });
        u.catch((e) => {
          l = ns(e), r = true, s();
        });
        let d = () => {
          r = true, s();
        };
        try {
          for (t?.signal && (t.signal.aborted ? d() : t.signal.addEventListener("abort", d, { once: true }));!r || n.length; ) {
            for (;n.length; )
              yield n.shift();
            if (r)
              break;
            await new Promise((e) => i = e);
          }
          if (l)
            throw l;
        } finally {
          is(u), t?.signal && t.signal.removeEventListener("abort", d);
        }
      }.call(this);
    }
    group() {
      let e = [], t = false, n = () => {
        if (!t)
          for (t = true;e.length; )
            is(e.pop());
      };
      return n.add = (n) => t ? (is(n), n) : (e.push(n), n), Object.defineProperty(n, "cancelled", {
        get: () => t,
        enumerable: true
      }), n;
    }
  };
  var os = /* @__PURE__ */ new WeakSet;
  function ss(e) {
    let { pubkey: t, refundKeys: n = [], hashlock: r } = Fn2(e);
    for (let e of [t, n].flat())
      try {
        P(e);
      } catch (e) {
        throw new S("payment request lock key is not a valid secp256k1 point", { cause: e });
      }
    if (r !== undefined && !/^[0-9a-f]{64}$/.test(r))
      throw new S("payment request hashlock must be a 64-character hex string");
  }
  var cs = class {
    constructor(e) {
      this.wallet = e;
    }
    send(e, t) {
      return new ls(this.wallet, e, t);
    }
    sendToRequest(e, t, n) {
      let r = this.wallet;
      if (e.amount && n !== undefined)
        throw new S("the request specifies its amount; omit the amount argument");
      let i = e.amount ?? (n === undefined ? undefined : j.from(n));
      if (!i)
        throw new S("amountless payment request: pass the chosen amount");
      if (!e.unit && (e.amount !== undefined || e.supportedMethods?.length))
        throw new S("invalid payment request: unit (u) is required when an amount (a) or supported methods (sm) are set");
      if (e.unit && e.unit !== r.unit)
        throw new S(`request unit '${e.unit}' does not match wallet unit '${r.unit}'`);
      let a = e.includesMint(r.mint.mintUrl);
      if (e.isMintListStrict && !a)
        throw new S("this wallet's mint is not in the request's strict mint list");
      let o = j.zero();
      if (e.supportedMethods?.length) {
        let { disabled: t, params: n } = r.getMintInfo().isSupported(5), i = t ? [] : n.filter((e) => e.unit === r.unit).map((e) => e.method);
        if (!e.supportedMethods.some((e) => i.includes(e.method)))
          throw new S(`mint cannot melt ${r.unit} via any method the request accepts`);
        o = a ? j.zero() : e.feesFor(r.mint.mintUrl, i);
      }
      let s = e.toP2PKOptions();
      if (e.nut10 && !s)
        throw new S(`cannot honour the request's nut10 lock kind '${e.nut10.kind}'`);
      s && ss(s);
      let c = new ls(r, i.add(o), t);
      return os.add(c), c.includeFees(true), s ? c.asLocked(s) : c;
    }
    receive(e) {
      return new us(this.wallet, e);
    }
    mintBolt11(e, t) {
      return new ds(this.wallet, "bolt11", e, t);
    }
    mintBolt12(e, t) {
      return new ds(this.wallet, "bolt12", e, t);
    }
    mintOnchain(e, t) {
      return new ds(this.wallet, "onchain", e, t);
    }
    meltBolt11(e, t) {
      return new fs(this.wallet, "bolt11", e, t);
    }
    meltBolt12(e, t) {
      return new fs(this.wallet, "bolt12", e, t);
    }
    meltOnchain(e, t) {
      return new ps(this.wallet, e, t);
    }
  };
  var ls = class {
    constructor(e, t, n) {
      this.wallet = e, this.proofs = n, this.config = {}, this.amount = j.from(t);
    }
    assertSendOutputMutable() {
      if (os.has(this) && this.sendOT)
        throw new S("the payment request mandates this send output; it cannot be replaced by chaining");
    }
    asRandom(e) {
      return this.assertSendOutputMutable(), this.sendOT = {
        type: "random",
        denominations: e
      }, this;
    }
    asDeterministic(e = 0, t) {
      return this.assertSendOutputMutable(), this.sendOT = {
        type: "deterministic",
        counter: e,
        denominations: t
      }, this;
    }
    asLocked(e, t) {
      this.assertSendOutputMutable();
      let n = e instanceof $ ? e.toOptions() : e;
      return this.sendOT = {
        type: "p2pk",
        options: n,
        denominations: t
      }, this;
    }
    asP2PK(e, t) {
      return this.asLocked(e, t);
    }
    asFactory(e, t) {
      return this.assertSendOutputMutable(), this.sendOT = {
        type: "factory",
        factory: e,
        denominations: t
      }, this;
    }
    asCustom(e) {
      return this.assertSendOutputMutable(), this.sendOT = {
        type: "custom",
        data: e
      }, this;
    }
    keepAsRandom(e) {
      return this.keepOT = {
        type: "random",
        denominations: e
      }, this;
    }
    keepAsDeterministic(e = 0, t) {
      return this.keepOT = {
        type: "deterministic",
        counter: e,
        denominations: t
      }, this;
    }
    keepAsLocked(e, t) {
      let n = e instanceof $ ? e.toOptions() : e;
      return this.keepOT = {
        type: "p2pk",
        options: n,
        denominations: t
      }, this;
    }
    keepAsP2PK(e, t) {
      return this.keepAsLocked(e, t);
    }
    keepAsFactory(e, t) {
      return this.keepOT = {
        type: "factory",
        factory: e,
        denominations: t
      }, this;
    }
    keepAsCustom(e) {
      return this.keepOT = {
        type: "custom",
        data: e
      }, this;
    }
    includeFees(e = true) {
      if (os.has(this) && !e)
        throw new S("a payment request is sent net of input fees; includeFees cannot be disabled");
      return this.config.includeFees = e, this;
    }
    keyset(e) {
      return this.config.keysetId = e, this;
    }
    privkey(e) {
      return this.config.privkey = e, this;
    }
    proofsWeHave(e) {
      return this.config.proofsWeHave = e, this;
    }
    onCountersReserved(e) {
      return this.config.onCountersReserved = e, this;
    }
    offlineExactOnly(e = false) {
      return this.offlineExact = { requireDleq: e }, this;
    }
    offlineCloseMatch(e = false) {
      return this.offlineClose = { requireDleq: e }, this;
    }
    async prepare() {
      if (this.offlineExact || this.offlineClose)
        throw new S("Offline selection has nothing to prepare; call run() instead, or drop the offline mode for an online swap.");
      let e = {
        send: this.sendOT ?? this.wallet.defaultOutputType(),
        ...this.keepOT ? { keep: this.keepOT } : {}
      };
      return this.wallet.prepareSwapToSend(this.amount, this.proofs, this.config, e);
    }
    async run() {
      if ((this.offlineExact || this.offlineClose) && (this.sendOT || this.keepOT))
        throw new S("Offline selection cannot be combined with custom output types. Remove send/keep output configuration, or use an online swap.");
      if (this.offlineExact)
        return this.config.privkey && (this.proofs = this.wallet.signP2PKProofs(this.proofs, this.config.privkey)), this.wallet.sendOffline(this.amount, this.proofs, {
          includeFees: this.config.includeFees,
          exactMatch: true,
          requireDleq: this.offlineExact.requireDleq
        });
      if (this.offlineClose)
        return this.config.privkey && (this.proofs = this.wallet.signP2PKProofs(this.proofs, this.config.privkey)), this.wallet.sendOffline(this.amount, this.proofs, {
          includeFees: this.config.includeFees,
          exactMatch: false,
          requireDleq: this.offlineClose.requireDleq
        });
      let e = {
        send: this.sendOT ?? this.wallet.defaultOutputType(),
        ...this.keepOT ? { keep: this.keepOT } : {}
      };
      return this.wallet.send(this.amount, this.proofs, this.config, e);
    }
  };
  var us = class {
    constructor(e, t) {
      this.wallet = e, this.token = t, this.config = {};
    }
    asRandom(e) {
      return this.outputType = {
        type: "random",
        denominations: e
      }, this;
    }
    asDeterministic(e = 0, t) {
      return this.outputType = {
        type: "deterministic",
        counter: e,
        denominations: t
      }, this;
    }
    asLocked(e, t) {
      let n = e instanceof $ ? e.toOptions() : e;
      return this.outputType = {
        type: "p2pk",
        options: n,
        denominations: t
      }, this;
    }
    asP2PK(e, t) {
      return this.asLocked(e, t);
    }
    asFactory(e, t) {
      return this.outputType = {
        type: "factory",
        factory: e,
        denominations: t
      }, this;
    }
    asCustom(e) {
      return this.outputType = {
        type: "custom",
        data: e
      }, this;
    }
    keyset(e) {
      return this.config.keysetId = e, this;
    }
    requireDleq(e = true) {
      return this.config.requireDleq = e, this;
    }
    privkey(e) {
      return this.config.privkey = e, this;
    }
    proofsWeHave(e) {
      return this.config.proofsWeHave = e, this;
    }
    onCountersReserved(e) {
      return this.config.onCountersReserved = e, this;
    }
    async prepare() {
      return this.wallet.prepareSwapToReceive(this.token, this.config, this.outputType);
    }
    async run() {
      return this.wallet.receive(this.token, this.config, this.outputType);
    }
  };
  var ds = class {
    constructor(e, t, n, r) {
      this.wallet = e, this.method = t, this.quote = r, this.config = {}, this.amount = j.from(n), this._hasPrivkey;
    }
    asRandom(e) {
      return this.outputType = {
        type: "random",
        denominations: e
      }, this;
    }
    asDeterministic(e = 0, t) {
      return this.outputType = {
        type: "deterministic",
        counter: e,
        denominations: t
      }, this;
    }
    asLocked(e, t) {
      let n = e instanceof $ ? e.toOptions() : e;
      return this.outputType = {
        type: "p2pk",
        options: n,
        denominations: t
      }, this;
    }
    asP2PK(e, t) {
      return this.asLocked(e, t);
    }
    asFactory(e, t) {
      return this.outputType = {
        type: "factory",
        factory: e,
        denominations: t
      }, this;
    }
    asCustom(e) {
      return this.outputType = {
        type: "custom",
        data: e
      }, this;
    }
    keyset(e) {
      return this.config.keysetId = e, this;
    }
    privkey(e) {
      return this.config.privkey = e, this;
    }
    proofsWeHave(e) {
      return this.config.proofsWeHave = e, this;
    }
    onCountersReserved(e) {
      return this.config.onCountersReserved = e, this;
    }
    async prepare() {
      if (this.method === "bolt11") {
        let e = this.quote, t = typeof e == "string" ? await this.wallet.checkMintQuoteBolt11(e) : e;
        if (this.wallet.validateMintQuote(t), t.pubkey && !this.config.privkey)
          throw new S("privkey is required for locked BOLT11 mint quotes");
        return this.wallet.prepareMint(this.method, this.amount, t, this.config, this.outputType);
      }
      if (this.method === "bolt12") {
        let e = this.quote;
        if (this.wallet.validateMintQuote(e), !this.config.privkey)
          throw new S("privkey is required for BOLT12 mint quotes");
        return this.wallet.prepareMint(this.method, this.amount, e, this.config, this.outputType);
      }
      let e = this.quote;
      if (this.wallet.validateMintQuote(e), !this.config.privkey)
        throw new S("privkey is required for onchain mint quotes");
      return this.wallet.prepareMint(this.method, this.amount, e, this.config, this.outputType);
    }
    async run() {
      let e = await this.prepare();
      return this.wallet.completeMint(e);
    }
  };
  var fs = class {
    constructor(e, t, n, r) {
      this.wallet = e, this.method = t, this.quote = n, this.proofs = r, this.config = {};
    }
    asRandom(e) {
      return this.outputType = {
        type: "random",
        denominations: e
      }, this;
    }
    asDeterministic(e = 0, t) {
      return this.outputType = {
        type: "deterministic",
        counter: e,
        denominations: t
      }, this;
    }
    asLocked(e, t) {
      let n = e instanceof $ ? e.toOptions() : e;
      return this.outputType = {
        type: "p2pk",
        options: n,
        denominations: t
      }, this;
    }
    asP2PK(e, t) {
      return this.asLocked(e, t);
    }
    asFactory(e, t) {
      return this.outputType = {
        type: "factory",
        factory: e,
        denominations: t
      }, this;
    }
    asCustom(e) {
      return this.outputType = {
        type: "custom",
        data: e
      }, this;
    }
    keyset(e) {
      return this.config.keysetId = e, this;
    }
    privkey(e) {
      return this.config.privkey = e, this;
    }
    onCountersReserved(e) {
      return this.config.onCountersReserved = e, this;
    }
    async prepare() {
      return await this.wallet.prepareMelt(this.method, this.quote, this.proofs, this.config, this.outputType);
    }
    async run() {
      let e = await this.wallet.prepareMelt(this.method, this.quote, this.proofs, this.config, this.outputType);
      return this.wallet.completeMelt(e, this.config.privkey);
    }
  };
  var ps = class {
    constructor(e, t, n) {
      this.wallet = e, this.quote = t, this.proofs = n, this.config = {};
    }
    keyset(e) {
      return this.config.keysetId = e, this;
    }
    privkey(e) {
      return this.config.privkey = e, this;
    }
    feeIndex(e) {
      return this.selectedFeeIndex = e, this;
    }
    async run() {
      if (this.selectedFeeIndex === undefined && this.quote.fee_options.length === 1 && (this.selectedFeeIndex = this.quote.fee_options[0].fee_index), this.selectedFeeIndex === undefined)
        throw new S("feeIndex is required when an onchain melt quote has multiple fee options");
      return this.wallet.meltProofsOnchain(this.quote, this.proofs, this.selectedFeeIndex, this.config);
    }
  };
  var ms = "__PENDING__";
  var hs = 20008;
  var gs = class e {
    constructor(e, t) {
      this._seed = undefined, this._unit = "sat", this._mintInfo = undefined, this._denominationTarget = 3, this._secretsPolicy = "auto", this._boundKeysetId = ms, this._pendingRepair = null, this._lastRepairAt = 0, this._explicitBind = false, this._requireSigDleq = false, this._strictCachedKeysets = false, this.ops = new cs(this), this.on = new as(this), this._logger = t?.logger ?? O, this._selectProofs = t?.selectProofs ?? Lo, this._outputDataCreator = t?.outputDataCreator ?? new Vo, this.mint = typeof e == "string" ? new Do(e, {
        authProvider: t?.authProvider,
        logger: this._logger
      }) : e, this._unit = t?.unit ?? this._unit, this._boundKeysetId = t?.keysetId ?? this._boundKeysetId, this._explicitBind = t?.keysetId !== undefined, t?.bip39seed && (this.failIf(!(t.bip39seed instanceof Uint8Array), "bip39seed must be a valid Uint8Array", { received: typeof t.bip39seed }), this.failIf(t.bip39seed.length < 16 || t.bip39seed.length > 64, "bip39seed must be 16 to 64 bytes", { length: t.bip39seed.length }), this._seed = t.bip39seed), this._secretsPolicy = t?.secretsPolicy ?? this._secretsPolicy, t?.counterSource ? this._counterSource = t.counterSource : this._counterSource = new Yo(t?.counterInit), this.counters = new Zo(this._counterSource), this._keyChain = new ko(this.mint, this._unit, this._logger), this._denominationTarget = t?.denominationTarget ?? this._denominationTarget, this._requireSigDleq = t?.requireSigDleq ?? this._requireSigDleq, this._strictCachedKeysets = t?.strictCachedKeysets ?? this._strictCachedKeysets;
    }
    fail(e, t) {
      return se(e, this._logger, t);
    }
    failIf(e, t, n) {
      return k(e, t, this._logger, n);
    }
    failIfNullish(e, t, n) {
      return ce(e, t, this._logger, n);
    }
    requireNut29(e, t, n) {
      let r = this._mintInfo?.isSupported(29);
      if (r === undefined)
        return;
      let i = r.params?.methods;
      return this.failIf(!r.supported || Array.isArray(i) && !i.includes(e), `${t}: mint does not advertise NUT-29 for ${e}; use ${n} per quote`), r.params;
    }
    requireSupport(e, t) {
      this.failIf(!this.getMintInfo().supportsMintMeltMethod(e, t, this._unit), `Mint does not support ${t} ${e} for unit '${this._unit}'`);
    }
    safeCallback(e, t, n) {
      A(e, t, this._logger, n);
    }
    parseAmount(e, t, n = false) {
      try {
        let r = j.from(e);
        return n || this.failIf(r.isZero(), `Amount must be positive: ${r.toString()}`, {
          op: t,
          amount: e
        }), r;
      } catch (n) {
        let r = n instanceof Error ? n.message : String(n);
        throw this._logger.error(r, {
          op: t,
          amount: e
        }), new S(r, { cause: n });
      }
    }
    async loadMint(e) {
      let t = [];
      (!this._mintInfo || e) && t.push(this.mint.getInfo().then((e) => (this._mintInfo = new Z(e, this._logger), this.mint.setMintInfo(this._mintInfo), null))), t.push(this._keyChain.init(e)), await Promise.all(t), this.finishInit();
    }
    loadMintFromCache(e, t) {
      this._mintInfo = new Z(e, this._logger), this.mint.setMintInfo(this._mintInfo), this._keyChain.loadFromCache(t), this.finishInit();
    }
    finishInit() {
      let { keysets: e, mintUrl: t, savedAt: n } = this._keyChain.cache;
      if (this._logger.debug("KeyChain loaded", {
        mintUrl: t,
        savedAt: n,
        keysets: e.map((e) => ({
          id: e.id,
          unit: e.unit,
          active: e.active,
          fee: e.input_fee_ppk,
          keys: e.keys ? Object.keys(e.keys).length : 0
        }))
      }), this._boundKeysetId === ms)
        try {
          this._boundKeysetId = this._keyChain.getCheapestKeyset().id;
        } catch (e) {
          this._logger.warn("No active keyset available, wallet remains unbound", {
            unit: this._unit,
            err: e.message
          });
        }
      else if (this._explicitBind) {
        let e = this._keyChain.getKeyset(this._boundKeysetId);
        this.failIf(e.unit !== this._unit, "Keyset unit does not match wallet unit", {
          keyset: e.id,
          unit: e.unit,
          walletUnit: this._unit
        }), W(e.id, this._logger);
      } else {
        let e = this._keyChain.hasKeyset(this._boundKeysetId) ? this._keyChain.getKeyset(this._boundKeysetId) : undefined;
        try {
          let e = this._keyChain.getCheapestKeyset().id;
          e !== this._boundKeysetId && (this._boundKeysetId = e, this._logger.info("Wallet rebound to cheapest active keyset after refresh", { keysetId: e }));
        } catch (t) {
          e || (this._boundKeysetId = ms), this._logger.warn("No active keyset available after refresh", {
            unit: this._unit,
            err: t.message
          });
        }
      }
      this.getMintInfo();
    }
    get keyChain() {
      return this._keyChain;
    }
    get unit() {
      return this._unit;
    }
    getMintInfo() {
      return this.failIfNullish(this._mintInfo, "Mint info not initialized; call loadMint or loadMintFromCache first"), this._mintInfo;
    }
    get maxArrayLength() {
      return this._mintInfo?.maxArrayLength ?? 500;
    }
    get keysetId() {
      if (this._boundKeysetId === ms && this._mintInfo)
        try {
          this._keyChain.getCheapestKeyset();
        } catch (e) {
          this.fail(`Wallet has no bound keyset: ${e.message}`);
        }
      return this.failIf(this._boundKeysetId === ms, "Wallet has no bound keyset. The mint may have no active keysets, or wallet was not initialized via loadMint or loadMintFromCache"), this._boundKeysetId;
    }
    getKeyset(e) {
      let t = this._keyChain.getKeyset(e ?? this.keysetId);
      return this.failIf(t.unit !== this._unit, "Keyset unit does not match wallet unit", {
        keyset: t.id,
        unit: t.unit,
        walletUnit: this._unit
      }), W(t.id, this._logger), this.failIf(!t.hasKeys, "Keyset has no keys loaded", { keyset: t.id }), t;
    }
    getOutputKeyset(e) {
      let t = this.getKeyset(e);
      return this.failIf(!t.hasHexId, "Legacy keyset cannot be used to create new proofs", { keyset: t.id }), this.failIf(!t.isActive, "Inactive keyset cannot be used to create new proofs", { keyset: t.id }), t;
    }
    async ensureOperableKeysets(e) {
      return this.failIf(!Array.isArray(e), "ensureOperableKeysets: ids must be an array"), this.failIf(!this._mintInfo, "Mint info not initialized; call loadMint or loadMintFromCache first"), this._ensureOperableKeysets(e, { implicit: false });
    }
    startRepair(e) {
      if (this._pendingRepair)
        return this._pendingRepair;
      if (e) {
        if (Date.now() - this._lastRepairAt < 60000)
          return null;
        this._lastRepairAt = Date.now();
      }
      return this._pendingRepair = this.loadMint(true).finally(() => {
        this._pendingRepair = null;
      }), this._pendingRepair;
    }
    async _ensureOperableKeysets(e, t) {
      if (!this._mintInfo)
        return;
      let n = [...new Set(e.filter((e) => !!e))];
      if (t.implicit && this._strictCachedKeysets) {
        let e = n.filter((e) => !this._keyChain.hasKeyset(e));
        if (e.length > 0)
          throw new te(e[0]);
        return;
      }
      let r = n.filter((e) => !this._keyChain.hasKeyset(e)), i = false;
      if (r.length > 0) {
        let e = this.startRepair(t.implicit);
        if (!e)
          throw new te(r[0]);
        try {
          await e;
        } catch (e) {
          throw new te(r[0], { cause: e });
        }
        i = true;
        let n = r.filter((e) => !this._keyChain.hasKeyset(e));
        if (n.length > 0)
          throw t.implicit && this.on._emitKeychainUpdated(), new te(n[0], { refreshed: true });
      }
      let a = t.fetchKeys === false ? [] : n.filter((e) => this._keyChain.isUnitKeyset(e) && !this._keyChain.getKeyset(e).hasKeys);
      if (a.length > 0) {
        let e = await Promise.allSettled(a.map((e) => this._keyChain.ensureKeysetKeys(e))), n = e.filter((e) => e.status === "rejected");
        if (n.length < e.length && (i = true), n.length > 0)
          throw i && t.implicit && this.on._emitKeychainUpdated(), n.length === 1 ? n[0].reason : new S(`Could not load keys for ${n.length} keysets`, { cause: n.map((e) => e.reason) });
      }
      i && t.implicit && this.on._emitKeychainUpdated();
    }
    async repairStaleSnapshot() {
      if (this._strictCachedKeysets)
        return false;
      let e = this.startRepair(true);
      if (!e)
        return false;
      try {
        await e;
      } catch (e) {
        return this._logger.warn("Snapshot refresh after a mint keyset rejection failed", { err: e.message }), false;
      }
      return this.on._emitKeychainUpdated(), true;
    }
    async withStaleKeysetRepair(e) {
      try {
        return await e();
      } catch (e) {
        throw !oe(e) || !Number.isFinite(e.code) || e.code < 12000 || e.code >= 13000 ? e : new re(await this.repairStaleSnapshot(), { cause: e });
      }
    }
    requireMintableKeyset(e) {
      try {
        this._keyChain.getCheapestKeyset();
      } catch (t) {
        this.fail(`${e}: no active keyset for unit '${this._unit}' — a paid mint quote could not be redeemed. ${t.message}`, { reason: t.message });
      }
    }
    get logger() {
      return this._logger;
    }
    async reserveFor(e, t) {
      return t <= 0 ? {
        start: 0,
        count: 0
      } : this._counterSource.reserve(e, t);
    }
    countersNeeded(e) {
      return e.type !== "deterministic" || e.counter !== 0 ? 0 : (e.denominations ?? []).length;
    }
    async addCountersToOutputTypes(e, ...t) {
      let n = t.filter((e) => e.type === "deterministic" && e.counter > 0 && (e.denominations?.length ?? 0) > 0);
      if (n.length > 1) {
        let t = n.map((e) => ({
          start: e.counter,
          end: e.counter + e.denominations.length
        })).sort((e, t) => e.start - t.start);
        for (let n = 1;n < t.length; n++)
          this.failIf(t[n].start < t[n - 1].end, "Manual counter ranges overlap", {
            keysetId: e,
            prev: t[n - 1],
            cur: t[n]
          });
      }
      if (n.length > 0) {
        let t = Math.min(...n.map((e) => e.counter)), r = Math.max(...n.map((e) => e.counter + e.denominations.length));
        if (this._counterSource.reserveAt)
          try {
            await this._counterSource.reserveAt(e, t, r - t);
          } catch {
            this._logger.warn("Manual deterministic counter range was already issued", {
              keysetId: e,
              minManualStart: t,
              maxManualEnd: r
            }), await this._counterSource.advanceToAtLeast(e, r);
          }
        else {
          let { start: n } = await this._counterSource.reserve(e, 0);
          n > t && this._logger.warn("Manual deterministic counter range was already issued", {
            keysetId: e,
            minManualStart: t,
            maxManualEnd: r
          }), await this._counterSource.advanceToAtLeast(e, r);
        }
        this._logger.debug("Counter source advanced to respect manual deterministic counters", {
          keysetId: e,
          maxManualEnd: r
        });
      }
      let r = t.reduce((e, t) => e + this.countersNeeded(t), 0);
      if (r === 0)
        return { outputTypes: t };
      let i = await this.reserveFor(e, r), a = i.start, o = t.map((e) => {
        if (e.type === "deterministic" && e.counter === 0) {
          let t = e.denominations?.length ?? 0;
          if (t > 0) {
            let n = {
              ...e,
              counter: a
            };
            return a += t, n;
          }
        }
        return e;
      }), s = {
        keysetId: e,
        start: i.start,
        count: i.count,
        next: i.start + i.count
      };
      return this.on._emitCountersReserved(s), {
        outputTypes: o,
        used: s
      };
    }
    bindKeyset(e) {
      let t = this._keyChain.getKeyset(e);
      this.failIf(t.unit !== this._unit, "Keyset unit does not match wallet unit", {
        keyset: t.id,
        unit: t.unit,
        walletUnit: this._unit
      }), W(t.id, this._logger), this.failIf(!t.hasKeys, "Keyset has no keys loaded", { keyset: t.id }), this._boundKeysetId = t.id, this._explicitBind = true, this._logger.debug("Wallet bound to keyset", {
        keysetId: t.id,
        unit: t.unit,
        feePPK: t.fee
      });
    }
    withKeyset(t, n) {
      let r = new e(this.mint, {
        keysetId: t,
        bip39seed: this._seed,
        secretsPolicy: this._secretsPolicy,
        outputDataCreator: this._outputDataCreator,
        requireSigDleq: this._requireSigDleq,
        logger: this._logger,
        counterSource: n?.counterSource ?? this._counterSource,
        strictCachedKeysets: this._strictCachedKeysets
      });
      return r.loadMintFromCache(this.getMintInfo().cache, this._keyChain.cache), r;
    }
    defaultOutputType() {
      return this._secretsPolicy === "random" ? { type: "random" } : this._secretsPolicy === "deterministic" ? (this.failIfNullish(this._seed, "Deterministic policy requires a seed"), {
        type: "deterministic",
        counter: 0
      }) : this._seed ? {
        type: "deterministic",
        counter: 0
      } : { type: "random" };
    }
    configureOutputs(e, t, n, r = false, i = []) {
      let a = this.parseAmount(e, "configureOutputs", true), o = i.map((e) => ({ amount: j.from(e.amount) }));
      if (n.type === "custom") {
        this.failIf(r, "The custom OutputType does not support automatic fee inclusion");
        let e = this.parseAmount(Q.sumOutputAmounts(n.data), "configureOutputs.customTotal", true);
        this.failIf(!e.equals(a), `Custom output data total (${e.toString()}) does not match amount (${a.toString()})`);
        for (let e of n.data)
          this.getOutputKeyset(e.blindedMessage.id);
        return n;
      }
      let s = n.denominations ?? [];
      if (s.length === 0 && o.length > 0 && (s = Go(o, a, t.keys, this._denominationTarget)), s = H(a, t.keys, s), r) {
        let e = this.receiveFeeAmounts(s.length, t);
        a = a.add(j.sum(e)), s = [...s, ...e];
      }
      return {
        ...n,
        denominations: s
      };
    }
    receiveFeeAmounts(e, t) {
      let n = this.getFeesForKeyset(e, t.id), r = H(n, t.keys), i = 0;
      for (;this.getFeesForKeyset(e + r.length, t.id).greaterThan(n); ) {
        if (i++ > 4096)
          throw new S(`Fee calculation for keyset ${t.id} did not converge (input_fee_ppk too high for its denominations)`);
        n = n.add(1), r = H(n, t.keys);
      }
      return r;
    }
    preparedTotal(e) {
      if (e.type === "custom")
        return Q.sumOutputAmounts(e.data);
      let t = e.denominations ?? [];
      return j.sum(t);
    }
    createOutputData(e, t, n) {
      let r = this.parseAmount(e, "createOutputData", true);
      if (n.type != "custom" && n.denominations && n.denominations.length > 0) {
        let e = j.sum(n.denominations);
        this.failIf(!e.equals(r), "Denominations do not sum to the expected amount", {
          splitSum: e.toString(),
          expected: r.toString()
        });
      }
      let i;
      switch (n.type) {
        case "random":
          i = this._outputDataCreator.createRandomData(r, t, n.denominations);
          break;
        case "deterministic":
          this.failIfNullish(this._seed, "Deterministic outputs require a seed configured in the wallet"), i = this._outputDataCreator.createDeterministicData(r, this._seed, n.counter, t, n.denominations);
          break;
        case "p2pk":
          {
            let e = this.getMintInfo();
            this.failIf(!e.isSupported(11).supported, "Mint does not support NUT-11: the lock would be spendable by anyone"), this.failIf(n.options.hashlock !== undefined && !e.isSupported(14).supported, "Mint does not support NUT-14: the hashlock would be spendable by anyone");
          }
          n.options.locktime !== undefined && n.options.locktime <= Math.floor(Date.now() / 1000) && this._logger.warn("Lock locktime is not in the future", { locktime: n.options.locktime }), i = this._outputDataCreator.createP2PKData(n.options, r, t, n.denominations);
          break;
        case "factory":
          i = H(r, t.keys, n.denominations).map((e) => n.factory(e, t));
          break;
        case "custom": {
          i = n.data;
          let e = this.parseAmount(Q.sumOutputAmounts(i), "createOutputData.customTotal", true);
          this.failIf(!e.equals(r), `Custom output data total (${e.toString()}) does not match amount (${r.toString()})`);
          break;
        }
        default:
          this.fail("Invalid OutputType");
      }
      return i;
    }
    createSwapTransaction(e, t, n = []) {
      e = this._prepareInputsForMint(e);
      let r = [...t, ...n], i = r.map((e, t) => t);
      Xn(e) || i.sort((e, t) => r[e].blindedMessage.amount.compareTo(r[t].blindedMessage.amount));
      let a = [...Array.from({ length: t.length }, () => true), ...Array.from({ length: n.length }, () => false)], o = i.map((e) => r[e]), s = i.map((e) => a[e]), c = o.map((e) => e.blindedMessage);
      return {
        payload: {
          inputs: e,
          outputs: c
        },
        outputData: o,
        keepVector: s,
        sortedIndices: i
      };
    }
    async receive(e, t, n) {
      let r = await this.prepareSwapToReceive(e, t, n), { keep: i } = await this.completeSwap(r, t?.privkey);
      return i;
    }
    async prepareSwapToReceive(e, t, n) {
      let { keysetId: r, requireDleq: i, proofsWeHave: a, onCountersReserved: o } = t || {};
      n = n ?? this.defaultOutputType();
      let s;
      if (Array.isArray(e))
        s = Y(e);
      else {
        let t = typeof e == "string" ? this.decodeToken(e) : e, n = la(t.mint);
        this.failIf(n !== this.mint.mintUrl, "Token belongs to a different mint", {
          token: n,
          wallet: this.mint.mintUrl
        }), this.failIf(t.unit !== this._unit, "Token is not in wallet unit", {
          token: t.unit,
          wallet: this._unit
        }), s = Y(t.proofs);
      }
      await this._ensureOperableKeysets(s.map((e) => e.id), { implicit: true }), this.assertProofsInWalletUnit(s);
      let c = this.parseAmount(J(s), "prepareSwapToReceive", true);
      this.failIf(c.isZero(), "Token contains no proofs", { proofs: s });
      for (let e of s) {
        let t = this._keyChain.getKeyset(e.id);
        i ? this.failIf(!ha(e, t), "Token contains proofs with invalid or missing DLEQ") : this.failIf(!ga(e, t), "Token contains a proof with an invalid DLEQ");
      }
      let l = this.getOutputKeyset(r), u = this.getFeesForProofs(s), d = c.subtract(u), f = this.configureOutputs(d, l, n, false, a), p = await this.addCountersToOutputTypes(l.id, f);
      [f] = p.outputTypes, p.used && this.safeCallback(o, p.used, { op: "receive" }), this._logger.debug("receive counter", {
        counter: p.used,
        receiveOT: Ko(f)
      });
      let m = this.createOutputData(this.preparedTotal(f), l, f);
      return {
        amount: d,
        fees: u,
        keysetId: l.id,
        inputs: s,
        keepOutputs: m
      };
    }
    sendOffline(e, t, n) {
      let r = this.parseAmount(e, "sendOffline"), i = Y(t), { requireDleq: a = false, includeFees: o = false, exactMatch: s = true } = n || {};
      a && (i = i.filter((e) => e.dleq != null)), this.failIf(J(i).lessThan(r), "Not enough funds available to send");
      let { keep: c, send: l } = this.selectProofsToSend(i, r, o, s);
      return {
        keep: c,
        send: this._prepareInputsForMint(l, a, true)
      };
    }
    async send(e, t, n, r) {
      let i = this.parseAmount(e, "send"), { keysetId: a, includeFees: o = false } = n || {};
      r = r ?? {
        send: this.defaultOutputType(),
        keep: this.defaultOutputType()
      };
      try {
        let e = this.defaultOutputType().type === "deterministic", n = (e) => !e || e.type === "random" && (!e.denominations || e.denominations.length === 0);
        if (a || e || !n(r.send) || r.keep && !n(r.keep)) {
          let t = [];
          throw a && t.push("keysetId override"), e && t.push("wallet default is deterministic"), n(r.send) || t.push("non-default send output type"), r.keep && !n(r.keep) && t.push("non-default keep output type"), new S(`Options require a swap: ${t.join(", ")}`);
        }
        let { keep: s, send: c } = this.sendOffline(i, t, {
          includeFees: o,
          exactMatch: true,
          requireDleq: false
        }), l = o ? this.getFeesForProofs(c) : j.zero();
        if (J(c).equals(i.add(l)))
          return this._logger.info("Successful exactMatch offline selection!"), {
            keep: s,
            send: c
          };
      } catch (e) {
        let t = e instanceof Error ? e.message : "Unknown error";
        this._logger.debug("ExactMatch offline selection failed.", { e: t });
      }
      let s = await this.prepareSwapToSend(i, t, n, r);
      return await this.completeSwap(s, n?.privkey);
    }
    async prepareSwapToSend(e, t, n, r) {
      let i = this.parseAmount(e, "prepareSwapToSend"), a = Y(t), { keysetId: o, includeFees: s = false, onCountersReserved: c } = n || {};
      await this._ensureOperableKeysets(a.map((e) => e.id), {
        implicit: true,
        fetchKeys: false
      }), r = r ?? {
        send: this.defaultOutputType(),
        keep: this.defaultOutputType()
      };
      let l = this.getOutputKeyset(o), u = this.configureOutputs(i, l, r.send ?? this.defaultOutputType(), s), d = this.preparedTotal(u), { keep: f, send: p } = this.selectProofsToSend(a, d, true);
      if (p.length === 0) {
        let e = J(a).toString(), t = this.getFeesForProofs(a).toString();
        this.fail(`Not enough funds available to send: ${e} available, ${d.toString()} required plus up to ${t} input fee`);
      }
      let m = J(p), h = this.getFeesForProofs(p), g = d.add(h);
      m.lessThan(g) && this.failIf(true, "Not enough funds available for swap", {
        selectedSum: m.toString(),
        required: g.toString()
      });
      let _ = m.subtract(g), v = this.configureOutputs(_, l, r.keep ?? this.defaultOutputType(), false, n?.proofsWeHave), y = this.preparedTotal(v), b = await this.addCountersToOutputTypes(l.id, u, v);
      [u, v] = b.outputTypes, b.used && this.safeCallback(c, b.used, { op: "send" }), this._logger.debug("send counters", {
        counter: b.used,
        sendOT: Ko(u),
        keepOT: Ko(v)
      });
      let x = this.createOutputData(d, l, u), S = this.createOutputData(y, l, v);
      return {
        amount: i,
        fees: h,
        keysetId: l.id,
        inputs: p,
        sendOutputs: x,
        keepOutputs: S,
        unselectedProofs: f
      };
    }
    async completeSwap(e, t) {
      let n = e?.keepOutputs ? e.keepOutputs : [], r = e.sendOutputs ? e.sendOutputs : [], i = e.unselectedProofs ? e.unselectedProofs : [];
      t && (e.inputs = this.signP2PKProofs(e.inputs, t, [...n, ...r]));
      let a = this.createSwapTransaction(e.inputs, n, r), { signatures: o } = await this.withStaleKeysetRepair(() => this.mint.swap(a.payload));
      this.failIf(o.length !== a.outputData.length, `Mint returned ${o.length} signatures, expected ${a.outputData.length}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.validateReturnedSignatures(o, a.outputData), await this._ensureKeysetsForSignatures(o);
      let s = a.outputData.map((e, t) => e.toProof(o[t], this.keysetForSignature(o[t].id))), c = Array(s.length), l = Array(a.keepVector.length);
      a.sortedIndices.forEach((e, t) => {
        l[e] = a.keepVector[t], c[e] = s[t];
      });
      let u = [], d = [];
      return c.forEach((e, t) => {
        l[t] ? u.push(e) : d.push(e);
      }), this._logger.debug("SEND COMPLETED", {
        unselectedProofs: i.map((e) => e.amount.toString()),
        keepProofs: u.map((e) => e.amount.toString()),
        sendProofs: d.map((e) => e.amount.toString())
      }), {
        keep: [...u, ...i],
        send: d
      };
    }
    selectProofsToSend(e, t, n = false, r = false) {
      let i = this.parseAmount(t, "selectProofsToSend"), { keep: a, send: o } = this._selectProofs(e, i, this._keyChain, n, r);
      return {
        keep: a,
        send: o
      };
    }
    signP2PKProofs(e, t, n, r) {
      let i = Y(e);
      if (!Xn(i))
        return Vn(i, t, this._logger);
      this.failIfNullish(n, "OutputData is required for SIG_ALL proof signing."), Jn(i);
      let [a, ...o] = i, s = a, c = [Yn(i, n, r)];
      for (let e of c)
        s = Vn([s], t, this._logger, e)[0];
      return [s, ...o];
    }
    getFeesForProofs(e) {
      let t = j.sum(e.map((e) => this.getProofFeePPK(e))).toBigInt();
      return j.from((t + 999n) / 1000n);
    }
    isPaymentRequestSatisfied(e, t, n, r) {
      let i = e.amount ?? (n === undefined ? undefined : j.from(n));
      if (!i)
        throw new S("amountless payment request: pass the expected amount to check against");
      if (e.unit && e.unit !== this._unit)
        throw new S(`request unit '${e.unit}' does not match wallet unit '${this._unit}'`);
      if (this.assertProofsInWalletUnit(t), this.assertNoDuplicateProofs(t), e.nut10) {
        let n = e.toP2PKOptions();
        this.failIfNullish(n, `cannot check the request's nut10 lock kind '${e.nut10.kind}'`);
        for (let e of t)
          this.assertNut10Lock(n, e.secret);
      } else {
        let e = r?.privkeys === undefined ? [] : [r.privkeys].flat();
        for (let n of t)
          this.failIf(!this.canPayeeSpend(n, e), "unlocked request: the payee cannot spend a proof");
      }
      let a = e.includesMint(this.mint.mintUrl);
      this.failIf(e.isMintListStrict === true && !a, "this wallet's mint is not in the request's strict mint list");
      let o = j.zero();
      if (e.supportedMethods?.length) {
        let { disabled: t, params: n } = this.getMintInfo().isSupported(5), r = t ? [] : n.filter((e) => e.unit === this._unit).map((e) => e.method);
        this.failIf(!e.supportedMethods.some((e) => r.includes(e.method)), `mint cannot melt ${this._unit} via any method the request accepts`), o = a ? j.zero() : e.feesFor(this.mint.mintUrl, r);
      }
      let s = i.add(o).add(this.getFeesForProofs(t));
      return J(t).compareTo(s) >= 0;
    }
    assertNut10Lock(e, t) {
      let n;
      try {
        let [e, r] = F(t);
        n = Fi({
          kind: e,
          data: r.data,
          tags: r.tags
        });
      } catch {
        n = undefined;
      }
      this.failIfNullish(n, "nut10 request: proof does not carry a NUT-10 lock of the requested kind"), this.failIf(JSON.stringify(Fn2(n)) !== JSON.stringify(Fn2(e)), "nut10 request: proof lock is not the requested spending condition");
    }
    canPayeeSpend(e, t) {
      try {
        F(e.secret);
      } catch (t) {
        if (typeof e.secret != "string" || e.secret.trimStart().startsWith("["))
          throw t;
        return true;
      }
      return Ln(e, t);
    }
    assertNoDuplicateProofs(e) {
      let t = /* @__PURE__ */ new Set;
      for (let [n, r] of e.entries())
        this.failIf(t.has(r.secret), `Duplicate proof at index ${n}: each proof may appear only once`, { index: n }), t.add(r.secret);
    }
    assertProofsInWalletUnit(e) {
      let t = e.find((e) => !this._keyChain.isUnitKeyset(e.id));
      this.failIf(!!t, `Proof has unrecognised keyset. '${t?.id}' is not a ${this._unit} keyset from this mint`, { id: t?.id });
    }
    getProofFeePPK(e) {
      try {
        return this._keyChain.getKeyset(e.id).fee;
      } catch (t) {
        let n = `Could not get fee. No keyset found for keyset id: ${e.id}`;
        throw this._logger.error(n, {
          e: t,
          keychain: this._keyChain.getKeysets()
        }), new S(n, { cause: t });
      }
    }
    getFeesForKeyset(e, t) {
      let n;
      try {
        n = this._keyChain.getKeyset(t).fee;
      } catch (e) {
        let n = `No keyset found with ID ${t}`;
        throw this._logger.error(n, { e }), new S(n, { cause: e });
      }
      return j.from(e).ceilPercent(n, 1000);
    }
    getFeesToInclude(e, t) {
      let n = this.getKeyset(t?.keysetId), r = this.parseAmount(e, "getFeesToInclude", true), i = t?.nOutputs ?? H(r, n.keys).length;
      return j.sum(this.receiveFeeAmounts(i, n));
    }
    maxSpendableAfterFees(e, t = 0) {
      let n = J(e), r = this.getFeesForProofs(e).add(t);
      return r.greaterThanOrEqual(n) ? j.zero() : n.subtract(r);
    }
    _prepareInputsForMint(e, t = false, n = false) {
      return e.map((e) => {
        let r = this._normalizeWitness(e), { dleq: i, p2pk_e: a, ...o } = e, s = {
          ...o,
          witness: r
        };
        return n && a && (s = {
          ...s,
          p2pk_e: a
        }), t && i && (s = {
          ...s,
          dleq: i
        }), s;
      });
    }
    _normalizeWitness(e) {
      if (e.witness) {
        try {
          F(e.secret);
        } catch {
          return;
        }
        return typeof e.witness == "string" ? e.witness : JSON.stringify(e.witness);
      }
    }
    decodeToken(e) {
      return $i(e, this._keyChain.getAllKeysetIds());
    }
    async batchRestore(e = 300, t, n = 0, r) {
      let i = t ?? this.maxArrayLength, a = Math.ceil(e / i), o = r ?? this.keysetId, s = [], c, l = 0;
      for (;l < a; ) {
        let e = await this.restore(n, i, { keysetId: o });
        e.proofs.length > 0 || e.lastCounterWithSignature !== undefined ? (l = 0, s.push(...e.proofs), c = e.lastCounterWithSignature) : l++, n += i;
      }
      return {
        proofs: s,
        lastCounterWithSignature: c
      };
    }
    async restore(e, t, n) {
      this.failIfNullish(this._seed, "Cashu Wallet must be initialized with a seed to use restore");
      let { keysetId: r } = n || {}, i = r ?? this.keysetId;
      this._strictCachedKeysets || await this._keyChain.ensureKeysetKeys(i);
      let a = this.getKeyset(i), o = Array(t).fill(0), s = this._outputDataCreator.createDeterministicData(0, this._seed, e, a, o), { outputs: c, signatures: l } = await this.mint.restore({ outputs: s.map((e) => e.blindedMessage) });
      await this._ensureKeysetsForSignatures(l);
      let u = {};
      c.forEach((e, t) => u[e.B_] = l[t]);
      let d = [], f;
      for (let t = 0;t < s.length; t++) {
        let n = u[s[t].blindedMessage.B_];
        n && (f = e + t, !n.amount.isZero() && d.push(s[t].toProof(n, this.keysetForSignature(n.id))));
      }
      return {
        proofs: d,
        lastCounterWithSignature: f
      };
    }
    async createMintQuote(e, t, n) {
      try {
        this._keyChain.getCheapestKeyset();
      } catch (e) {
        this._logger.warn(`createMintQuote: no active keyset for unit '${this._unit}' — a paid mint quote could not be redeemed. This will become an error in cashu-ts v5.`, { reason: e.message });
      }
      let r = {
        ...t,
        unit: this._unit
      }, i = await this.mint.createMintQuote(e, r, { normalize: n?.normalize });
      return this.warnQuoteUnit(i, `createMintQuote: ${e}`), {
        ...i,
        unit: i.unit || this._unit
      };
    }
    warnQuoteUnit(e, t) {
      typeof e.unit != "string" || e.unit === "" || e.unit === this._unit || this._logger.warn(`${t}: the mint quoted unit '${e.unit}' but this wallet uses '${this._unit}'. This will become an error in cashu-ts v5.`, {
        quoted: e.unit,
        wallet: this._unit
      });
    }
    warnQuoteAmount(e, t, n) {
      t !== n && this._logger.warn(`${e}: the mint quoted ${n ?? "no amount"} but ${t ?? "no amount"} was requested. This will become an error in cashu-ts v5.`, {
        expected: t,
        quoted: n
      });
    }
    assertBolt11MintQuoteAmount(e, t) {
      if (this.failIf(!e.amount.equals(t), "Mint quote amount does not match", {
        expected: t.toString(),
        quoted: e.amount.toString()
      }), this._unit !== "sat" && this._unit !== "msat")
        return;
      let n = null;
      try {
        n = Ca(e.request);
      } catch {}
      let r = this._unit === "sat" ? t.multiplyBy(1000) : t, i = n !== null && r.equals(n);
      this.failIf(!i, "Mint quote invoice amount does not match the quote", {
        expected: t.toString(),
        invoiceMsat: n
      });
    }
    async createMintQuoteBolt11(e, t) {
      this.requireSupport("mint", "bolt11"), this.requireMintableKeyset("createMintQuoteBolt11");
      let n = this.parseAmount(e, "createMintQuoteBolt11");
      t && (this.getMintInfo().supportsNut04Description("bolt11", this._unit) || this.fail("Mint does not support description for bolt11"));
      let r = {
        unit: this._unit,
        amount: n,
        description: t
      }, i = await this.mint.createMintQuoteBolt11(r);
      return this.warnQuoteUnit(i, "createMintQuoteBolt11"), this.assertBolt11MintQuoteAmount(i, n), {
        ...i,
        unit: i.unit || this._unit
      };
    }
    async createLockedMintQuote(e, t, n) {
      this.requireSupport("mint", "bolt11"), this.requireMintableKeyset("createLockedMintQuote"), this.failIf(typeof t != "string" || t.length === 0, "A pubkey is required to lock the mint quote");
      let r = this.parseAmount(e, "createLockedMintQuote"), { supported: i } = this.getMintInfo().isSupported(20);
      this.failIf(!i, "Mint does not support NUT-20");
      let a = {
        unit: this._unit,
        amount: r,
        description: n,
        pubkey: t
      }, o = await this.mint.createMintQuoteBolt11(a);
      this.warnQuoteUnit(o, "createLockedMintQuote"), this.assertBolt11MintQuoteAmount(o, r), this.failIf(typeof o.pubkey != "string", "Mint returned unlocked mint quote");
      let s = o.pubkey;
      return this.failIf(s.toLowerCase() !== t.toLowerCase(), "Mint quote is not locked to the requested pubkey"), {
        ...o,
        pubkey: s,
        unit: o.unit || this._unit
      };
    }
    async createMintQuoteBolt12(e, t) {
      this.requireSupport("mint", "bolt12"), this.requireMintableKeyset("createMintQuoteBolt12"), this.failIf(typeof e != "string" || e.length === 0, "A pubkey is required to lock the mint quote");
      let n = this.getMintInfo();
      t?.description && !n.supportsNut04Description("bolt12", this._unit) && this.fail("Mint does not support description for bolt12");
      let r = t?.amount === undefined ? undefined : this.parseAmount(t.amount, "createMintQuoteBolt12"), i = {
        pubkey: e,
        unit: this._unit,
        amount: r,
        description: t?.description
      }, a = await this.mint.createMintQuoteBolt12(i);
      return this.warnQuoteUnit(a, "createMintQuoteBolt12"), this.warnQuoteAmount("createMintQuoteBolt12", r?.toString() ?? null, a.amount?.toString() ?? null), this.failIf(typeof a.pubkey != "string" || a.pubkey.toLowerCase() !== e.toLowerCase(), "Mint quote is not locked to the requested pubkey"), a;
    }
    async createMintQuoteOnchain(e) {
      this.requireSupport("mint", "onchain"), this.requireMintableKeyset("createMintQuoteOnchain"), this.failIf(typeof e != "string" || e.length === 0, "A pubkey is required to lock the mint quote");
      let t = await this.mint.createMintQuoteOnchain({
        unit: this._unit,
        pubkey: e
      });
      return this.warnQuoteUnit(t, "createMintQuoteOnchain"), this.failIf(typeof t.pubkey != "string" || t.pubkey.toLowerCase() !== e.toLowerCase(), "Mint quote is not locked to the requested pubkey"), {
        ...t,
        unit: t.unit || this._unit
      };
    }
    async checkMintQuote(e, t, n) {
      let r = typeof t == "string" ? t : t.quote;
      return this.mint.checkMintQuote(e, r, { normalize: n?.normalize });
    }
    async checkMintQuoteBolt11(e) {
      let t = typeof e == "string" ? e : e.quote, n = await this.mint.checkMintQuoteBolt11(t);
      return this.assertBolt11MintQuoteAmount(n, n.amount), n;
    }
    async checkMintQuoteBolt12(e) {
      return this.mint.checkMintQuoteBolt12(e);
    }
    async checkMintQuoteOnchain(e) {
      return this.mint.checkMintQuoteOnchain(e);
    }
    async checkMintQuoteBatch(e, t, n) {
      this.requireNut29(e, "checkMintQuoteBatch", "checkMintQuote");
      let r = t.map((e) => typeof e == "string" ? e : e.quote);
      return this.mint.checkMintQuoteBatch(e, r, { normalize: n?.normalize });
    }
    async checkMintQuoteBatchBolt11(e) {
      this.requireNut29("bolt11", "checkMintQuoteBatchBolt11", "checkMintQuoteBolt11");
      let t = e.map((e) => typeof e == "string" ? e : e.quote), n = await this.mint.checkMintQuoteBatchBolt11(t);
      for (let e of n)
        this.assertBolt11MintQuoteAmount(e, e.amount);
      return n;
    }
    async checkMintQuoteBatchBolt12(e) {
      this.requireNut29("bolt12", "checkMintQuoteBatchBolt12", "checkMintQuoteBolt12");
      let t = e.map((e) => typeof e == "string" ? e : e.quote);
      return this.mint.checkMintQuoteBatchBolt12(t);
    }
    validateReturnedSignatures(e, t) {
      let n = this._requireSigDleq && (this._mintInfo?.isSupported(12).supported ?? false);
      for (let r = 0;r < e.length; r++) {
        this.failIf(e[r] == null, `Mint response is missing a signature at index ${r}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`);
        let i = t[r].blindedMessage.amount.isZero();
        i && e[r].amount.isZero() || (this.failIf(!i && e[r].id !== t[r].blindedMessage.id, `Mint signature keyset id at index ${r} does not match output: expected ${t[r].blindedMessage.id}, got ${e[r].id}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.failIf(!i && !e[r].amount.equals(t[r].blindedMessage.amount), `Mint returned signature with wrong amount at index ${r}: expected ${t[r].blindedMessage.amount.toString()}, got ${e[r].amount.toString()}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.failIf(n && !e[r].dleq, `Mint supports NUT-12, but returned a signature without DLEQ proof at index ${r}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`));
      }
    }
    validateMintQuoteAvailableAmount(e, t, n) {
      if (e !== "bolt12" && e !== "onchain" || !("amount_paid" in t) || !("amount_issued" in t))
        return;
      let r = j.from(t.amount_paid), i = j.from(t.amount_issued), a = r.subtract(i);
      this.failIf(n.greaterThan(a), `Mint quote has only ${a.toString()} available to mint; requested ${n.toString()}`, {
        method: e,
        amount_paid: r.toString(),
        amount_issued: i.toString(),
        requestedAmount: n.toString()
      });
    }
    validateMintQuote(e) {
      this.failIf("unit" in e && typeof e.unit == "string" && e.unit !== this.unit, `Quote unit '${e.unit}' does not match wallet unit '${this.unit}'`);
    }
    validateMeltQuote(e) {
      this.failIf("unit" in e && typeof e.unit == "string" && e.unit !== this.unit, `Quote unit '${e.unit}' does not match wallet unit '${this.unit}'`);
    }
    async mintProofs(e, t, n, r, i) {
      let a = await this.prepareMint(e, t, n, r, i);
      return this.completeMint(a);
    }
    async mintProofsBolt11(e, t, n, r) {
      if (this.requireSupport("mint", "bolt11"), typeof t == "string") {
        let i = { quote: t }, a = await this.prepareMint("bolt11", e, i, n, r);
        return this.completeMint(a);
      }
      this.validateMintQuote(t);
      let i = await this.prepareMint("bolt11", e, t, n, r);
      return this.completeMint(i);
    }
    async mintProofsBolt12(e, t, n, r, i) {
      this.requireSupport("mint", "bolt12");
      let a = await this.prepareMint("bolt12", e, t, {
        ...r,
        privkey: n
      }, i);
      return this.completeMint(a);
    }
    async mintProofsOnchain(e, t, n, r, i) {
      this.requireSupport("mint", "onchain");
      let a = await this.prepareMint("onchain", e, t, {
        ...r,
        privkey: n
      }, i);
      return this.completeMint(a);
    }
    async prepareMint(e, t, n, r, i) {
      this.failIf(typeof n == "string", "prepareMint: expected a quote object, not a string ID. Use mintBolt11() which accepts string quote IDs."), this.validateMintQuote(n);
      let a = this.parseAmount(t, `prepareMint: ${e}`);
      this.validateMintQuoteAvailableAmount(e, n, a), i = i ?? this.defaultOutputType();
      let { privkey: o, keysetId: s, proofsWeHave: c, onCountersReserved: l } = r ?? {}, u = this.getOutputKeyset(s), d = this.configureOutputs(a, u, i, false, c), f = this.preparedTotal(d), p = await this.addCountersToOutputTypes(u.id, d);
      [d] = p.outputTypes, p.used && this.safeCallback(l, p.used, { op: "mintProofs" }), this._logger.debug("mint counter", {
        counter: p.used,
        mintOT: Ko(d)
      });
      let m = this.createOutputData(f, u, d), h = m.map((e) => e.blindedMessage), g = {
        outputs: h,
        quote: n.quote
      };
      "pubkey" in n && n.pubkey && this.failIf(!o, "Can not sign locked quote without private key");
      let _;
      if (o) {
        let e = "pubkey" in n ? n.pubkey : undefined;
        this.failIf(!e && Array.isArray(o), "prepareMint: multiple privkeys supplied for a quote without pubkey");
        let t = e ? an(e, o) : Array.isArray(o) ? o[0] : o;
        this.failIf(!t, "prepareMint: privkey is empty or correct privkey not provided"), g.signature = zr(t, n.quote, h), _ = Lr(t, n.quote, h);
      }
      return {
        method: e,
        payload: g,
        outputData: m,
        keysetId: u.id,
        quote: n,
        legacySignature: _
      };
    }
    async withLegacyQuoteSigFallback(e, t, n) {
      try {
        return await t();
      } catch (t) {
        if (e && oe(t) && t.code === hs)
          return this._logger.warn("Mint rejected the amended NUT-20 quote signature (20008); retrying with the legacy message."), n();
        throw t;
      }
    }
    async completeMint(e) {
      let { payload: t, outputData: n, method: r, legacySignature: i } = e, a = {
        ...t,
        outputs: n.map((e) => e.blindedMessage)
      }, { signatures: o } = await this.withStaleKeysetRepair(() => this.withLegacyQuoteSigFallback(i !== undefined, () => this.mint.mint(r, a), () => this.mint.mint(r, {
        ...a,
        signature: i
      })));
      return this.failIf(o.length !== n.length, `Mint returned ${o.length} signatures, expected ${n.length}. The mint quote may already be marked issued; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.validateReturnedSignatures(o, n), await this._ensureKeysetsForSignatures(o), this._logger.debug("MINT COMPLETED", { amounts: n.map((e) => e.blindedMessage.amount.toString()) }), n.map((e, t) => e.toProof(o[t], this.keysetForSignature(o[t].id)));
    }
    async prepareBatchMint(e, t, n, r) {
      this.failIf(t.length === 0, "prepareBatchMint: no entries provided");
      let i = this.requireNut29(e, "prepareBatchMint", "prepareMint"), a = i?.max_batch_size ?? 100;
      if (t.length > a) {
        let e = i?.max_batch_size == null ? "cashu-ts internal cap" : "mint's advertised limit";
        this.failIf(true, `prepareBatchMint: batch size ${t.length} exceeds ${e} of ${a}`);
      }
      let { privkey: o, keysetId: s, proofsWeHave: c, onCountersReserved: l } = n ?? {};
      for (let e of t)
        this.failIf(typeof e.quote == "string", "prepareBatchMint: expected a quote object, not a string ID"), this.validateMintQuote(e.quote);
      t.some((e) => ("pubkey" in e.quote) && e.quote.pubkey) && this.failIf(!o, "Can not sign locked quotes without private key");
      let u = this.getOutputKeyset(s), d = t.map((t) => this.parseAmount(t.amount, `prepareBatchMint: ${e}`)), f = j.sum(d);
      r = r ?? this.defaultOutputType();
      let p = this.configureOutputs(f, u, r, false, c), m = await this.addCountersToOutputTypes(u.id, p);
      [p] = m.outputTypes, m.used && this.safeCallback(l, m.used, { op: "mintProofs" });
      let h = this.createOutputData(f, u, p), g = h.map((e) => e.blindedMessage), _ = [], v = [], y = false;
      for (let [e, n] of t.entries()) {
        let t = "pubkey" in n.quote ? n.quote.pubkey : undefined;
        if (t && o) {
          let e = an(t, o);
          _.push(zr(e, n.quote.quote, g)), v.push(Lr(e, n.quote.quote, g)), y = true;
        } else
          o && !t && this._logger.warn(`prepareBatchMint: privkey supplied but quote #${e + 1} has no pubkey; treating as unlocked`), _.push(null), v.push(null);
      }
      return {
        method: e,
        payload: {
          quotes: t.map((e) => e.quote.quote),
          quote_amounts: d,
          outputs: g,
          ...y ? { signatures: _ } : {}
        },
        outputData: h,
        keysetId: u.id,
        quotes: t.map((e) => e.quote),
        ...y ? { legacySignatures: v } : {}
      };
    }
    async completeBatchMint(e) {
      let { method: t, payload: n, outputData: r, legacySignatures: i } = e, a = {
        ...n,
        outputs: r.map((e) => e.blindedMessage)
      }, { signatures: o } = await this.withStaleKeysetRepair(() => this.withLegacyQuoteSigFallback(i !== undefined, () => this.mint.mintBatch(t, a), () => this.mint.mintBatch(t, {
        ...a,
        signatures: i
      })));
      return this.failIf(o.length !== r.length, `Mint returned ${o.length} signatures, expected ${r.length}. The mint quote may already be marked issued; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.validateReturnedSignatures(o, r), await this._ensureKeysetsForSignatures(o), this._logger.debug("BATCH MINT COMPLETED", {
        quotes: n.quotes.length,
        amounts: r.map((e) => e.blindedMessage.amount.toString())
      }), r.map((e, t) => e.toProof(o[t], this.keysetForSignature(o[t].id)));
    }
    async createMeltQuote(e, t, n) {
      let r = {
        ...t,
        unit: this._unit
      }, i = await this.mint.createMeltQuote(e, r, { normalize: n?.normalize });
      return this.warnQuoteUnit(i, `createMeltQuote: ${e}`), {
        ...i,
        unit: i.unit || this._unit
      };
    }
    assertBolt11MeltQuoteAmount(e, t) {
      this.meltQuoteExceeds(e, t) && this.fail("Melt quote amount exceeds the invoice amount", {
        quoted: e.amount.toString(),
        invoiceMsat: j.from(t).toString()
      });
    }
    meltQuoteExceeds(e, t) {
      if (this._unit !== "sat" && this._unit !== "msat" || t === null)
        return false;
      let n = j.from(t), r = this._unit === "sat" ? n.ceilPercent(1, 1000) : n;
      return e.amount.greaterThan(r);
    }
    async createMeltQuoteBolt11(e, t) {
      this.requireSupport("melt", "bolt11");
      let n = t === undefined ? undefined : this.parseAmount(t, "createMeltQuoteBolt11");
      t !== undefined && this.failIf(ba(e), "amountMsat supplied but invoice already contains an amount. Leave amountMsat undefined for non-zero invoices.");
      let r = this._mintInfo?.supportsAmountless?.("bolt11", this._unit) ?? false, i = {
        unit: this._unit,
        request: e,
        ...r && n !== undefined ? { options: { amountless: { amount_msat: n } } } : {}
      }, a = await this.mint.createMeltQuoteBolt11(i), o = null;
      try {
        o = Ca(e);
      } catch {}
      return o === null && n !== undefined && (o = n), this.warnQuoteUnit(a, "createMeltQuoteBolt11"), this.assertBolt11MeltQuoteAmount(a, o), {
        ...a,
        unit: a.unit || this._unit,
        request: a.request || e
      };
    }
    async createMeltQuoteBolt12(e, t) {
      this.requireSupport("melt", "bolt12");
      let n = t === undefined ? undefined : this.parseAmount(t, "createMeltQuoteBolt12"), r = await this.mint.createMeltQuoteBolt12({
        unit: this._unit,
        request: e,
        options: n ? { amountless: { amount_msat: n } } : undefined
      });
      return this.warnQuoteUnit(r, "createMeltQuoteBolt12"), this.meltQuoteExceeds(r, n ?? null) && this.warnQuoteAmount("createMeltQuoteBolt12", `at most ${n.toString()} msat`, r.amount.toString()), r;
    }
    async createMeltQuoteOnchain(e, t) {
      this.requireSupport("melt", "onchain");
      let n = this.parseAmount(t, "createMeltQuoteOnchain"), r = await this.mint.createMeltQuoteOnchain({
        unit: this._unit,
        request: e,
        amount: n
      });
      return this.warnQuoteUnit(r, "createMeltQuoteOnchain"), this.warnQuoteAmount("createMeltQuoteOnchain", n.toString(), r.amount.toString()), {
        ...r,
        unit: r.unit || this._unit
      };
    }
    async createMultiPathMeltQuote(e, t) {
      let n = this.parseAmount(t, "createMultiPathMeltQuote"), { supported: r, params: i } = this.getMintInfo().isSupported(15);
      this.failIf(!r, "Mint does not support NUT-15"), this.failIf(!i?.some((e) => e.method === "bolt11" && e.unit === this._unit), `Mint does not support MPP for bolt11 and ${this._unit}`);
      let a = {
        unit: this._unit,
        request: e,
        options: { mpp: { amount: n } }
      }, o = await this.mint.createMeltQuoteBolt11(a);
      return this.warnQuoteUnit(o, "createMultiPathMeltQuote"), this.assertBolt11MeltQuoteAmount(o, n), {
        ...o,
        request: e,
        unit: this._unit
      };
    }
    async checkMeltQuote(e, t, n) {
      let r = typeof t == "string" ? t : t.quote;
      return this.mint.checkMeltQuote(e, r, { normalize: n?.normalize });
    }
    async checkMeltQuoteBolt11(e) {
      let t = typeof e == "string" ? e : e.quote, n = await this.mint.checkMeltQuoteBolt11(t);
      if (this._unit === "sat" || this._unit === "msat") {
        let e = null;
        try {
          e = Ca(n.request);
        } catch {
          this.fail("Melt quote request is not a valid bolt11 invoice", { quote: n.quote });
        }
        this.assertBolt11MeltQuoteAmount(n, e);
      }
      return n;
    }
    async checkMeltQuoteBolt12(e) {
      return this.mint.checkMeltQuoteBolt12(e);
    }
    async checkMeltQuoteOnchain(e) {
      return this.mint.checkMeltQuoteOnchain(e);
    }
    async meltProofs(e, t, n, r, i) {
      let a = await this.prepareMelt(e, t, n, r, i);
      return this.completeMelt(a, r?.privkey);
    }
    async meltProofsBolt11(e, t, n, r) {
      this.requireSupport("melt", "bolt11");
      let i = await this.prepareMelt("bolt11", e, t, n, r);
      return this.completeMelt(i, n?.privkey);
    }
    async meltProofsBolt12(e, t, n, r) {
      this.requireSupport("melt", "bolt12");
      let i = await this.prepareMelt("bolt12", e, t, n, r);
      return this.completeMelt(i, n?.privkey);
    }
    async meltProofsOnchain(e, t, n, r) {
      this.requireSupport("melt", "onchain"), this.validateMeltQuote(e);
      let i = e.fee_options.find((e) => e.fee_index === n);
      this.failIfNullish(i, "feeIndex must match an onchain melt quote fee option", {
        feeIndex: n,
        feeOptions: e.fee_options.map((e) => e.fee_index)
      });
      let a = Y(t);
      await this._ensureOperableKeysets(a.map((e) => e.id), {
        implicit: true,
        fetchKeys: false
      });
      let o = this.getFeesForProofs(a), s = J(a), c = e.amount.add(i.fee_reserve).add(o);
      this.failIf(s.lessThan(c), "Not enough proofs to cover amount + fee", {
        sendAmount: s.toString(),
        totalRequired: c.toString(),
        amount: e.amount.toString(),
        fee_reserve: i.fee_reserve.toString(),
        inputFee: o.toString()
      });
      let l = await this.prepareMelt("onchain", e, a, r);
      return await this.completeMelt(l, r?.privkey, { extraPayload: { fee_index: n } });
    }
    async prepareMelt(e, t, n, r, i) {
      this.validateMeltQuote(t), i = i ?? this.defaultOutputType();
      let { keysetId: a, onCountersReserved: o, nut08Change: s = true } = r || {};
      try {
        await this._ensureOperableKeysets(n.map((e) => e.id), {
          implicit: true,
          fetchKeys: false
        });
      } catch (e) {
        if (this._strictCachedKeysets || !(e instanceof te))
          throw e;
        this._logger.warn("Melt input keyset is not listed by the mint; proceeding anyway", { keyset: e.keysetId });
      }
      let c = this.getKeyset(a), l = Y(n), u = J(l), d = [];
      this.failIf(u.lessThan(t.amount), "Not enough proofs to cover amount + fee reserve", {
        sendAmount: u.toString(),
        quoteAmount: t.amount.toString()
      });
      let f = u.subtract(t.amount);
      if (i.type === "custom")
        d = i.data;
      else if (s && f.greaterThan(0)) {
        this.failIf(!c.isActive, "Melt change keyset is inactive. Use an active keyset or set nut08Change: false to forfeit it", { keyset: c.id }), c = this.getOutputKeyset(a);
        let e = Math.max(Ho(f.toBigInt()), 1), t = Array(e).fill(0);
        this._logger.debug("Creating NUT-08 blanks for fee reserve", {
          feeReserve: f,
          denominations: t
        });
        let n = {
          ...i,
          denominations: t
        }, r = await this.addCountersToOutputTypes(c.id, n);
        [n] = r.outputTypes, r.used && this.safeCallback(o, r.used, { op: "meltProofs" }), this._logger.debug("melt counter", {
          counter: r.used,
          meltOT: Ko(n)
        }), d = this.createOutputData(0, c, n);
      }
      return {
        method: e,
        inputs: l,
        outputData: d,
        keysetId: c.id,
        quote: t
      };
    }
    async completeMelt(e, t, n) {
      let r = typeof n == "boolean" ? { preferAsync: n } : n ?? {}, i = e.inputs, a = e.outputData.map((e) => e.blindedMessage), o = e.quote.quote;
      t && (i = this.signP2PKProofs(i, t, e.outputData, o)), i = this._prepareInputsForMint(i);
      let s = r.extraPayload;
      if (s) {
        let e = [
          "quote",
          "inputs",
          "outputs",
          "prefer_async"
        ], t = Object.keys(s).filter((t) => e.includes(t));
        this.failIf(t.length > 0, "extraPayload cannot override reserved melt fields", { reserved: t });
      }
      let c = {
        quote: o,
        inputs: i,
        outputs: a,
        ...r.preferAsync ? { prefer_async: true } : {},
        ...s
      }, l = await this.withStaleKeysetRepair(() => this.mint.melt(e.method, c)), u = {
        ...e.quote,
        ...l
      }, d = l.change ?? [], f;
      try {
        d.length > 0 && await this._ensureOperableKeysets(d.filter((e) => !e.amount.isZero()).map((e) => e.id), { implicit: true }), f = this.createMeltChangeProofs(e.outputData, d);
      } catch (t) {
        throw new ne(e.outputData, u, { cause: t });
      }
      let p = f.map((e) => e.amount.toString());
      return r.preferAsync ? this._logger.debug("ASYNC MELT REQUESTED", {
        state: l.state,
        changeAmounts: p
      }) : this._logger.debug("MELT COMPLETED", { changeAmounts: p }), {
        quote: u,
        change: f,
        outputData: f.length > 0 ? [] : e.outputData
      };
    }
    createMeltChangeProofs(e, t) {
      this.failIf(t.length > e.length, `Mint returned ${t.length} signatures, but only ${e.length} blanks were provided. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`);
      let n = t.map((e) => e && {
        ...e,
        amount: j.from(e.amount)
      });
      this.validateReturnedSignatures(n, e);
      let r = n.filter((e) => e.amount.isZero()).length;
      r > 0 && this._logger.warn("Mint returned zero-value change signatures, which NUT-08 requires it to omit", {
        mintUrl: this.mint.mintUrl,
        count: r
      });
      let i = [];
      return n.forEach((t, n) => {
        t.amount.isZero() || i.push(e[n].toProof(t, this.keysetForSignature(t.id)));
      }), i;
    }
    _ensureKeysetsForSignatures(e) {
      return this._ensureOperableKeysets(e.map((e) => e?.amount.isZero() ? undefined : e?.id), { implicit: true });
    }
    keysetForSignature(e) {
      try {
        return this.getKeyset(e);
      } catch (t) {
        throw new S(`Cannot reconstruct proof: keyset ${e} is not loaded in this wallet (may be inactive after rotation). If the wallet is seeded, try restoring (NUT-09) to recover.`, { cause: t });
      }
    }
    async checkProofsStates(e) {
      let t = new TextEncoder, n = e.map((e) => (e.id !== undefined && W(e.id, this._logger), Bt(t.encode(e.secret)).toHex(true))), r = this.maxArrayLength, i = [];
      for (let e = 0;e < n.length; e += r) {
        let t = n.slice(e, e + r), { states: a } = await this.mint.check({ Ys: t }), o = {};
        a.forEach((e) => {
          o[e.Y] = e;
        });
        for (let e = 0;e < t.length; e++) {
          let n = o[t[e]];
          this.failIfNullish(n, "Could not find state for proof with Y: " + t[e]), i.push(n);
        }
      }
      return i;
    }
    async verifyMintSignatures(e, t) {
      if (t?.signal?.aborted)
        throw new T("Operation aborted by caller");
      if (this.failIf(e.length > ue, `Token contains too many proofs: ${e.length}, maximum is ${ue}`), !this._strictCachedKeysets)
        for (let n of new Set(e.map((e) => e.id))) {
          if (t?.signal?.aborted)
            throw new T("Operation aborted by caller");
          try {
            await this._keyChain.ensureKeysetKeys(n);
          } catch {}
        }
      return Na(e, (e) => this._keyChain.getKeyset(e), t);
    }
    async groupProofsByState(e) {
      let t = await this.checkProofsStates(e), n = {
        unspent: [],
        pending: [],
        spent: []
      };
      for (let r = 0;r < t.length; r++) {
        let i = e[r];
        switch (t[r].state) {
          case Ua.UNSPENT:
            n.unspent.push(i);
            break;
          case Ua.PENDING:
            n.pending.push(i);
            break;
          case Ua.SPENT:
            n.spent.push(i);
            break;
        }
      }
      return n;
    }
  };
  var _s;
  var vs = class e {
    constructor(e, t) {
      this.tokenGeneration = 0, this.sessionGeneration = 0, this.tokens = {}, this.pool = [], this.desiredPoolSize = 100, this.maxPerMint = 100, this.mintUrl = e, this.req = t?.request ?? vo, this.logger = t?.logger ?? O;
      let n = Math.max(1, t?.desiredPoolSize ?? this.desiredPoolSize), r = Math.max(1, t?.maxPerMint ?? this.maxPerMint);
      this.desiredPoolSize = Math.min(n, 100), this.maxPerMint = Math.min(r, 100), this.desiredPoolSize !== n && this.logger.warn("AuthManager: desiredPoolSize exceeds internal cap and was clamped", {
        configured: n,
        clampedTo: this.desiredPoolSize
      }), this.maxPerMint !== r && this.logger.warn("AuthManager: maxPerMint exceeds internal cap and was clamped", {
        configured: r,
        clampedTo: this.maxPerMint
      });
    }
    attachOIDC(e) {
      return this.oidc && this.oidcListener && this.oidc.removeTokenListener(this.oidcListener), this.oidc && this.oidc !== e && (this.tokens = {}), this.tokenGeneration++, this.sessionGeneration++, this.oidc = e, this.bindOIDC(), this;
    }
    bindOIDC() {
      let e = this.oidc;
      if (!e)
        return;
      this.oidcListener && e.removeTokenListener(this.oidcListener);
      let t = (n, r) => {
        if (this.oidc !== e || r === "refresh" && this.oidcListener !== t) {
          this.logger.warn("AuthManager: ignoring tokens from an earlier session");
          return;
        }
        this.updateFromOIDC(n, r);
      };
      this.oidcListener = t, e.addTokenListener(t);
    }
    get poolSize() {
      return this.pool.length;
    }
    get poolTarget() {
      return this.desiredPoolSize;
    }
    get activeAuthKeysetId() {
      try {
        return this.keychain?.getCheapestKeyset().id;
      } catch {
        return;
      }
    }
    get hasCAT() {
      return !!this.tokens.accessToken;
    }
    getCAT() {
      return this.tokens.accessToken;
    }
    setCAT(e) {
      this.tokenGeneration++, this.sessionGeneration++, this.tokens = { accessToken: e }, this.bindOIDC();
    }
    async ensureCAT(e) {
      if (this.validForAtLeast(e) || !this.oidc || !this.tokens.refreshToken)
        return this.tokens.accessToken;
      if (this.inflightRefresh?.session !== this.sessionGeneration) {
        let e = this.tokenGeneration, t = this.sessionGeneration, n = (async () => {
          try {
            let t = await this.oidc.refresh(this.tokens.refreshToken);
            this.tokenGeneration === e && this.updateFromOIDC(t, "refresh");
          } catch (e) {
            this.logger.warn("AuthManager: CAT refresh failed", { err: e });
          }
        })();
        this.inflightRefresh = {
          session: t,
          promise: n
        };
      }
      let t = this.inflightRefresh;
      try {
        await t.promise;
      } finally {
        this.inflightRefresh === t && (this.inflightRefresh = undefined);
      }
      return this.validForAtLeast(0) ? this.tokens.accessToken : undefined;
    }
    validForAtLeast(t = e.MIN_VALID_SECS) {
      let { accessToken: n, expiresAt: r } = this.tokens;
      return n ? r ? Date.now() + t * 1000 < r : true : false;
    }
    updateFromOIDC(e, t) {
      if (!e.access_token)
        return;
      this.tokenGeneration++, t === "signin" && this.sessionGeneration++;
      let n = Date.now();
      if (this.tokens.accessToken = e.access_token, this.tokens.refreshToken = e.refresh_token || (t === "refresh" ? this.tokens.refreshToken : undefined), typeof e.expires_in == "number" && e.expires_in > 0)
        this.tokens.expiresAt = n + e.expires_in * 1000;
      else {
        let t = this.parseJwtExpSec(e.access_token);
        this.tokens.expiresAt = t ? t * 1000 : undefined;
      }
      this.bindOIDC(), this.logger.debug("AuthManager: OIDC tokens updated", { expiresAt: this.tokens.expiresAt });
    }
    async ensure(e) {
      if (await this.init(), this.pool.length >= e)
        return;
      let t = Math.max(this.desiredPoolSize, e), n = this.getBatMaxMint(), r = Math.min(t - this.pool.length, n);
      r <= 0 || await this.topUp(r);
    }
    async getBlindAuthToken({ method: e, path: t }) {
      return this.info && !this.info.requiresBlindAuthToken(e, t) && this.logger.warn("Endpoint is not marked as protected by NUT-22; still issuing BAT", {
        method: e,
        path: t
      }), this.withLock(async () => {
        if (await this.ensure(1), this.pool.length === 0)
          throw new S("AuthManager: no BATs available and minting failed");
        let n = this.pool.pop();
        return this.logger.debug("AuthManager: BAT requested", {
          method: e,
          path: t,
          remaining: this.pool.length
        }), ys(n);
      });
    }
    importPool(e, t = "replace") {
      t === "replace" && (this.pool = []);
      let n = new Map(this.pool.map((e) => [e.secret, e]));
      for (let t of e)
        !t || !t.secret || !t.C || !t.id || n.has(t.secret) || (this.pool.push(t), n.set(t.secret, t));
    }
    exportPool() {
      return this.pool.map((e) => ({
        ...e,
        dleq: e.dleq ? { ...e.dleq } : undefined
      }));
    }
    parseJwtExpSec(e) {
      if (!e)
        return;
      let t = e.split(".");
      if (t.length === 3)
        try {
          let e = De(tt(t[1])), n = JSON.parse(e), r = typeof n.exp == "number" ? n.exp : Number(n.exp);
          if (Number.isFinite(r) && r > 0)
            return r;
        } catch {
          this.logger.warn("JWT access token was malformed.");
        }
    }
    async withLock(e) {
      let t = this.lockChain ?? Promise.resolve(), n, r = new Promise((e) => {
        n = e;
      }), i = t.then(() => r);
      this.lockChain = i;
      try {
        return await t, await e();
      } finally {
        n(), this.lockChain === i && (this.lockChain = undefined);
      }
    }
    async init() {
      if (!this.info) {
        let e = await this.req({
          endpoint: q(this.mintUrl, "/v1/info"),
          method: "GET",
          logger: this.logger
        });
        this.info = new Z(e, this.logger);
      }
      if (!this.keychain) {
        let [e, t] = await Promise.all([this.req({
          endpoint: q(this.mintUrl, "/v1/auth/blind/keysets"),
          method: "GET",
          logger: this.logger
        }), this.req({
          endpoint: q(this.mintUrl, "/v1/auth/blind/keys"),
          method: "GET",
          logger: this.logger
        })]);
        if (!Array.isArray(e.keysets) || !Array.isArray(t.keysets))
          throw new S("AuthManager: mint returned malformed auth keysets");
        if (e.keysets.length > 1e4 || t.keysets.length > 1e4)
          throw new S("AuthManager: mint returned more auth keysets than can be processed");
        let n = e.keysets.map((e) => La(e)), r = t.keysets.map((e) => Ra(e)), i = ko.mintToCacheDTO(this.mintUrl, n, r);
        this.keychain = ko.fromCache(this.mintUrl, "auth", i), this.keychain.getCheapestKeyset();
      }
    }
    getBatMaxMint() {
      if (!this.info)
        throw new S("AuthManager: mint info not loaded");
      let e = this.info.nuts[22], t = X(e?.bat_max_mint, "nuts.22.bat_max_mint", this.maxPerMint);
      return Math.max(1, Math.min(this.maxPerMint, t));
    }
    getActiveKeys() {
      if (!this.keychain)
        throw new S("AuthManager: keyset not loaded for active keyset");
      return this.keychain.getCheapestKeyset();
    }
    async topUp(e) {
      if (!this.info)
        throw new S("AuthManager: mint info not loaded");
      let t = this.info.requiresClearAuthToken("POST", "/v1/auth/blind/mint"), n = this.sessionGeneration, r;
      if (t) {
        if (r = await this.ensureCAT(), this.sessionGeneration !== n)
          throw new S("AuthManager: session changed while obtaining BATs");
        if (!r)
          throw new S("AuthManager: Clear-auth token required for /v1/auth/blind/mint but not available. Authenticate with the mint to obtain a CAT first.");
      }
      let i = this.getActiveKeys(), a = Q.createRandomData(e, i), o = { outputs: a.map((e) => e.blindedMessage) }, s = {};
      r && (s["Clear-auth"] = r);
      let c = await this.req({
        endpoint: q(this.mintUrl, "/v1/auth/blind/mint"),
        method: "POST",
        headers: s,
        ...r ? { redirect: "error" } : {},
        requestBody: o,
        logger: this.logger
      });
      if (!Array.isArray(c?.signatures) || c.signatures.length !== a.length)
        throw new S("AuthManager: bad BAT mint response");
      let l = c.signatures.map((e) => ({
        ...e,
        amount: j.from(e.amount)
      })), u = a.map((e, t) => e.toProof(l[t], i));
      for (let e of u)
        if (!ha(e, i))
          throw new S("AuthManager: mint returned BAT with invalid DLEQ");
      if (t && this.sessionGeneration !== n)
        throw new S("AuthManager: session changed while obtaining BATs");
      this.pool.push(...u), this.logger.debug("AuthManager: performed topUp", {
        minted: u.length,
        pool: this.pool.length
      });
    }
  };
  _s = vs, _s.MIN_VALID_SECS = 30;
  function ys(e) {
    return `authA${et(utf8ToBytes(JSON.stringify({
      id: e.id,
      secret: e.secret,
      C: e.C
    })))}`;
  }

  // src/sigall.ts
  var SIGALL_GOLDEN_BLINDED = [
    `02${"aa".repeat(32)}`,
    `03${"bb".repeat(32)}`
  ];
  function sigAllDigest(inputSecrets, blinded) {
    return bytesToHex(sha256(utf8ToBytes(inputSecrets.join("") + blinded.join(""))));
  }
  function randomBlindingHex() {
    return bytesToHex(secp256k1.utils.randomSecretKey());
  }
  function sigAllOutputPoint(secret, rHex) {
    if (!/^[0-9a-f]{64}$/.test(rHex))
      throw new Error("template output blinding factor must be 32 lowercase hex bytes");
    const yHex = Bt(new TextEncoder().encode(secret)).toHex(true);
    const Y = secp256k1.Point.fromHex(yHex);
    const B_ = Y.add(secp256k1.Point.BASE.multiply(BigInt(`0x${rHex}`)));
    return bytesToHex(B_.toBytes(true));
  }
  function sigAllTemplateDigest(template) {
    return sigAllDigest(template.inputs.map((input) => input.secret), template.outputs.map((output) => sigAllOutputPoint(output.secret, output.r)));
  }
  function buildP2PKOutputSecret(recipient, nonce) {
    if (!/^0[23][0-9a-f]{64}$/.test(recipient))
      throw new Error("output recipient must be a compressed secp256k1 key");
    if (!/^[0-9a-f]{32}$/.test(nonce))
      throw new Error("output secret nonce must be 16 lowercase hex bytes");
    return JSON.stringify([
      "P2PK",
      { nonce, data: recipient, tags: [["sigflag", "SIG_INPUTS"]] }
    ]);
  }
  function signDigest(digestHex, spendSecretKey) {
    return bytesToHex(schnorr.sign(hexToBytes(digestHex), spendSecretKey));
  }

  // src/wallet.ts
  function memoryStorage() {
    const map = new Map;
    return {
      get: (key) => map.get(key) ?? null,
      set: (key, value) => {
        map.set(key, value);
      }
    };
  }
  function browserStorage(namespace) {
    return {
      get: (key) => window.localStorage.getItem(`${namespace}:${key}`),
      set: (key, value) => window.localStorage.setItem(`${namespace}:${key}`, value)
    };
  }
  function refundClaimMessage(bidId, outputPublicKeys) {
    if (!bidId)
      throw new Error("a refund claim must name a bid");
    const outputs = [...outputPublicKeys].sort();
    for (const key of outputs) {
      if (!/^0[23][0-9a-f]{64}$/.test(key)) {
        throw new Error("refund claim output keys must be compressed secp256k1 points");
      }
    }
    return new TextEncoder().encode(`PlebeianAuctionsCashuRefundClaimV1
bid_id=${bidId}
outputs=${outputs.join(",")}`);
  }
  function settleClaimMessage(auctionId, proofRefs) {
    if (!auctionId)
      throw new Error("a settlement claim must name an auction");
    const refs = [...proofRefs].sort();
    for (const ref of refs) {
      if (!/^0[23][0-9a-f]{64}$/.test(ref)) {
        throw new Error("settlement claim proof references must be compressed secp256k1 points");
      }
    }
    return new TextEncoder().encode(`PlebeianAuctionsCashuSettleClaimV1
auction_id=${auctionId}
proofs=${refs.join(",")}`);
  }
  function refundClaimMessageV2(auctionId, proofRefs, outputPublicKeys) {
    if (!auctionId)
      throw new Error("a refund claim must name an auction");
    const refs = [...proofRefs].sort();
    for (const ref of refs) {
      if (!/^0[23][0-9a-f]{64}$/.test(ref)) {
        throw new Error("refund claim proof references must be compressed secp256k1 points");
      }
    }
    const outputs = [...outputPublicKeys].sort();
    for (const key of outputs) {
      if (!/^0[23][0-9a-f]{64}$/.test(key)) {
        throw new Error("refund claim output keys must be compressed secp256k1 points");
      }
    }
    return new TextEncoder().encode(`PlebeianAuctionsCashuRefundClaimV2
auction_id=${auctionId}
proofs=${refs.join(",")}
outputs=${outputs.join(",")}`);
  }
  function hexToBytes3(hex) {
    if (!/^(?:[0-9a-f]{2})+$/.test(hex))
      throw new Error("expected lowercase hex");
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0;index < bytes.length; index++) {
      bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }
  function bytesToHex3(bytes) {
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function xOnly(compressedHex) {
    if (!/^0[23][0-9a-f]{64}$/.test(compressedHex)) {
      throw new Error("expected a compressed secp256k1 public key");
    }
    return compressedHex.slice(2);
  }
  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function sha256Bytes(value) {
    const digest = await crypto.subtle.digest("SHA-256", value);
    return new Uint8Array(digest);
  }

  class BidderWallet {
    wallet;
    storage;
    mintUrl;
    loaded = false;
    constructor(mintUrl, storage) {
      this.mintUrl = mintUrl.replace(/\/+$/, "");
      this.wallet = new gs(this.mintUrl);
      this.storage = storage;
    }
    async ensureLoaded() {
      if (this.loaded)
        return;
      await this.wallet.loadMint();
      this.loaded = true;
    }
    read(key, fallback) {
      const raw = this.storage.get(key);
      if (!raw)
        return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    }
    spendable() {
      return this.read("spendable", []);
    }
    locked() {
      return this.read("locked", []);
    }
    spendSecretKey() {
      const stored = this.storage.get("spendKey");
      if (stored) {
        if (!/^[0-9a-f]{64}$/.test(stored))
          throw new Error("the stored wallet spend key is malformed");
        return hexToBytes3(stored);
      }
      const { secretKey } = schnorr.keygen();
      this.storage.set("spendKey", bytesToHex3(secretKey));
      return secretKey;
    }
    spendPublicKey() {
      return `02${bytesToHex3(schnorr.getPublicKey(this.spendSecretKey()))}`;
    }
    readLockedBids() {
      const raw = this.storage.get("lockedBids");
      if (!raw)
        return {};
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    recordLockedBid(bidId, proofs, spendPublicKey = this.spendPublicKey(), auctionId) {
      if (!bidId || !proofs.length)
        return;
      const bids = this.readLockedBids();
      bids[bidId] = { proofs, spendPublicKey, ...auctionId ? { auctionId } : {} };
      this.storage.set("lockedBids", JSON.stringify(bids));
    }
    lockedBidForAuction(auctionId) {
      for (const [bidId, locked] of Object.entries(this.readLockedBids())) {
        if (locked.auctionId === auctionId)
          return { bidId, locked };
      }
      return null;
    }
    lockedForBid(bidId) {
      return this.readLockedBids()[bidId]?.proofs ?? [];
    }
    lockedBidIds() {
      return Object.entries(this.readLockedBids()).map(([bidId, locked]) => ({
        bidId,
        ...locked.auctionId ? { auctionId: locked.auctionId } : {},
        amount: (locked.proofs ?? []).reduce((total, proof) => total + Number(proof.amount), 0)
      }));
    }
    balance() {
      return this.spendable().reduce((total, proof) => total + Number(proof.amount), 0);
    }
    lockedBalance() {
      return this.locked().reduce((total, proof) => total + Number(proof.amount), 0);
    }
    async mint(amount, onProgress) {
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("mint amount must be a positive whole number of sats");
      }
      await this.ensureLoaded();
      onProgress?.("requesting a mint quote");
      const quote = await this.wallet.createMintQuoteBolt11(amount);
      let state = quote.state ?? Va.UNPAID;
      for (let attempt = 0;attempt < 20 && state !== Va.PAID && state !== Va.ISSUED; attempt++) {
        onProgress?.(`waiting for the mint to confirm (${state})`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const checked = await this.wallet.checkMintQuoteBolt11(quote.quote);
        state = checked.state ?? state;
      }
      if (state !== Va.PAID && state !== Va.ISSUED) {
        throw new Error(`mint quote was not paid (state ${state})`);
      }
      onProgress?.("minting proofs");
      const proofs = await this.wallet.mintProofsBolt11(amount, quote);
      this.storage.set("spendable", JSON.stringify([...this.spendable(), ...proofs]));
      return this.balance();
    }
    async lockForBid(amount, committeePublicKey, locktime, onProgress) {
      const refundPublicKey = this.spendPublicKey();
      const proofs = this.spendable();
      if (!proofs.length) {
        const locked = this.lockedBalance();
        throw new Error(locked > 0 ? `all ${locked} sats are locked to a previous bid; release them first, or mint more` : "the wallet holds no proofs; mint some first");
      }
      if (this.balance() < amount) {
        const locked = this.lockedBalance();
        throw new Error(`the wallet holds ${this.balance()} spendable sats${locked > 0 ? ` and ${locked} locked` : ""}, less than the ${amount} needed`);
      }
      await this.ensureLoaded();
      onProgress?.("locking proofs to the committee");
      const spendKeyHex = bytesToHex3(this.spendSecretKey());
      const ownSuffix = this.spendPublicKey().slice(2);
      const spendable = proofs.map((proof) => String(proof.secret).includes(ownSuffix) ? Vn([proof], spendKeyHex)[0] : proof);
      const builder = new Fo().addMainPubkey(xOnly(committeePublicKey)).addRefundPubkey(xOnly(refundPublicKey)).lockUntil(locktime);
      const { send, keep } = await this.wallet.send(amount, spendable, {}, {
        send: { type: "p2pk", options: builder.toOptions() }
      });
      this.storage.set("spendable", JSON.stringify(keep ?? []));
      this.storage.set("locked", JSON.stringify([...this.locked(), ...send]));
      this.storage.set("lockedUntil", String(locktime));
      const bindings = send.map((proof) => ({
        amount: Number(proof.amount),
        id: proof.id,
        Y: Bt(new TextEncoder().encode(proof.secret)).toHex(true),
        C: proof.C,
        dleq: { e: proof.dleq.e, s: proof.dleq.s, r: proof.dleq.r }
      }));
      if (bindings.some((b) => !b.dleq.e || !b.dleq.s || !b.dleq.r)) {
        throw new Error("the mint returned no DLEQ proof, so the locked value cannot be proven");
      }
      const refs = bindings.map((b) => b.Y).sort();
      const tokenSha256 = await sha256Hex(JSON.stringify(ua(send)));
      return {
        proofStateRefs: refs,
        tokenSha256,
        refundPublicKey,
        amount,
        mintUrl: this.mintUrl,
        proofs: bindings,
        lockedProofs: send,
        spendPublicKey: refundPublicKey
      };
    }
    async lockForBidSigAll(amount, committeePublicKey, locktime, onProgress) {
      const refundPublicKey = this.spendPublicKey();
      const proofs = this.spendable();
      if (!proofs.length) {
        const locked = this.lockedBalance();
        throw new Error(locked > 0 ? `all ${locked} sats are locked to a previous bid; release them first, or mint more` : "the wallet holds no proofs; mint some first");
      }
      if (this.balance() < amount) {
        const locked = this.lockedBalance();
        throw new Error(`the wallet holds ${this.balance()} spendable sats${locked > 0 ? ` and ${locked} locked` : ""}, less than the ${amount} needed`);
      }
      await this.ensureLoaded();
      onProgress?.("locking proofs to the bidder and the committee (SIG_ALL)");
      const spendKeyHex = bytesToHex3(this.spendSecretKey());
      const ownSuffix = this.spendPublicKey().slice(2);
      const spendable = proofs.map((proof) => String(proof.secret).includes(ownSuffix) ? Vn([proof], spendKeyHex)[0] : proof);
      const builder = new Fo().addMainPubkey(xOnly(this.spendPublicKey())).addMainPubkey(xOnly(committeePublicKey)).requireMainSignatures(2).addRefundPubkey(xOnly(refundPublicKey)).requireRefundSignatures(1).sigAll().lockUntil(locktime);
      const { send, keep } = await this.wallet.send(amount, spendable, {}, {
        send: { type: "p2pk", options: builder.toOptions() }
      });
      this.storage.set("spendable", JSON.stringify(keep ?? []));
      this.storage.set("locked", JSON.stringify([...this.locked(), ...send]));
      this.storage.set("lockedUntil", String(locktime));
      const bindings = send.map((proof) => ({
        amount: Number(proof.amount),
        id: proof.id,
        Y: Bt(new TextEncoder().encode(proof.secret)).toHex(true),
        C: proof.C,
        dleq: { e: proof.dleq.e, s: proof.dleq.s, r: proof.dleq.r }
      }));
      if (bindings.some((b) => !b.dleq.e || !b.dleq.s || !b.dleq.r)) {
        throw new Error("the mint returned no DLEQ proof, so the locked value cannot be proven");
      }
      const refs = bindings.map((b) => b.Y).sort();
      const tokenSha256 = await sha256Hex(JSON.stringify(ua(send)));
      return {
        proofStateRefs: refs,
        tokenSha256,
        refundPublicKey,
        amount,
        mintUrl: this.mintUrl,
        proofs: bindings,
        lockedProofs: send,
        spendPublicKey: refundPublicKey,
        fundingMode: "cashu_sigall_v1"
      };
    }
    async buildOutcomeTemplates(auction, funding) {
      if (!auction?.id)
        throw new Error("outcome templates must name an auction");
      const sellerKey = auction.seller_coco_payment_public_key;
      if (!/^0[23][0-9a-f]{64}$/.test(sellerKey)) {
        throw new Error("the auction committed no seller payout key, so settle has no destination");
      }
      if (!funding.lockedProofs.length) {
        throw new Error("outcome templates need the locked proofs");
      }
      const spendKey = this.spendSecretKey();
      const build = (recipient) => {
        const inputs = funding.lockedProofs.map((proof) => ({
          amount: Number(proof.amount),
          id: proof.id,
          secret: String(proof.secret),
          C: String(proof.C)
        }));
        const outputs = funding.lockedProofs.map((proof) => {
          const nonce = randomBlindingHex().slice(0, 32);
          return {
            amount: Number(proof.amount),
            id: proof.id,
            secret: buildP2PKOutputSecret(recipient, nonce),
            r: randomBlindingHex()
          };
        });
        const unsigned = { inputs, outputs, digest: "", bidder_signature: "" };
        const digest = sigAllTemplateDigest(unsigned);
        return { inputs, outputs, digest, bidder_signature: signDigest(digest, spendKey) };
      };
      return { settle: build(sellerKey), refund: build(this.spendPublicKey()) };
    }
    bidProofs(funding) {
      if (!funding.lockedProofs.length) {
        throw new Error("a bid must carry the locked proofs it commits");
      }
      return funding.lockedProofs.map((proof) => ({
        amount: Number(proof.amount),
        id: proof.id,
        secret: String(proof.secret),
        C: String(proof.C),
        dleq: proof.dleq ? { e: proof.dleq.e, s: proof.dleq.s, r: proof.dleq.r } : undefined
      }));
    }
    async sigAllBidMaterial(auction, funding) {
      const proofs = this.bidProofs(funding);
      const outcome_templates = await this.buildOutcomeTemplates(auction, funding);
      return { proofs, outcome_templates };
    }
    async preauthorizeOutcome(auctionId, proofStateRefs, lockedProofs) {
      if (!auctionId)
        throw new Error("outcome authorizations must name an auction");
      const refs = [...proofStateRefs].sort();
      for (const ref of refs) {
        if (!/^0[23][0-9a-f]{64}$/.test(ref)) {
          throw new Error("outcome authorization proof references must be compressed secp256k1 points");
        }
      }
      if (lockedProofs.length !== refs.length) {
        throw new Error("outcome authorizations need one locked proof per proof reference");
      }
      const outputs = refs.map(() => this.spendPublicKey());
      const spendKey = this.spendSecretKey();
      const settleSignature = bytesToHex3(schnorr.sign(await sha256Bytes(settleClaimMessage(auctionId, refs)), spendKey));
      const refundSignature = bytesToHex3(schnorr.sign(await sha256Bytes(refundClaimMessageV2(auctionId, refs, outputs)), spendKey));
      return {
        schema: "PlebeianAuctionsPOCBidOutcomesV1",
        settle_spend_signature: settleSignature,
        refund_spend_signature: refundSignature
      };
    }
    async refundBid(bidId, event, endpoint = "/api/demo/mint-refund") {
      const locked = this.readLockedBids()[bidId];
      const proofs = locked?.proofs ?? [];
      if (!proofs.length) {
        throw new Error("this browser holds no locked proofs for that bid");
      }
      const spendPublicKey = locked.spendPublicKey;
      if (spendPublicKey !== this.spendPublicKey()) {
        throw new Error("the wallet spend key changed since this bid was locked, so it cannot claim the refund");
      }
      const auctionId = locked.auctionId;
      if (!auctionId) {
        throw new Error("this wallet holds no auction id for that bid's lock, so it cannot sign the V2 refund claim");
      }
      const proofRefs = proofs.map((proof) => Bt(new TextEncoder().encode(proof.secret)).toHex(true)).sort();
      const outputPublicKeys = proofs.map(() => spendPublicKey);
      const signature = bytesToHex3(schnorr.sign(await sha256Bytes(refundClaimMessageV2(auctionId, proofRefs, outputPublicKeys)), this.spendSecretKey()));
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bid_id: bidId,
          proofs: proofs.map((proof) => ({
            amount: Number(proof.amount),
            id: proof.id,
            secret: proof.secret,
            C: proof.C,
            dleq: proof.dleq
          })),
          event,
          spend_public_key: spendPublicKey,
          output_public_keys: outputPublicKeys,
          spend_signature: signature
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `refund failed (HTTP ${response.status})`);
      }
      const fresh = data.proofs ?? [];
      if (!fresh.length)
        throw new Error("the coordinator returned no refund proofs");
      const spent = new Set(proofs.map((proof) => proof.secret));
      this.storage.set("locked", JSON.stringify(this.locked().filter((proof) => !spent.has(proof.secret))));
      const bids = this.readLockedBids();
      delete bids[bidId];
      this.storage.set("lockedBids", JSON.stringify(bids));
      this.storage.set("spendable", JSON.stringify([...this.spendable(), ...fresh]));
      return { amount: fresh.reduce((total, proof) => total + Number(proof.amount), 0) };
    }
    async settleAuction(auctionId, event, endpoint = "/api/demo/mint-settle") {
      const found = this.lockedBidForAuction(auctionId);
      if (!found) {
        throw new Error("this browser holds no locked proofs for that auction");
      }
      const { bidId, locked } = found;
      const proofs = locked.proofs ?? [];
      if (!proofs.length) {
        throw new Error("this browser holds no locked proofs for that auction");
      }
      if (locked.spendPublicKey !== this.spendPublicKey()) {
        throw new Error("the wallet spend key changed since this bid was locked, so it cannot settle");
      }
      const refs = proofs.map((proof) => Bt(new TextEncoder().encode(proof.secret)).toHex(true)).sort();
      const signature = bytesToHex3(schnorr.sign(await sha256Bytes(settleClaimMessage(auctionId, refs)), this.spendSecretKey()));
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auction_id: auctionId,
          proofs: proofs.map((proof) => ({
            amount: Number(proof.amount),
            id: proof.id,
            secret: proof.secret,
            C: proof.C,
            dleq: proof.dleq
          })),
          event,
          spend_signature: signature
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `settlement failed (HTTP ${response.status})`);
      }
      const payout = data.proofs ?? [];
      if (!payout.length)
        throw new Error("the coordinator returned no settlement proofs");
      const spent = new Set(proofs.map((proof) => proof.secret));
      this.storage.set("locked", JSON.stringify(this.locked().filter((proof) => !spent.has(proof.secret))));
      const bids = this.readLockedBids();
      delete bids[bidId];
      this.storage.set("lockedBids", JSON.stringify(bids));
      return {
        amount: payout.reduce((total, proof) => total + Number(proof.amount), 0),
        tokenSha256: await sha256Hex(JSON.stringify(ua(payout)))
      };
    }
    async importSettlement(auctionId, endpoint = `/api/demo/settlement/${encodeURIComponent(auctionId)}`) {
      const response = await fetch(endpoint, { headers: { accept: "application/json" } });
      if (response.status === 404)
        return { amount: 0, imported: false };
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `settlement import failed (HTTP ${response.status})`);
      }
      const fresh = data.proofs ?? [];
      if (!fresh.length)
        return { amount: 0, imported: false };
      const known = new Set(this.spendable().map((proof) => proof.secret));
      const added = fresh.filter((proof) => !known.has(proof.secret));
      if (!added.length)
        return { amount: 0, imported: false };
      this.storage.set("spendable", JSON.stringify([...this.spendable(), ...added]));
      return { amount: added.reduce((total, proof) => total + Number(proof.amount), 0), imported: true };
    }
    lockedUntil() {
      const raw = this.storage.get("lockedUntil");
      return raw ? Number(raw) : 0;
    }
    reclaimLocked() {
      const locked = this.locked();
      if (!locked.length)
        return { released: 0, reclaimableAt: 0 };
      const reclaimableAt = this.lockedUntil();
      if (reclaimableAt > 0 && Math.floor(Date.now() / 1000) < reclaimableAt) {
        return { released: 0, reclaimableAt };
      }
      const released = locked.reduce((total, proof) => total + Number(proof.amount), 0);
      this.storage.set("spendable", JSON.stringify([...this.spendable(), ...locked]));
      this.storage.set("locked", JSON.stringify([]));
      this.storage.set("lockedBids", JSON.stringify({}));
      this.storage.set("lockedUntil", "0");
      return { released, reclaimableAt: 0 };
    }
    async lockedProofStates() {
      const locked = this.locked();
      if (!locked.length)
        return {};
      await this.ensureLoaded();
      const states = await this.wallet.checkProofsStates(locked);
      const bySecret = new Map(locked.map((proof) => [proof.secret, "unknown"]));
      const result = {};
      for (const entry of states) {
        const key = entry.Y ?? entry.secret ?? "unknown";
        result[key] = entry.state ?? "unknown";
      }
      return result;
    }
  }

  // src/browser.ts
  window.PlebeianWallet = { BidderWallet, browserStorage, memoryStorage, refundClaimMessage, refundClaimMessageV2 };
})();
