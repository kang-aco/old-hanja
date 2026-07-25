import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // `astro dev` 에서도 D1/R2 바인딩을 로컬 miniflare 로 흉내내 준다.
    // wrangler.toml 의 바인딩 + .dev.vars 의 시크릿을 읽어온다.
    platformProxy: { enabled: true },
    // 이미지가 없는 앱이므로 런타임 이미지 서비스를 쓰지 않는다 (sharp 경고 제거)
    imageService: 'passthrough',
  }),
  vite: {
    // Workers 런타임에서 SDK 가 Node 내장 모듈을 참조하는 경우를 대비
    ssr: { external: ['node:buffer', 'node:stream', 'node:crypto'] },
  },
});
