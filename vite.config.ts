/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
	// Relative asset paths so the build works from any mount point,
	// including GitHub Pages' /<repo>/ project subpath.
	base: "./",
	test: {
		// Keep the unit suite scoped away from e2e/*.spec.ts (playwright-only).
		include: ["tests/**/*.test.ts"],
	},
});
