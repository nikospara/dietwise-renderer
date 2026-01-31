// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { htmlToMinimalText, documentToMinimalText } from './htmlToMinimalText.js';
import { nodeDomAdapter } from './nodeDomAdapter.js';

describe('htmlToMinimalText', () => {
	it('converts cleaned HTML to minimal text with structure markers', () => {
		const input = `<!doctype html><html><body>
			<h1>Title</h1>
			<p>Intro</p>
			<ul>
				<li>Item 1</li>
				<li>Item 2
					<ul><li>Sub</li></ul>
				</li>
			</ul>
			<table><tr><th>Key</th><td>Value</td></tr></table>
		</body></html>`;

		const expected = `# Title

Intro

- Item 1
- Item 2
- Sub

Key\tValue`;

		expect(htmlToMinimalText(input, nodeDomAdapter)).toBe(expected);
		const doc = nodeDomAdapter.parse(input);
		expect(documentToMinimalText(doc)).toBe(expected);
	});
});
