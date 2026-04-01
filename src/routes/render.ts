import type { Router } from 'express';
import { Router as createRouter } from 'express';
import { lookup as dnsLookup } from 'node:dns/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserPool } from 'app/util/BrowserPool.js';
import type { Semaphore } from 'app/util/Semaphore.js';
import type { Config } from 'app/model.js';
import type { BrowserContext, Page } from 'playwright';
import { withHardTimeout } from 'app/util/withHardTimeout.js';
import { cleanHtmlForLLM, PageCleaningResult, RECIPE_MINIMAL_TAGS } from 'app/cleaner/cleanHtmlForLLM.js';
import { nodeDomAdapter } from 'app/cleaner/nodeDomAdapter.js';
import { extractJsonLdRecipesFromString, Recipe } from 'app/cleaner/extractJsonLdRecipes.js';
import {
	HostLookup,
	InvalidRenderTargetError,
	validateBrowserRequestUrl,
	validateRemoteRenderUrl,
	validateRenderTarget,
} from 'app/routes/renderTarget.js';

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

const MINIMAL_REQUEST_HEADER_NAMES = new Set([
	'accept',
	'accept-language',
	'content-type',
	'origin',
	'range',
	'user-agent',
]);

export interface Viewport {
	width: number;
	height: number;
}

export interface RenderRequest {
	url: string;
	simplify?: boolean;
	includeJsonLdRecipes: boolean;
	timeout?: number;
	viewport?: Viewport;
	outputMinimalText?: boolean;
}

export interface Screenshot {
	format: 'jpeg' | 'png';
	width: number;
	height: number;
	base64: string;
}

export interface RenderResponse {
	output: string;
	jsonLdRecipes?: Recipe[];
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
				includeJsonLdRecipes: req.body.includeJsonLdRecipes,
				timeout: req.body.timeout,
				viewport: req.body.viewport,
				outputMinimalText: req.body.outputMinimalText,
			};
			if (typeof renderRequest.url !== 'string' || renderRequest.url.trim() === '') {
				throw new Error('Invalid or empty url');
			}
			const timeout = renderRequest.timeout || 15000;

			const testDir = process.env.DW_RENDERER_TEST_DIR;
			const renderTarget = await validateRenderTarget(renderRequest.url, { testDir });
			if (renderTarget.kind === 'test') {
				url = renderTarget.fileName;
				const testPath = path.join(testDir ?? '', renderTarget.fileName);
				try {
					const output = await fs.readFile(testPath, 'utf8');
					let result: RenderResponse = {
						output,
						finalUrl: renderTarget.fileName,
					};
					if (renderRequest.includeJsonLdRecipes) {
						result.jsonLdRecipes = extractJsonLdRecipesFromString(output, nodeDomAdapter);
					}
					if (renderRequest.simplify) {
						const pass1 = cleanHtml(result.output, !!renderRequest.outputMinimalText);
						result = {
							...result,
							output: pass1.output,
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

			url = renderTarget.url;
			const browser = browserPool.acquire();

			const task: Promise<RenderResponse> = (async () => {
				context = await browser.newContext({
					...CANONICAL_PROFILE,
					acceptDownloads: false,
					extraHTTPHeaders: {
						'Accept-Language': 'en-US,en;q=0.9',
					},
					serviceWorkers: 'block',
					viewport: normalizeViewport(renderRequest.viewport),
					recordHar: {
						path: `/tmp/dietwise-renderer/${now}.har`,
						content: 'embed',
					},
				});
				await context.clearPermissions();
				await context.addInitScript(() => {
					const clearBrowserState = () => {
						try {
							window.localStorage.clear();
						} catch (_) {
							// Intentionally blank
						}
						try {
							window.sessionStorage.clear();
						} catch (_) {
							// Intentionally blank
						}
						void indexedDB
							.databases?.()
							.then((databases) =>
								Promise.all(
									databases
										.map((database) => database.name)
										.filter((name): name is string => typeof name === 'string')
										.map((name) => indexedDB.deleteDatabase(name)),
								),
							)
							.catch(() => undefined);
						void caches
							?.keys()
							.then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
							.catch(() => undefined);
					};

					clearBrowserState();
					window.addEventListener('beforeunload', clearBrowserState);

					const denied = 'denied';
					const notAllowed = (name: string) =>
						Object.assign(new Error(`${name} is disabled in this browser context`), {
							name: 'NotAllowedError',
						});

					if ('Notification' in window) {
						Object.defineProperty(Notification, 'permission', {
							configurable: true,
							get: () => denied,
						});
						Notification.requestPermission = async () => denied;
					}

					if ('geolocation' in navigator) {
						const geolocationError = () => {
							throw notAllowed('Geolocation');
						};
						navigator.geolocation.getCurrentPosition = ((success, error) => {
							error?.({
								code: 1,
								message: 'Geolocation is disabled in this browser context',
								PERMISSION_DENIED: 1,
								POSITION_UNAVAILABLE: 2,
								TIMEOUT: 3,
							});
							if (!error) geolocationError();
						}) as Geolocation['getCurrentPosition'];
						navigator.geolocation.watchPosition = ((success, error) => {
							error?.({
								code: 1,
								message: 'Geolocation is disabled in this browser context',
								PERMISSION_DENIED: 1,
								POSITION_UNAVAILABLE: 2,
								TIMEOUT: 3,
							});
							if (!error) geolocationError();
							return 0;
						}) as Geolocation['watchPosition'];
					}

					if ('mediaDevices' in navigator && navigator.mediaDevices) {
						navigator.mediaDevices.getUserMedia = async () => {
							throw notAllowed('getUserMedia');
						};
						navigator.mediaDevices.getDisplayMedia = async () => {
							throw notAllowed('getDisplayMedia');
						};
					}

					if ('clipboard' in navigator && navigator.clipboard) {
						navigator.clipboard.read = async () => {
							throw notAllowed('Clipboard read');
						};
						navigator.clipboard.readText = async () => {
							throw notAllowed('Clipboard readText');
						};
						navigator.clipboard.write = async () => {
							throw notAllowed('Clipboard write');
						};
						navigator.clipboard.writeText = async () => {
							throw notAllowed('Clipboard writeText');
						};
					}
				});
				const cachedLookup = createCachedLookup();
				await context.route('**/*', async (route) => {
					const request = route.request();
					if (
						request.isNavigationRequest() &&
						request.frame() === page?.mainFrame() &&
						request.method() !== 'GET'
					) {
						console.warn(
							`Blocked non-GET top-level navigation from ${url} to ${request.url()} (${request.method()})`,
						);
						await route.abort('blockedbyclient');
						return;
					}

					try {
						await validateBrowserRequestUrl(request.url(), cachedLookup);
						await route.continue({
							headers: minimalizeRequestHeaders(request.headers()),
						});
					} catch (err) {
						console.warn(`Blocked outbound request from ${url} to ${request.url()}`, err);
						await route.abort('blockedbyclient');
					}
				});
				page = await context.newPage();
				page.on('download', async (download) => {
					console.warn(`Blocked download from ${url} to ${download.url()}`);
					try {
						await download.cancel();
					} catch (err) {
						console.warn(`Failed to cancel blocked download from ${download.url()}`, err);
					}
				});
				page.on('console', (msg) => {
					console.log(`[PAGE LOG] [${url}] ${msg.type()}: ${msg.text()}`);
				});
				page.on('pageerror', (err) => {
					console.error('[PAGE ERROR] [${url}]', err);
				});
				const response = await page.goto(renderTarget.url, {
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
				const finalUrl = await validateRemoteRenderUrl(page.url());
				return {
					output: await page.content(),
					finalUrl,
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

			if (renderRequest.includeJsonLdRecipes) {
				result.jsonLdRecipes = extractJsonLdRecipesFromString(result.output, nodeDomAdapter);
			}
			if (renderRequest.simplify) {
				const pass1 = cleanHtml(result.output, !!renderRequest.outputMinimalText);
				result = {
					...result,
					output: pass1.output,
				};
			}

			res.json(result);
		} catch (err) {
			console.error(`Error rendering ${url}`, err);
			const errorMessage = String(err);
			const hasHttpStatus = err && typeof err === 'object' && 'httpStatus' in err;
			const responseStatus =
				hasHttpStatus || isNetworkError(errorMessage) || err instanceof InvalidRenderTargetError ? 400 : 500;
			const httpStatus =
				hasHttpStatus && typeof (err as { httpStatus?: unknown }).httpStatus === 'number'
					? (err as { httpStatus: number }).httpStatus
					: undefined;
			const errorBody: { error: string; httpStatus?: number } = {
				error: errorMessage,
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
		await c.clearCookies();
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

function cleanHtml(html: string, outputMinimalText: boolean): PageCleaningResult {
	return cleanHtmlForLLM(html, nodeDomAdapter, {
		allowedTags: new Set(RECIPE_MINIMAL_TAGS),
		keepTables: false,
		dropMedia: true,
		outputMinimalText,
	});
}

function isNetworkError(message: string): boolean {
	return (
		message.includes('net::ERR_CONNECTION_REFUSED') ||
		message.includes('ECONNREFUSED') ||
		message.includes('net::ERR_NAME_NOT_RESOLVED') ||
		message.includes('ENOTFOUND') ||
		message.includes('net::ERR_CONNECTION_TIMED_OUT') ||
		message.includes('ETIMEDOUT') ||
		message.includes('net::ERR_CONNECTION_CLOSED') ||
		message.includes('net::ERR_NETWORK_CHANGED') ||
		message.includes('net::ERR_ADDRESS_UNREACHABLE') ||
		message.includes('EHOSTUNREACH') ||
		message.includes('ENETUNREACH')
	);
}

function createCachedLookup(): HostLookup {
	const cache = new Map<string, Promise<{ address: string; family: number }[]>>();

	return async (hostname, options) => {
		const cacheKey = hostname.toLowerCase();
		let resultPromise = cache.get(cacheKey);
		if (!resultPromise) {
			resultPromise = dnsLookup(hostname, options);
			cache.set(cacheKey, resultPromise);
		}
		return resultPromise;
	};
}

function minimalizeRequestHeaders(headers: Record<string, string>): Record<string, string> {
	const filteredHeaders = Object.fromEntries(
		Object.entries(headers).filter(([name]) => MINIMAL_REQUEST_HEADER_NAMES.has(name.toLowerCase())),
	);

	delete filteredHeaders.cookie;
	delete filteredHeaders.referer;

	return filteredHeaders;
}
