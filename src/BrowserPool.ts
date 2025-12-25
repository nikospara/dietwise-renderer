import { chromium, Browser } from 'playwright';

export class BrowserPool {
	private browsers: Browser[] = [];
	private index = 0;

	constructor(private size: number) {}

	async init() {
		for (let i = 0; i < this.size; i++) {
			const browser = await chromium.launch({
				headless: true,
				args: ['--disable-dev-shm-usage', '--no-sandbox'],
			});
			this.browsers.push(browser);
		}
	}

	acquire(): Browser {
		// Round-robin
		const browser = this.browsers[this.index];
		this.index = (this.index + 1) % this.browsers.length;
		return browser;
	}

	async shutdown() {
		await Promise.all(this.browsers.map((b) => b.close()));
	}
}
