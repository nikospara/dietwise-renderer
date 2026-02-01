// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { extractJsonLdRecipesFromString } from './extractJsonLdRecipes.js';
import { nodeDomAdapter } from './nodeDomAdapter.js';

function wrapJsonLd(json: unknown, type = 'application/ld+json'): string {
	return `<!doctype html><html><head></head><body><script type="${type}">${JSON.stringify(
		json,
	)}</script></body></html>`;
}

describe('extractJsonLdRecipes', () => {
	it('finds recipe in application/ld+json with parameters and nested mainEntity', () => {
		const json = {
			'@context': 'https://schema.org',
			'@type': 'WebPage',
			mainEntity: {
				'@type': 'Recipe',
				name: 'Nested Recipe',
				recipeIngredient: ['1 egg'],
				recipeInstructions: ['Whisk'],
			},
		};
		const html = wrapJsonLd(json, 'application/ld+json; charset=utf-8');
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]?.name).toBe('Nested Recipe');
	});

	it('walks recipeIngredient objects and converts them to strings', () => {
		const json = {
			'@context': 'https://schema.org',
			'@type': 'Recipe',
			name: 'Ingredient Variants',
			recipeIngredient: [
				{ '@type': 'Role', recipeIngredient: '2 eggs' },
				{ '@type': 'HowToSupply', name: '1 cup flour' },
				{ '@id': 'urn:ing:salt' },
			],
			recipeInstructions: ['Mix'],
		};
		const html = wrapJsonLd(json);
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]?.recipeIngredients).toEqual(['2 eggs', '1 cup flour', 'urn:ing:salt']);
	});

	it('handles recipeInstructions ItemList without an explicit @type', () => {
		const json = {
			'@context': 'https://schema.org',
			'@type': 'Recipe',
			name: 'No ItemList Type',
			recipeIngredient: ['1 egg'],
			recipeInstructions: {
				itemListElement: [{ '@type': 'HowToStep', text: 'Step one' }, { text: 'Step two' }],
			},
		};
		const html = wrapJsonLd(json);
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]?.recipeInstructions).toEqual(['Step one', 'Step two']);
	});

	it('extracts nested recipes from hasPart and subjectOf', () => {
		const json = {
			'@context': 'https://schema.org',
			'@type': 'WebPage',
			hasPart: {
				'@type': 'Recipe',
				name: 'Part Recipe',
				recipeIngredient: ['1 cup sugar'],
				recipeInstructions: ['Combine'],
			},
			subjectOf: [
				{
					'@type': 'Recipe',
					name: 'Subject Recipe',
					recipeIngredient: ['2 cups flour'],
					recipeInstructions: ['Bake'],
				},
			],
		};
		const html = wrapJsonLd(json);
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(2);
		expect(recipes.map((recipe) => recipe.name).sort()).toEqual(['Part Recipe', 'Subject Recipe']);
	});

	it('accepts schema.org context variants', () => {
		const json = {
			'@context': ['http://schema.org', { '@vocab': 'https://schema.org/' }],
			'@type': 'Recipe',
			name: 'Variant Context Recipe',
			recipeIngredient: ['1 egg'],
			recipeInstructions: ['Cook'],
		};
		const html = wrapJsonLd(json);
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]?.name).toBe('Variant Context Recipe');
	});

	it('handles top-level JSON-LD arrays with context objects', () => {
		const json = [
			{ '@context': 'https://schema.org' },
			{
				'@type': 'Recipe',
				name: 'Array Recipe',
				recipeIngredient: ['1 egg'],
				recipeInstructions: ['Cook'],
			},
		];
		const html = wrapJsonLd(json);
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]?.name).toBe('Array Recipe');
	});

	it('inherits schema.org context for @graph children', () => {
		const json = {
			'@context': 'https://schema.org',
			'@graph': [
				{
					'@type': 'Recipe',
					'@id': 'urn:recipe:graph',
					name: 'Graph Recipe',
					recipeIngredient: ['1 egg'],
					recipeInstructions: ['Cook'],
				},
			],
		};
		const html = wrapJsonLd(json);
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]?.name).toBe('Graph Recipe');
	});

	it('uses legacy ingredients when recipeIngredient is missing', () => {
		const json = {
			'@context': 'https://schema.org',
			'@type': 'Recipe',
			name: 'Legacy Ingredients',
			ingredients: ['1 cup sugar'],
			recipeInstructions: ['Mix'],
		};
		const html = wrapJsonLd(json);
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]?.recipeIngredients).toEqual(['1 cup sugar']);
	});

	it('handles ItemList with a single itemListElement object', () => {
		const json = {
			'@context': 'https://schema.org',
			'@type': 'Recipe',
			name: 'Single ItemList Element',
			recipeIngredient: ['1 egg'],
			recipeInstructions: {
				'@type': 'ItemList',
				itemListElement: { '@type': 'HowToStep', text: 'Do the thing' },
			},
		};
		const html = wrapJsonLd(json);
		const recipes = extractJsonLdRecipesFromString(html, nodeDomAdapter);
		expect(recipes).toHaveLength(1);
		expect(recipes[0]?.recipeInstructions).toEqual(['Do the thing']);
	});
});
