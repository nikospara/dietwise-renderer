/**
 * cleanHtmlForLLM.ts — Aggressive, deterministic HTML minimizer for LLM ingestion
 *
 * Goals (no heuristics about “is it a recipe”):
 *  - Remove all attributes except <a href> (sanitized) and <img src> (sanitized).
 *  - If <img> is not allowed (default), remove it. If allowed but has no valid src, remove it.
 *  - If <a> has no valid href after sanitization, unwrap it (keep its text).
 *  - Remove elements that contain no text (after trim) — except <img> with valid src.
 *  - Unwrap non-whitelisted elements (keep their children) — never unwrap <html>/<body>.
 *  - Join consecutive whitespace while preserving block boundaries.
 *  - Keep only a tight whitelist of tags.
 *
 * Usage: `const { html } = cleanHtmlForLLM(rawHtml);`
 * The resulting `html` is tiny, readable, and ready to ship to the server/LLM.
 */

export interface CleanOptions {
	/** Allowed tags that will be preserved; all others are unwrapped (children kept). */
	allowedTags: Set<string>;
	/** Drop media elements upfront (img/video/audio/figure). Default true. */
	dropMedia: boolean;
	/** Keep only http/https links for <a href> and <img src>; unwrap/remove otherwise. */
	strictUrls: boolean;
	/** If true, preserve a minimal table set (table, thead, tbody, tr, th, td). */
	keepTables: boolean;
	/** Maximum depth to process to avoid pathological DOMs. */
	maxDepth: number;
}

export interface DomAdapter {
	parse(html: string): Document;
}

export const DEFAULT_ALLOWED_TAGS: ReadonlySet<string> = new Set([
	// Headings & paragraphs
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'p',
	// Lists (critical for ingredients/instructions)
	'ul',
	'ol',
	'li',
	// Emphasis
	'strong',
	'em',
	'b',
	'i',
	'u',
	'sup',
	'sub',
	// Line breaks & time
	'br',
	'time',
	// Links (href sanitized below)
	'a',
]);

// eslint-disable-next-line prettier/prettier
export const TABLE_TAGS = [
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
	'caption',
	'colgroup',
	'col',
] as const;

export interface PageCleaningResult {
	html: string;
	textLength: number;
	stats: Record<string, number>;
}

/** Adapter so this can parse HTML in browser or server. */
export interface HtmlToDocumentAdapter {
	parse(html: string): Document;
}

export function cleanHtmlForLLM(
	html: string,
	options?: Partial<CleanOptions>,
	adapter: HtmlToDocumentAdapter,
): PageCleaningResult {
	const doc = adapter.parse(html);
	return cleanDocumentForLLM(doc, options);
}

export function cleanDocumentForLLM(doc: Document, options?: Partial<CleanOptions>): PageCleaningResult {
	const opts: CleanOptions = {
		allowedTags: new Set(DEFAULT_ALLOWED_TAGS),
		dropMedia: true,
		strictUrls: true,
		keepTables: false,
		maxDepth: 2000,
		...options,
	};
	if (opts.keepTables) TABLE_TAGS.forEach((t) => opts.allowedTags.add(t));

	const body = doc.body;
	const stats: Record<string, number> = {
		removedNodes: 0,
		unwrappedNodes: 0,
		removedAttrs: 0,
		strippedLinks: 0,
		emptyNodes: 0,
		removedComments: 0,
	};

	// Never unwrap these
	(opts.allowedTags as Set<string>).add('html');
	(opts.allowedTags as Set<string>).add('body');

	// 0) Remove comments (portable, no TreeWalker)
	stats.removedComments += removeComments(body);

	// 1) Drop obvious noise (selectors are fine across jsdom/linkedom/browsers)
	body.querySelectorAll(
		'script, style, noscript, template, iframe, frame, frameset, object, embed, form, input, textarea, select, button, svg, canvas, picture, source, meta, link, header, footer, nav, aside, share, ads, [aria-hidden="true"]',
	).forEach((n) => {
		n.remove();
		stats.removedNodes++;
	});

	if (opts.dropMedia) {
		body.querySelectorAll('img, video, audio, figure').forEach((n) => {
			n.remove();
			stats.removedNodes++;
		});
	} else {
		// If media kept, still remove video/audio/figure (unless explicitly allowed via allowedTags)
		body.querySelectorAll('video, audio, figure').forEach((n) => {
			if (!opts.allowedTags.has(n.tagName.toLowerCase())) {
				n.remove();
				stats.removedNodes++;
			}
		});
	}

	// 2) Unwrap all non-whitelisted elements (keep their children); add table separators if keepTables=false
	const unwrapIfNeeded = (el: Element): Node[] | null => {
		const tag = el.tagName.toLowerCase();
		// Never unwrap <html> or <body>; doing so detaches the tree we serialize later
		if (el === doc.documentElement || el === body) return null;
		if (opts.allowedTags.has(tag)) return null;
		// Replace the element with its children
		const parent = el.parentNode;
		if (!parent) return null;
		// Add separators when removing table structure
		if (!opts.keepTables) {
			if (tag === 'tr') {
				// newline between rows
				parent.insertBefore(doc.createTextNode('\n'), el.nextSibling);
			} else if (tag === 'td' || tag === 'th') {
				// space between cells
				parent.insertBefore(doc.createTextNode(' '), el.nextSibling);
			}
		}
		const moved: Node[] = [];
		while (el.firstChild) {
			const child = el.firstChild;
			moved.push(child);
			parent.insertBefore(child, el);
		}
		el.remove();
		stats.unwrappedNodes++;
		return moved;
	};

	// Tree walk breadth-first with a depth guard to strip attributes
	const queue: Node[] = [body];
	let processed = 0;
	while (queue.length && processed++ < opts.maxDepth) {
		const node = queue.shift()!;
		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			const moved = unwrapIfNeeded(el);
			if (moved) {
				for (const child of moved) queue.push(child);
				continue; // el is gone
			}

			const tag = el.tagName.toLowerCase();

			// 3) Remove attributes, with special cases for <a> and <img>
			let keptHref = false;
			let keptSrc = false;
			for (const attr of Array.from(el.attributes)) {
				const name = attr.name.toLowerCase();
				if (tag === 'a' && name === 'href') {
					const safe = sanitizeUrl(attr.value, opts.strictUrls);
					if (safe) {
						el.setAttribute('href', safe);
						keptHref = true;
					} else {
						keptHref = false;
					}
					continue;
				}
				if (tag === 'img' && name === 'src') {
					if (!opts.allowedTags.has('img')) {
						el.remove();
						stats.removedNodes++;
						break;
					}
					const safe = sanitizeUrl(attr.value, opts.strictUrls);
					if (safe) {
						el.setAttribute('src', safe);
						keptSrc = true;
					} else {
						keptSrc = false;
					}
					continue;
				}
				el.removeAttribute(name);
				stats.removedAttrs++;
			}

			// Post-attr enforcement per rules
			if (tag === 'a' && !keptHref) {
				// unwrap <a> but keep its children/text
				const parent = el.parentNode;
				if (parent) {
					while (el.firstChild) {
						parent.insertBefore(el.firstChild, el);
					}
					el.remove();
					stats.strippedLinks++;
					continue; // element gone
				}
			}
			if (tag === 'img') {
				if (!opts.allowedTags.has('img') || !keptSrc) {
					el.remove();
					stats.removedNodes++;
					continue;
				}
			}

			// Queue children after attr processing
			for (const child of Array.from(el.childNodes)) queue.push(child);
		}
	}

	// 4) Remove elements that are empty (no text) — except <img> with valid src
	// Keep <li> if it contains any text OR nested inline text after cleanup.
	const isMeaningful = (el: Element): boolean => {
		const tag = el.tagName.toLowerCase();
		if (tag === 'br') return true;
		if (tag === 'ul' || tag === 'ol') {
			return el.querySelectorAll('li').length > 0;
		}
		if (tag === 'img') {
			return opts.allowedTags.has('img') && !!el.getAttribute('src');
		}
		const txt = el.textContent?.replace(/[\u200B\u200C\u200D]/g, '').trim() || '';
		return txt.length > 0;
	};

	// Post-order traversal to safely remove
	const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
	const stack: Element[] = [];
	while (walker.nextNode()) stack.push(walker.currentNode as Element);
	for (let i = stack.length - 1; i >= 0; i--) {
		const el = stack[i];
		if (!opts.allowedTags.has(el.tagName.toLowerCase())) continue; // non-whitelisted already unwrapped
		if (!isMeaningful(el)) {
			el.remove();
			stats.emptyNodes++;
		}
	}

	// 4a) Remove comments
	const commentsWalker = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
	const commentNodes: Comment[] = [];
	while (commentsWalker.nextNode()) {
		commentNodes.push(commentsWalker.currentNode as Comment);
	}
	for (const c of commentNodes) {
		c.parentNode?.removeChild(c);
	}

	// 5) Whitespace normalization
	// Convert <br> to newline tokens to help later collapse, then restore
	body.querySelectorAll('br').forEach((br) =>
		br.replaceWith(doc.createTextNode('\n')),
	);

	// Insert newlines around block-level tags so collapsing whitespace keeps structure
	const blockTags = [
		'p',
		'ul',
		'ol',
		'li',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'table',
		'thead',
		'tbody',
		'tr',
		'th',
		'td',
		'div',
	];
	for (const tag of blockTags) {
		body.querySelectorAll(tag).forEach((el) => {
			if (el.firstChild && el.firstChild.nodeType !== Node.TEXT_NODE) {
				el.insertBefore(doc.createTextNode('\n'), el.firstChild);
			}
			if (el.lastChild && el.lastChild.nodeType !== Node.TEXT_NODE) {
				el.appendChild(doc.createTextNode('\n'));
			}
		});
	}

	// Serialize to text and collapse whitespace globally
	let out = body.innerHTML
		.replace(/\n\s*/g, '\n') // trim space at line starts
		.replace(/[\t\r ]+/g, ' ') // collapse spaces/tabs
		.replace(/\n{2,}/g, '\n') // collapse blank lines
		.trim();

	// Restore <br> for explicit breaks in lists/paragraphs (optional). Keep HTML minimal.
	// If you prefer pure text, skip this restore.
	out = out.replace(/\n/g, '<br>');

	// 6) Final pass: remove accidental empty wrappers again
	out = out
		.replace(/<(ul|ol)>\s*<\/(ul|ol)>/g, '')
		.replace(/<li>\s*<\/li>/g, '')
		.replace(/<p>\s*<\/p>/g, '')
		.replace(/<h[1-6]>\s*<\/h[1-6]>/g, '');

	// Cosmetic: ensure list items are on their own lines
	out = out.replace(/<li>/g, '\n<li>').trim();

	return { html: out, textLength: textLength(out), stats };
}

function sanitizeUrl(raw: string, strict: boolean): string | null {
	const val = (raw || '').trim();
	try {
		const u = new URL(val, 'https://example.invalid');
		const scheme = u.protocol.replace(':', '');
		if (!strict) return u.href.replace('https://example.invalid', '');
		if (scheme === 'http' || scheme === 'https') {
			return u.href.replace('https://example.invalid', '');
		}
		// allow relative
		if (u.origin === 'https://example.invalid') {
			return u.href.replace('https://example.invalid', '');
		}
		return null;
	} catch {
		// Bare relatives
		if (!strict && /^\/?[\w#/?=&.+%-]+$/.test(val)) return val;
		if (/^\/?[\w#/?=&.+%-]+$/.test(val)) return val;
		return null;
	}
}

function textLength(html: string): number {
	// Rough text length ignoring tags
	return html
		.replace(/<[^>]+>/g, '')
		.replace(/[\s\u200B\u200C\u200D]+/g, ' ')
		.trim().length;
}

// Convenience: minimal whitelist tailored for recipe pages
export const RECIPE_MINIMAL_TAGS = new Set<string>([
	'h1',
	'h2',
	'h3',
	'p',
	'ul',
	'ol',
	'li',
	'a',
	'strong',
	'em',
	'br',
	'time',
]);

// Example convenience wrapper
export function cleanHtmlMinimal(html: string): PageCleaningResult {
	return cleanHtmlForLLM(html, {
		allowedTags: new Set(RECIPE_MINIMAL_TAGS),
		keepTables: false,
		dropMedia: true,
	});
}
