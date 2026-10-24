/**
 * Client-side URL hash encoding and decoding for sharing Compose YAML files
 * without any backend or external server.
 * Uses CompressionStream/DecompressionStream ('deflate-raw') with URL-safe base64.
 */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function streamToUint8Array(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Compress a YAML string into a URL-safe hash payload (`v1.<base64url>`).
 */
export async function compressYamlToHash(yamlText: string): Promise<string> {
  const inputBytes = new TextEncoder().encode(yamlText);

  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    await writer.write(inputBytes);
    await writer.close();
    const compressed = await streamToUint8Array(
      cs.readable as ReadableStream<Uint8Array>,
    );
    return `z.${bytesToBase64Url(compressed)}`;
  }

  return `u.${bytesToBase64Url(inputBytes)}`;
}

/**
 * Decompress a URL-safe hash payload back into the original YAML string.
 */
export async function decompressYamlFromHash(
  hashPayload: string,
): Promise<string | null> {
  try {
    const clean = hashPayload.replace(/^#/, '').replace(/^compose=/, '').trim();
    if (!clean) return null;

    if (clean.startsWith('z.')) {
      if (typeof DecompressionStream === 'undefined') return null;
      const compressedBytes = base64UrlToBytes(clean.slice(2));
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      await writer.write(compressedBytes as unknown as BufferSource);
      await writer.close();
      const decompressed = await streamToUint8Array(
        ds.readable as ReadableStream<Uint8Array>,
      );
      return new TextDecoder().decode(decompressed);
    }

    if (clean.startsWith('u.')) {
      const rawBytes = base64UrlToBytes(clean.slice(2));
      return new TextDecoder().decode(rawBytes);
    }

    return null;
  } catch {
    return null;
  }
}
