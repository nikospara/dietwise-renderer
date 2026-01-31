import { getBodyElement } from './getBodyElement.js';

const CONSENT_SELECTORS = [
	// OneTrust
	'#onetrust-banner-sdk',
	'#onetrust-consent-sdk',
	'.ot-sdk-container',
	'.otFloatingRoundedCorner',
	// Didomi
	'#didomi-host',
	'.didomi-popup',
	'.didomi-notice',
	// Quantcast
	'.qc-cmp2-container',
	'#qc-cmp2-ui',
	'.qc-cmp2-main',
	// Cookiebot
	'#CybotCookiebotDialog',
	'#CookiebotWidget',
	// Iubenda
	'.iubenda-cs-container',
	'.iubenda-cs-overlay',
	'[class*="iubenda" i]',
	// Osano / generic
	'[class*="osano" i]',
	'[id*="osano" i]',
	'[class*="cookie-consent" i]',
	'[class*="cookiebanner" i]',
	'[class*="cookie-banner" i]',
	'[class*="cookie-notice" i]',
	'[id*="cookie" i][id*="banner" i]',
	'[class*="gdpr" i]',
	'[class*="consent" i]',
	'[id*="consent" i]',
	// Generic modals/overlays often used
	'[role="dialog"]',
	'[aria-modal="true"]',
];

const CONSENT_TEXT_RE =
	/(cookie|cookies|consent|gdpr|tcf|iab|legitimate interest|vendor|vendors|purposes|preferences|privacy policy|personal data)/i;

function elementText(el: Element): string {
	return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function scoreConsent(el: Element): number {
	const t = elementText(el).toLowerCase();
	let s = 0;
	if (t.includes('cookie')) s += 3;
	if (t.includes('consent')) s += 2;
	if (t.includes('preferences') || t.includes('settings') || t.includes('manage')) s += 2;
	if (t.includes('vendors') || t.includes('purposes')) s += 2;
	if (t.includes('iab') || t.includes('tcf') || t.includes('legitimate interest')) s += 2;
	if (t.includes('privacy policy') || t.includes('privacy')) s += 1;
	if (t.includes('accept') || t.includes('reject')) s += 1;
	return s;
}

/**
 * Remove cookie/consent UI nodes from a DOM before running cleanHtmlForLLM.
 */
export function removeConsentUI(doc: Document): number {
	const body = getBodyElement(doc);

	const candidates = new Set<Element>();
	for (const sel of CONSENT_SELECTORS) {
		body.querySelectorAll(sel).forEach((el) => candidates.add(el));
	}

	let removed = 0;

	// Remove high-confidence vendor elements directly
	for (const el of Array.from(candidates)) {
		const idc = `${(el as HTMLElement).id || ''} ${(el as HTMLElement).className || ''}`.toLowerCase();
		const vendorHit =
			idc.includes('onetrust') ||
			idc.includes('didomi') ||
			idc.includes('qc-cmp') ||
			idc.includes('cookiebot') ||
			idc.includes('iubenda') ||
			idc.includes('osano');

		const txt = elementText(el);
		const looksConsent = vendorHit || CONSENT_TEXT_RE.test(txt) || scoreConsent(el) >= 5;

		if (looksConsent) {
			el.remove();
			removed++;
		}
	}

	// Also remove typical full-page overlays/backdrops if present
	body.querySelectorAll('[class*="overlay" i], [class*="backdrop" i], [id*="overlay" i], [id*="backdrop" i]').forEach(
		(el) => {
			// remove only if it has consent-ish text nearby or contains none (pure backdrop)
			const t = elementText(el);
			if (!t || CONSENT_TEXT_RE.test(t)) {
				el.remove();
				removed++;
			}
		},
	);

	return removed;
}
