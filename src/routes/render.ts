import type { Router } from 'express';
import { Router as createRouter } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserPool } from 'app/util/BrowserPool.js';
import type { Semaphore } from 'app/util/Semaphore.js';
import type { Config } from 'app/model.js';
import type { BrowserContext, Page } from 'playwright';
import { withHardTimeout } from 'app/util/withHardTimeout.js';
import { cleanHtmlForLLM, PageCleaningResult, RECIPE_MINIMAL_TAGS } from 'app/cleaner/cleanHtmlForLLM.js';
import { nodeDomAdapter } from 'app/cleaner/nodeDomAdapter.js';

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
	simplify?: boolean;
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

		let context: BrowserContext | null = null;
		let page: Page | null;
		let url = '<NO URL>';
		const now = Date.now();

		try {
			const renderRequest: RenderRequest = {
				url: req.body.url,
				simplify: req.body.simplify,
				timeout: req.body.timeout,
				viewport: req.body.viewport,
			};
			if (typeof renderRequest.url !== 'string' || renderRequest.url.trim() === '') {
				throw new Error('Invalid or empty url');
			}
			url = renderRequest.url;
			const timeout = renderRequest.timeout || 15000;

			// Test path: the environment variable DW_RENDERER_TEST_DIR points to a test directory and the requested URL is like 123.html
			const testDir = process.env.DW_RENDERER_TEST_DIR;
			if (testDir && /^[0-9]{3}\.html$/.test(renderRequest.url)) {
				const testPath = path.join(testDir, renderRequest.url);
				try {
					const html = await fs.readFile(testPath, 'utf8');
					let result: RenderResponse = {
						html,
						finalUrl: renderRequest.url,
					};
					if (renderRequest.simplify) {
						const pass1 = cleanHtml(result.html);
						result = {
							...result,
							html: pass1.html,
						};
					}
					res.json(result);
					return;
				} catch (err) {
					if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
						res.status(404).json({ error: 'HTTP 404' });
						return;
					}
					throw err;
				}
			}

			// Real path
			const browser = browserPool.acquire();

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
				const response = await page.goto(url, {
					waitUntil: 'domcontentloaded',
					timeout: timeout,
				});
				if (response) {
					const status = response.status();
					if (status >= 400) {
						const httpError = new Error(`HTTP ${status}`);
						(httpError as Error & { httpStatus?: number }).httpStatus = status;
						throw httpError;
					}
				}
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
				context = null;
				await browserPool.replace(browser);
			};

			let result = await withHardTimeout(task, config.hardTimeoutMs, hardTimeout);

			if (renderRequest.simplify) {
				const pass1 = cleanHtml(result.html);
				result = {
					...result,
					html: pass1.html,
				};
			}

			res.json(result);
		} catch (err) {
			console.error(`Error rendering ${url}`, err);
			const hasHttpStatus = err && typeof err === 'object' && 'httpStatus' in err;
			const responseStatus = hasHttpStatus ? 400 : 500;
			const httpStatus =
				hasHttpStatus && typeof (err as { httpStatus?: unknown }).httpStatus === 'number'
					? (err as { httpStatus: number }).httpStatus
					: undefined;
			const errorBody: { error: string; httpStatus?: number } = {
				error: String(err),
			};
			if (httpStatus !== undefined) {
				errorBody.httpStatus = httpStatus;
			}
			res.status(responseStatus).json(errorBody);
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

function cleanHtml(html: string): PageCleaningResult {
	return cleanHtmlForLLM(html, nodeDomAdapter, {
		allowedTags: new Set(RECIPE_MINIMAL_TAGS),
		keepTables: false,
		dropMedia: true,
	});
}
