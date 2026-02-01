#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractJsonLdRecipesFromString } from '../src/cleaner/extractJsonLdRecipes.js';
import { nodeDomAdapter } from '../src/cleaner/nodeDomAdapter.js';

type CliResult = {
	inputPath: string;
	showHelp: boolean;
};

function printHelp(): void {
	const help = `Usage:
  tsx scripts/extract-jsonld-recipes.ts <path-to-html>
`;
	process.stdout.write(help);
}

function parseArgs(argv: string[]): CliResult {
	let inputPath = '';
	let showHelp = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;

		if (arg === '-h' || arg === '--help') {
			showHelp = true;
			continue;
		}

		if (!arg.startsWith('-')) {
			if (!inputPath) {
				inputPath = arg;
				continue;
			}
			throw new Error(`Unexpected argument: ${arg}`);
		}

		throw new Error(`Unknown option: ${arg}`);
	}

	return { inputPath, showHelp };
}

async function main() {
	const { inputPath, showHelp } = parseArgs(process.argv.slice(2));
	if (showHelp || !inputPath) {
		printHelp();
		if (!inputPath) process.exitCode = 1;
		return;
	}

	const testDir = process.env.DW_RENDERER_TEST_DIR;
	const finalInputPath =
		testDir && /^[0-9]{3}[a-z]?\.html$/.test(inputPath) ? path.join(testDir, inputPath) : inputPath;
	const html = await readFile(finalInputPath, 'utf8');
	const result = extractJsonLdRecipesFromString(html, nodeDomAdapter);
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
