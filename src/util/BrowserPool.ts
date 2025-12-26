import { chromium, Browser } from 'playwright';

export class BrowserPool {
	private browsers: Browser[] = [];
	private index = 0;

	constructor(private size: number) {}

	async init() {
		for (let i = 0; i < this.size; i++) {
			this.browsers.push(await this.launch());
		}
	}

	private async launch(): Promise<Browser> {
		return chromium.launch({
			headless: true,
			args: ['--disable-dev-shm-usage', '--no-sandbox'],
		});
	}

	acquire(): Browser {
		// Round-robin
		const browser = this.browsers[this.index];
		this.index = (this.index + 1) % this.browsers.length;
		return browser;
	}

	async replace(dead: Browser) {
		const index = this.browsers.indexOf(dead);
		if (index === -1) return;
		try {
			await dead.close();
		} catch (_) {
			/* empty */
		}
		this.browsers[index] = await this.launch();
	}

	async shutdown() {
		await Promise.all(
			this.browsers.map((b, index) => b.close().catch((e) => console.error(`Error closing browser ${index}`, e))),
		);
	}
}
