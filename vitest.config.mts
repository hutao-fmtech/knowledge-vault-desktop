import { defineConfig } from 'vitest/config'

// Shared by `vitest run` at the root and in every workspace package (`pnpm -r test`):
// the include is cwd-relative, so a package run only picks up its own test/.
export default defineConfig({
  test: {
    include: ['{apps,packages}/*/test/**/*.{test,spec}.{ts,mts,cts,js,mjs,cjs}', 'test/**/*.{test,spec}.{ts,mts,cts,js,mjs,cjs}'],
    exclude: ['**/node_modules/**', '**/lib/**', 'scripts/**'],
  },
})
