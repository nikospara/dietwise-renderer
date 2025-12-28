// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { cleanHtmlForLLM, HtmlToDocumentAdapter, DEFAULT_ALLOWED_TAGS } from './cleanHtmlForLLM.js';
import { nodeDomAdapter } from './nodeDomAdapter.js';

// --- helpers ---------------------------------------------------------------

function normalizeForAssert(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n') // treat <br> as newline
		.replace(/<[^>]+>/g, ' ') // drop tags
		.replace(/[\u200B\u200C\u200D]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function hasTag(html: string, tag: string): boolean {
	const doc = new DOMParser().parseFromString(`<wrapper>${html}</wrapper>`, 'text/html');
	return doc.querySelector(tag) !== null;
}

function getHref(html: string): string | null {
	const m = html.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
	return m ? m[1] : null;
}

function wrapInHtml(body: string): string {
	return `<!doctype html><html><head></head><body>${body}</body></html>`;
}

/** Browser adapter using DOMParser (only used when you call cleanHtmlForLLM in browser). */
const _browserDomAdapter: HtmlToDocumentAdapter = {
	parse(html: string): Document {
		// DOMParser exists in browsers; in Node this will throw unless you polyfill.
		return new DOMParser().parseFromString(html, 'text/html');
	},
};

const domAdapter: HtmlToDocumentAdapter = nodeDomAdapter;

// --- tests ----------------------------------------------------------------

describe('cleanHtmlForLLM', () => {
	it('does not unwrap <body> and returns non-empty for simple content', () => {
		const input = '<html><body><p>Hello</p></body></html>';
		const { html, textLength } = cleanHtmlForLLM(input, domAdapter);
		expect(textLength).toBeGreaterThan(0);
		expect(html).toBe('<p>Hello</p>');
	});

	it('strips comments', () => {
		const input = '<html><body><p><!-- I am a comment -->Hello</p></body></html>';
		const { html, textLength } = cleanHtmlForLLM(input, domAdapter);
		expect(textLength).toBeGreaterThan(0);
		expect(html).toBe('<p>Hello</p>');
	});

	it('strips all attributes except <a href>', () => {
		const input = wrapInHtml(`
			<div id="wrap" class="c">
				<p style="color:red">Hello <a href="https://example.com/a.html" onclick="x()" target="_blank">world</a></p>
				<p><span class="mm-recipes-nutrition-facts-label__nutrient-name mm-recipes-nutrition-facts-label__nutrient-name--has-postfix">Total Fat</span></p>
			</div>`);
		const { html } = cleanHtmlForLLM(input, domAdapter);

		// Only <a href> should survive; other attributes gone
		expect(hasTag(html, 'p')).toBe(true);
		expect(hasTag(html, 'a')).toBe(true);
		expect(getHref(html)).toBe('https://example.com/a.html');
		expect(/onclick=/.test(html)).toBe(false);
		expect(/style=/.test(html)).toBe(false);
		expect(/class=|id=/.test(html)).toBe(false);
	});

	it('unsafe links are unwrapped; text remains', () => {
		const input = wrapInHtml('<p>Click <a href="javascript:alert(1)">here</a> now.</p>');
		const { html } = cleanHtmlForLLM(input, domAdapter);
		expect(hasTag(html, 'a')).toBe(false);
		expect(normalizeForAssert(html)).toBe('Click here now.');
	});

	it('relative http(s) links are preserved', () => {
		const input = wrapInHtml('<p>See <a href="/path?q=1#frag">link</a></p>');
		const { html } = cleanHtmlForLLM(input, domAdapter);
		expect(getHref(html)).toBe('/path?q=1#frag');
	});

	it('unwraps non-whitelisted wrappers and keeps children', () => {
		const input = wrapInHtml('<div><div><p>Some text</p></div></div>');
		const { html } = cleanHtmlForLLM(input, domAdapter);
		// No divs should remain (not whitelisted); <p> should
		expect(hasTag(html, 'p')).toBe(true);
		expect(/<div/.test(html)).toBe(false);
		expect(normalizeForAssert(html)).toBe('Some text');
	});

	it('removes empty elements (including empty p/li/headers)', () => {
		const input = wrapInHtml(`
			<section>
				<h2> </h2>
				<p></p>
				<ul><li> </li><li>Item</li></ul>
			</section>`);
		const { html } = cleanHtmlForLLM(input, domAdapter);
		// One <li> with content should remain; the empty ones removed
		expect(html.match(/<li>/g)?.length).toBe(1);
		expect(normalizeForAssert(html)).toBe('Item');
	});

	it('collapses whitespace and preserves line intent via <br>', () => {
		const input = wrapInHtml('<p>Line   one</p>\n<p>\n\nLine\t\n two </p>');
		const { html } = cleanHtmlForLLM(input, domAdapter);
		// After normalization, paragraphs boundaries represented with <br>
		const terse = normalizeForAssert(html);
		expect(terse).toBe('Line one Line two');
		// HTML should use <br> to reflect breaks
		expect(html.includes('<br>')).toBe(true);
	});

	it('keeps only whitelisted inline tags; unwraps span/mark', () => {
		const input = wrapInHtml('<p>Start <span data-x>mid</span> <mark>end</mark></p>');
		const { html } = cleanHtmlForLLM(input, domAdapter);
		expect(/<span/.test(html)).toBe(false);
		expect(/<mark/.test(html)).toBe(false);
		expect(normalizeForAssert(html)).toBe('Start mid end');
	});

	it('list structure is preserved', () => {
		const input = wrapInHtml(`
			<div class="recipe">
				<h2>Ingredients</h2>
				<ul class="x"><li>1 cup flour</li><li><strong>2</strong> eggs</li></ul>
				<h2>Instructions</h2>
				<ol><li>Mix</li><li>Bake</li></ol>
			</div>`);
		const { html } = cleanHtmlForLLM(input, domAdapter);
		expect(html.match(/<h2>/g)?.length).toBe(2);
		expect(hasTag(html, 'ul')).toBe(true);
		expect(hasTag(html, 'ol')).toBe(true);
		expect(html.match(/<li>/g)?.length).toBe(4);
		expect(normalizeForAssert(html)).toContain('Ingredients 1 cup flour 2 eggs Instructions Mix Bake');
	});

	it('tables: dropped by default, preserved when keepTables=true', () => {
		const table = wrapInHtml(
			'<table><thead><tr><th>Nutrient</th><th>Value</th></tr></thead><tbody><tr><td>Calories</td><td>100</td></tr></tbody></table>',
		);
		const { html: defHtml } = cleanHtmlForLLM(table, domAdapter); // default keepTables=false
		// Table tags should not be present by default
		expect(/<table|<thead|<tbody|<tr|<th|<td/i.test(defHtml)).toBe(false);
		expect(normalizeForAssert(defHtml)).toBe('Nutrient Value Calories 100');

		const { html: keptHtml } = cleanHtmlForLLM(table, domAdapter, { keepTables: true });
		expect(/<table/i.test(keptHtml)).toBe(true);
		expect(/<td/i.test(keptHtml)).toBe(true);
	});

	it('media: removed by default; can still be removed when dropMedia=false if not allowed tag', () => {
		const input = wrapInHtml('<div><p>Intro</p><img src="img.jpg" alt="x"></div>');
		const { html: defHtml } = cleanHtmlForLLM(input, domAdapter); // dropMedia=true
		expect(/<img/i.test(defHtml)).toBe(false);

		// Even with dropMedia=false, <img> is not in allowedTags so it's unwrapped (and effectively disappears)
		const { html: stillNoImg } = cleanHtmlForLLM(input, domAdapter, {
			dropMedia: false,
		});
		expect(/<img/i.test(stillNoImg)).toBe(false);

		// If user explicitly allows 'img', element remains but attributes are stripped
		const allowed = new Set(DEFAULT_ALLOWED_TAGS);
		(allowed as Set<string>).add('img');
		const { html: imgKept } = cleanHtmlForLLM(input, domAdapter, {
			dropMedia: false,
			allowedTags: allowed,
		});
		expect(imgKept).toBe('<p>Intro</p><img src="/img.jpg">');

		const { html: noImgBecauseNoSrc } = cleanHtmlForLLM('<img alt="x">', domAdapter, {
			allowedTags: allowed,
			dropMedia: false,
		});
		expect(
			new DOMParser().parseFromString(`<w>${noImgBecauseNoSrc}</w>`, 'text/html').querySelector('img'),
		).toBeNull();
	});

	it('textLength approximates visible text length', () => {
		const input = wrapInHtml('<h1>Title</h1><p>Alpha <strong>beta</strong> gamma.</p>');
		const { html, textLength } = cleanHtmlForLLM(input, domAdapter);
		const text = normalizeForAssert(html);
		expect(textLength).approximately(text.length, textLength * 0.1);
	});

	it('stats reflect removals/unwrappings', () => {
		const input = wrapInHtml(`
			<div class="wrap">\n
				<script>var x=1</script>
				<style>.x{}</style>
				<p id="p">Hello</p>
			</div>`);
		const { stats, html } = cleanHtmlForLLM(input, domAdapter);
		expect(stats.removedNodes).toBeGreaterThanOrEqual(2); // script + style
		expect(stats.unwrappedNodes).toBeGreaterThanOrEqual(1); // outer div
		expect(stats.removedAttrs).toBeGreaterThanOrEqual(1); // id/class
		expect(normalizeForAssert(html)).toBe('Hello');
	});

	it('handles deeply nested wrappers and preserves core content', () => {
		const input = wrapInHtml('<div><div><section><article><p>Keep me</p></article></section></div></div>');
		const { html } = cleanHtmlForLLM(input, domAdapter);
		expect(hasTag(html, 'p')).toBe(true);
		expect(/<div|<section|<article/i.test(html)).toBe(false);
		expect(normalizeForAssert(html)).toBe('Keep me');
	});

	it('<br> is preserved as explicit break', () => {
		const input = wrapInHtml('<p>Line 1<br>Line 2</p>');
		const { html } = cleanHtmlForLLM(input, domAdapter);
		// Should still contain a <br> representing the explicit break
		expect(/<br>/i.test(html)).toBe(true);
		expect(normalizeForAssert(html)).toBe('Line 1 Line 2');
	});
});
