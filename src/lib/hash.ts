/** Web Crypto 기반 SHA-256 (Workers 런타임에서 그대로 동작) */
export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 한자 판별은 src/lib/hanja.ts 한 곳에서만 정의한다 (범위 오류 재발 방지).
export { extractHanja } from './hanja';
