import express from 'express';
import { healthRouter } from 'routes/health.js';
import { renderRouter } from 'routes/render.js';
import type { BrowserPool } from 'util/BrowserPool.js';
import type { Semaphore } from 'util/Semaphore.js';
import type { Config } from 'model.js';

export function createApp(browserPool: BrowserPool, semaphore: Semaphore, config: Config) {
	const app = express();
	app.use(express.json());
	app.use(healthRouter());
	app.use(renderRouter(browserPool, semaphore, config));
	return app;
}
