/** Web Crypto 기반 SHA-256 (Workers 런타임에서 그대로 동작) */
export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 문자열에서 한자만 추출 */
export function extractHanja(text: string): string[] {
  return [...text].filter((ch) => /[㐀-䶿一-鿿豈-﫿]/.test(ch));
}
