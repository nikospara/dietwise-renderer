import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	timeout: 30_000,
	fullyParallel: true,
	reporter: [['list']],
	use: {
		baseUrl: 'http://127.0.0.1:3000'
	},
	webServer: {
		command: 'npm run dev',
		url: 'http://127.0.0.1:3000/health',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
