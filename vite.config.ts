import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any mount point,
  // including GitHub Pages' /<repo>/ project subpath.
  base: './',
});
