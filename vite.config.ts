import { defineConfig } from 'vite';

// Two ES entries; rollup puts the shared code (the component registry) in one common chunk.
export default defineConfig({
  build: {
    lib: {
      entry: { index: 'src/index.ts', tarot: 'examples/tarot/components.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
  },
});
