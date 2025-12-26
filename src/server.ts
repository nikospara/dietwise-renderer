import { BrowserPool } from 'util/BrowserPool.js';
import { Semaphore } from 'util/Semaphore.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const browserCount = Number(process.env.BROWSER_COUNT ?? 2); // Chromium processes
const maxConcurrentJobs = Number(process.env.MAX_CONCURRENT_JOBS ?? 4); // Pages total

const browserPool = new BrowserPool(browserCount);
const semaphore = new Semaphore(maxConcurrentJobs);
await browserPool.init();

const app = createApp(browserPool, semaphore);

process.on('SIGTERM', async () => {
	await browserPool.shutdown();
	process.exit(0);
});

app.listen(port, () => {
	console.log(`Server listening on http://localhost:${port}`);
});
