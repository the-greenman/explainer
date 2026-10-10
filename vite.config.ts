import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', styleguide: 'src/styleguide.ts', 'experimental/flight': 'src/experimental/flight/index.ts', 'experimental/flight/pure': 'src/experimental/flight/pure.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
  },
});
