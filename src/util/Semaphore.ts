export class Semaphore {
	private queue: (() => void)[] = [];
	private active = 0;

	constructor(private readonly max: number) {}

	async acquire(): Promise<() => void> {
		if (this.active < this.max) {
			this.active++;
			return () => this.release();
		}

		return new Promise((resolve) => {
			this.queue.push(() => {
				this.active++;
				resolve(() => this.release());
			});
		});
	}

	private release() {
		this.active--;
		const next = this.queue.shift();
		if (next) next();
	}
}
