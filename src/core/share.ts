/**
 * Client-side URL hash encoding and decoding for sharing Compose YAML files
 * without any backend or external server.
 * Uses CompressionStream/DecompressionStream ('deflate-raw') with URL-safe base64.
 */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
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

/**
 * Pipe bytes through a (de)compression stream and collect the output.
 * Reading and writing happen concurrently via pipeThrough, which avoids the
 * backpressure stall you can get by awaiting writes before reading.
 */
async function transformBytes(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Compress a YAML string into a URL-safe hash payload (`v1.<base64url>`).
 */
export async function compressYamlToHash(yamlText: string): Promise<string> {
  const inputBytes = new TextEncoder().encode(yamlText);

  if (typeof CompressionStream !== 'undefined') {
    const compressed = await transformBytes(inputBytes, new CompressionStream('deflate-raw'));
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
    const clean = hashPayload
      .replace(/^#/, '')
      .replace(/^.*?compose=/, '')
      .split('&')[0]!
      .trim();
    if (!clean) return null;

    if (clean.startsWith('z.')) {
      if (typeof DecompressionStream === 'undefined') return null;
      const compressedBytes = base64UrlToBytes(clean.slice(2));
      const decompressed = await transformBytes(
        compressedBytes,
        new DecompressionStream('deflate-raw'),
      );
      return new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
    }

    if (clean.startsWith('u.')) {
      const rawBytes = base64UrlToBytes(clean.slice(2));
      return new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
    }

    return null;
  } catch {
    return null;
  }
}
