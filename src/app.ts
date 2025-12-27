import express from 'express';
import { healthRouter } from 'app/routes/health.js';
import { renderRouter } from 'app/routes/render.js';
import type { BrowserPool } from 'app/util/BrowserPool.js';
import type { Semaphore } from 'app/util/Semaphore.js';
import type { Config } from 'app/model.js';

export function createApp(browserPool: BrowserPool, semaphore: Semaphore, config: Config) {
	const app = express();
	app.use(express.json());
	app.use(healthRouter());
	app.use(renderRouter(browserPool, semaphore, config));
	return app;
}
