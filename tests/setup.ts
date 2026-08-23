import "fake-indexeddb/auto";

// src/lib/db.ts guards on window.indexedDB; node has no window, so point it at
// the fake so the real IndexedDB wrapper can be exercised unmodified.
if (typeof globalThis.window === "undefined") {
  (globalThis as { window?: unknown }).window = globalThis;
}

// pdfjs-dist defines `Iterator.prototype.join` at module scope; the Iterator
// global only exists on node 23+. A bare constructor supplies the
// `.prototype` pdfjs extends, so pdf.js loads on node 20/22 (CI runs node 20).
const globalWithIterator = globalThis as unknown as { Iterator?: unknown };
if (typeof globalWithIterator.Iterator === "undefined") {
  globalWithIterator.Iterator = function IteratorPolyfill() {};
}

// pdfjs-dist constructs `new DOMMatrix()` at module scope; node has no
// DOMMatrix global. The stub carries the 2D affine fields pdfjs reads, which
// is enough for the pure indexing math under test.
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixStub {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(init?: number[] | string) {
      if (Array.isArray(init)) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }

    multiplySelf(other: DOMMatrixStub): this {
      const { a, b, c, d, e, f } = this;
      this.a = a * other.a + c * other.b;
      this.b = b * other.a + d * other.b;
      this.c = a * other.c + c * other.d;
      this.d = b * other.c + d * other.d;
      this.e = a * other.e + c * other.f + e;
      this.f = b * other.e + d * other.f + f;
      return this;
    }

    invertSelf(): this {
      const det = this.a * this.d - this.b * this.c;
      const { a, b, c, d, e, f } = this;
      this.a = d / det;
      this.b = -b / det;
      this.c = -c / det;
      this.d = a / det;
      this.e = (c * f - d * e) / det;
      this.f = (b * e - a * f) / det;
      return this;
    }

    static fromMatrix(other: DOMMatrixStub): DOMMatrixStub {
      return new DOMMatrixStub([other.a, other.b, other.c, other.d, other.e, other.f]);
    }
  }

  (globalThis as { DOMMatrix?: typeof DOMMatrixStub }).DOMMatrix = DOMMatrixStub as never;
}

