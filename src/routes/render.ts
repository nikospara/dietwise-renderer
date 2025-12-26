import type { Router } from 'express';
import { Router as createRouter } from 'express';
import type { BrowserPool } from 'util/BrowserPool.js';
import type { Semaphore } from 'util/Semaphore.js';
import type { Config } from 'model.js';
import type { BrowserContext, Page } from 'playwright';
import { withHardTimeout } from 'util/withHardTimeout.js';

export const CANONICAL_PROFILE = {
	userAgent:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
		'AppleWebKit/537.36 (KHTML, like Gecko) ' +
		'Chrome/124.0.0.0 Safari/537.36',
	//viewport: { width: 1440, height: 900 },
	locale: 'en-US',
	timezoneId: 'America/New_York',
	deviceScaleFactor: 1,
	isMobile: false,
	hasTouch: false,
};

export interface Viewport {
	width: number;
	height: number;
}

export interface RenderRequest {
	url: string;
	timeout?: number;
	viewport?: Viewport;
}

export interface Screenshot {
	format: 'jpeg' | 'png';
	width: number;
	height: number;
	base64: string;
}

export interface RenderResponse {
	html: string;
	finalUrl: string;
	screenshot?: Screenshot;
}

export function renderRouter(browserPool: BrowserPool, semaphore: Semaphore, config: Config): Router {
	const router = createRouter();

	router.post('/render', async (req, res) => {
		const release = await semaphore.acquire();
		const browser = browserPool.acquire();

		let context: BrowserContext | null = null;
		let page: Page | null;
		let url = '<NO URL>';
		const now = Date.now();

		try {
			const renderRequest: RenderRequest = {
				url: req.body.url,
				timeout: req.body.timeout,
				viewport: req.body.viewport,
			};
			if (typeof renderRequest.url !== 'string' || renderRequest.url.trim() === '') {
				throw new Error('Invalid or empty url');
			}
			url = renderRequest.url;
			const timeout = renderRequest.timeout || 15000;

			const task: Promise<RenderResponse> = (async () => {
				context = await browser.newContext({
					...CANONICAL_PROFILE,
					viewport: normalizeViewport(renderRequest.viewport),
					recordHar: {
						path: `/tmp/dietwise-renderer/${now}.har`,
						content: 'embed',
					},
				});
				page = await context.newPage();
				page.on('console', (msg) => {
					console.log(`[PAGE LOG] [${url}] ${msg.type()}: ${msg.text()}`);
				});
				page.on('pageerror', (err) => {
					console.error('[PAGE ERROR] [${url}]', err);
				});
				await page.goto(url, {
					waitUntil: 'domcontentloaded',
					timeout: timeout,
				});
				await page.waitForTimeout(1000);
				return {
					html: await page.content(),
					finalUrl: page.url(),
				};
			})();

			const hardTimeout: () => Promise<void> = async () => {
				// Hard kill path
				try {
					if (page) {
						await page.screenshot({
							path: `/tmp/dietwise-renderer/${now}.png`,
							fullPage: true,
						});
					}
				} catch (_) {
					// Intentionally blank
				}
				if (context) await closeContext(context);
				await browserPool.replace(browser);
			};

			const result = await withHardTimeout(task, config.hardTimeoutMs, hardTimeout);

			res.json(result);
		} catch (err) {
			console.error(`Error rendering ${url}`, err);
			res.status(500).json({
				error: String(err),
			});
		} finally {
			if (context) await closeContext(context);
			release();
		}
	});

	return router;
}

async function closeContext(c: BrowserContext) {
	try {
		await c.close();
	} catch (e) {
		console.warn('Caught error while closing context', e);
	}
}

function normalizeViewport(vp?: Viewport): Viewport {
	if (!vp) return { width: 1440, height: 900 };

	return {
		width: Math.min(Math.max(vp.width, 320), 1440),
		height: Math.min(Math.max(vp.height, 480), 2000),
	};
}
