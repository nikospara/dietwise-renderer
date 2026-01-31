/**
 * Prefer selecting `<body>` via `querySelector` to avoid a linkedom quirk:
 * accessing `document.body` can create/overwrite an empty body for some inputs.
 * If no body exists, fall back to document.body or documentElement.
 */
export function getBodyElement(doc: Document): Element {
	const fallback = doc.querySelector('body');
	if (fallback) return fallback;
	return doc.body ?? doc.documentElement;
}
