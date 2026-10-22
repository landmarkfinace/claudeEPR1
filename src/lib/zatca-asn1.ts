// ─────────────────────────────────────────────────────────────────────────────
// Minimal ASN.1 DER encoder / decoder (server-side only).
// Just enough to (1) build the PKCS#10 CSR ZATCA requires for onboarding and
// (2) read the signature value out of the CSID certificate ZATCA returns
// (QR tag 9). Node's crypto has no CSR builder, so this avoids depending on
// an openssl binary being installed on the server.
// ─────────────────────────────────────────────────────────────────────────────

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len])
  const bytes: number[] = []
  let n = len
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

export function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content])
}

export const der = {
  seq: (...items: Buffer[]) => tlv(0x30, Buffer.concat(items)),
  set: (...items: Buffer[]) => tlv(0x31, Buffer.concat(items)),
  int: (n: number) => {
    // small non-negative integers only (CSR version = 0)
    const bytes: number[] = []
    let v = n
    do {
      bytes.unshift(v & 0xff)
      v >>= 8
    } while (v > 0)
    if (bytes[0] & 0x80) bytes.unshift(0)
    return tlv(0x02, Buffer.from(bytes))
  },
  oid: (dotted: string) => {
    const parts = dotted.split('.').map((p) => Number(p))
    const out: number[] = [parts[0] * 40 + parts[1]]
    for (const p of parts.slice(2)) {
      const stack: number[] = []
      let v = p
      stack.unshift(v & 0x7f)
      v = Math.floor(v / 128)
      while (v > 0) {
        stack.unshift((v & 0x7f) | 0x80)
        v = Math.floor(v / 128)
      }
      out.push(...stack)
    }
    return tlv(0x06, Buffer.from(out))
  },
  utf8: (s: string) => tlv(0x0c, Buffer.from(s, 'utf8')),
  printable: (s: string) => tlv(0x13, Buffer.from(s, 'ascii')),
  octet: (b: Buffer) => tlv(0x04, b),
  bitString: (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b])),
  /** context-specific constructed tag [n] (explicit / constructed implicit) */
  ctx: (n: number, content: Buffer) => tlv(0xa0 + n, content),
}

// ── Decoder ─────────────────────────────────────────────────────────────────

export type Asn1Node = {
  tag: number
  /** full encoded bytes (header + content) */
  raw: Buffer
  content: Buffer
  children: Asn1Node[]
}

export function parseDer(buf: Buffer, offset = 0, end = buf.length): Asn1Node[] {
  const nodes: Asn1Node[] = []
  let pos = offset
  while (pos < end) {
    const start = pos
    const tag = buf[pos++]
    let len = buf[pos++]
    if (len & 0x80) {
      const n = len & 0x7f
      len = 0
      for (let i = 0; i < n; i++) len = (len << 8) | buf[pos++]
    }
    const content = buf.subarray(pos, pos + len)
    const constructed = (tag & 0x20) !== 0
    const node: Asn1Node = {
      tag,
      raw: buf.subarray(start, pos + len),
      content,
      children: constructed ? parseDer(buf, pos, pos + len) : [],
    }
    nodes.push(node)
    pos += len
  }
  return nodes
}

/**
 * X.509 Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }
 * Returns the raw signature bytes (BIT STRING content without the unused-bits byte).
 */
export function certificateSignatureBytes(certDer: Buffer): Buffer {
  const [cert] = parseDer(certDer)
  const sig = cert?.children?.[2]
  if (!sig || sig.tag !== 0x03) throw new Error('Unexpected certificate structure')
  return Buffer.from(sig.content.subarray(1))
}
