import { chromium, Browser } from 'playwright';

type PooledBrowser = {
	browser: Browser;
	alive: boolean;
};

export class BrowserPool {
	private browsers: PooledBrowser[] = [];
	private index = 0;

	constructor(private size: number) {}

	async init() {
		for (let i = 0; i < this.size; i++) {
			await this.addBrowser();
		}
	}

	private async addBrowser() {
		const entry: PooledBrowser = await this.launch();
		this.browsers.push(entry);
	}

	acquire(): Browser {
		for (let i = 0; i < this.browsers.length; i++) {
			const entry = this.browsers[this.index];
			this.index = (this.index + 1) % this.browsers.length;
			if (entry.alive) {
				return entry.browser;
			}
		}
		throw new Error('No alive browsers available');
	}

	async replace(dead: Browser) {
		const index = this.browsers.findIndex((b) => b.browser === dead);
		if (index === -1) return;
		const entry: PooledBrowser = await this.launch();
		this.browsers[index] = entry;
	}

	private async replacePooledBrowser(dead: PooledBrowser) {
		const index = this.browsers.indexOf(dead);
		if (index === -1) return;
		const entry: PooledBrowser = await this.launch();
		this.browsers[index] = entry;
	}

	private async launch(): Promise<PooledBrowser> {
		const browser = await chromium.launch({
			headless: true,
			args: ['--disable-dev-shm-usage', '--no-sandbox'],
		});
		const entry: PooledBrowser = { browser, alive: true };
		browser.on('disconnected', async () => {
			if (!entry.alive) return;

			entry.alive = false;
			console.error('Browser disconnected, replacing...');

			try {
				await browser.close();
			} catch (_) {
				// Intentionally blank
			}

			await this.replacePooledBrowser(entry);
		});
		return entry;
	}

	async shutdown() {
		await Promise.all(
			this.browsers.map((b, index) =>
				b.browser.close().catch((e) => console.error(`Error closing browser ${index}`, e)),
			),
		);
	}
}
