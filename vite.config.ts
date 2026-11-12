import { defineConfig } from 'vite';
// relative asset paths so the build works under GitHub Pages' /golf-course-tycoon/ subpath
export default defineConfig({ base: './', server: { port: 5173 } });
