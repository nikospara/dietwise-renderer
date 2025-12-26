import type { Router } from 'express';
import { Router as createRouter } from 'express';
import type { BrowserPool } from 'util/BrowserPool.js';
import type { Semaphore } from 'util/Semaphore.js';

export interface RenderRequest {
	url: string;
	timeout?: number;
}

export interface RenderResponse {
	html: string;
	finalUrl: string;
}

export function renderRouter(browserPool: BrowserPool, semaphore: Semaphore): Router {
	const router = createRouter();

	router.post('/render', async (req, res) => {
		const release = await semaphore.acquire();
		const browser = browserPool.acquire();

		const context = await browser.newContext({
			javaScriptEnabled: true,
		});

		const page = await context.newPage();
		let url = '<NO URL>';

		try {
			const renderRequest: RenderRequest = {
				url: req.body.url,
				timeout: req.body.timeout,
			};
			if (typeof renderRequest.url !== 'string' || renderRequest.url.trim() === '') {
				throw new Error('Invalid or empty url');
			}
			url = renderRequest.url;
			const timeout = renderRequest.timeout || 15000;
			await page.goto(url, {
				waitUntil: 'networkidle',
				timeout: timeout,
			});
			const html = await page.content();
			const response: RenderResponse = {
				html,
				finalUrl: page.url(),
			};
			res.json(response);
		} catch (err) {
			console.error(`Error rendering ${url}`, err);
			res.status(500).json({
				error: String(err),
			});
		} finally {
			await context.close();
			release();
		}
	});

	return router;
}
