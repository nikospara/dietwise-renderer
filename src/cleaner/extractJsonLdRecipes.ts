import { CreativeWork, Graph, HowToStep, ItemList, Recipe as SchemaRecipe, Thing, WithContext } from 'schema-dts';
import type { HtmlToDocumentAdapter } from './HtmlToDocumentAdapter.js';

export interface Recipe {
	name?: string;
	recipeYield?: string;
	recipeIngredients: string[];
	recipeInstructions: string[]; // TODO Must reference ingedient
	text?: string;
}

type RecipeInstructions = SchemaRecipe['recipeInstructions'];
type ThingWithTextOrName = { text?: string; name?: string };

export function extractJsonLdRecipesFromString(html: string, adapter: HtmlToDocumentAdapter) {
	const doc = adapter.parse(html);
	return extractJsonLdRecipes(doc);
}

export function extractJsonLdRecipes(doc: Document): Recipe[] {
	const jsonLdRecipes = findJsonLdRecipes(doc);
	return jsonLdRecipes.map((r) => normalizeJsonLdRecipe(r));
}

function findJsonLdRecipes(doc: Document): SchemaRecipe[] {
	const blocks = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')) as HTMLScriptElement[];
	const recipes: SchemaRecipe[] = [];
	for (const block of blocks) {
		const text = block.textContent?.trim();
		if (!text) continue;
		try {
			const json = JSON.parse(text);
			addIfRecipe(json, recipes);
		} catch (_e) {
			// ignore parse errors
		}
	}
	return recipes;
}

function addIfRecipe(node: Graph | SchemaRecipe, recipes: SchemaRecipe[]) {
	if (!node || typeof node !== 'object') return;
	const context = (node as WithContext<Thing>)['@context'];
	if (typeof context === 'string' && context !== 'https://schema.org' && context !== 'https://schema.org/') return;
	const type = normalizeType((node as SchemaRecipe)['@type']);
	if (type.includes('Recipe')) recipes.push(node as SchemaRecipe);
	// Some sites nest Recipe inside @graph
	const graph = (node as Graph)['@graph'];
	if (Array.isArray(graph)) {
		for (const g of graph) {
			const t = normalizeType(g?.['@type']);
			if (t.includes('Recipe')) recipes.push(g);
		}
	}
	if (Array.isArray(node)) {
		for (const n of node) addIfRecipe(n, recipes);
	}
}

function normalizeType(t: unknown): string[] {
	if (!t) return [];
	if (Array.isArray(t)) return t.map((x) => String(x));
	return [String(t)];
}

function normalizeJsonLdRecipe(r: SchemaRecipe): Recipe {
	return {
		name: r.name?.toString(),
		recipeYield: r.recipeYield?.toString(),
		recipeIngredients: Array.isArray(r.recipeIngredient) ? r.recipeIngredient.map(cleanText) : [],
		recipeInstructions: flattenInstructions(r.recipeInstructions),
	};
}

function flattenInstructions(instructions: RecipeInstructions): string[] {
	const out: string[] = [];
	if (!instructions) return out;
	const push = (s: string) => {
		const t = cleanText(s);
		if (t.length > 0) out.push(t);
	};
	const walk = (node: RecipeInstructions | CreativeWork | ItemList | HowToStep) => {
		if (!node) return;
		if (typeof node === 'string') return push(node);
		if (Array.isArray(node)) return node.forEach(walk);
		const type = normalizeType((node as CreativeWork)['@type']);
		const itemListElement = (node as ItemList).itemListElement;
		if (type.includes('HowToSection') && Array.isArray(itemListElement)) {
			return itemListElement.forEach(walk);
		}
		const text = (node as HowToStep).text;
		if (typeof text === 'string') return push(text);
		const name = (node as CreativeWork).name;
		if (type.includes('HowToStep')) {
			if (name && itemListElement) {
				const section =
					String(name) +
					': ' +
					(Array.isArray(itemListElement)
						? itemListElement.map((x: ThingWithTextOrName) => x.text || x.name || '').join(' ')
						: String(itemListElement));
				return push(section);
			}
		}
		if (typeof name === 'string') return push(name);
	};
	walk(instructions);
	return out;
}

function cleanText(t: string): string {
	return t
		.replace(/[\u200B\u200C\u200D]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^[-–•\s]+/, '')
		.trim();
}
