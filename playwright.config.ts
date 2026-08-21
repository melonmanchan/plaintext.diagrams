import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	fullyParallel: true,
	retries: process.env.CI ? 2 : 0,
	reporter: [["list"], ["html", { open: "never" }]],
	snapshotPathTemplate: "{testDir}/{testFileName}-snapshots/{arg}{ext}",
	use: {
		baseURL: "http://localhost:5199",
		viewport: { width: 1400, height: 900 },
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1400, height: 900 },
			},
		},
	],
	webServer: {
		command: "bunx vite --port 5199 --strictPort",
		url: "http://localhost:5199",
		reuseExistingServer: !process.env.CI,
	},
});
