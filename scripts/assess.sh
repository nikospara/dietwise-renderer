#!/bin/bash

# Assess a recipe from the test data (i.e. work locally and do not contact the site).
# Usage: ./scripts/assess.sh 004.html
# The DietWise backend must be running. Node & jq must be in the PATH.

function postprocess() {
	if [ "$1" = "text" ]; then
		jq -r "if .type == \"RECIPES\" then .recipes[].recipe.text elif .type == \"SUGGESTIONS\" then (\"\",\"Suggestions:\",\"------------\",.suggestions[].text) else (\"\",\"Errors:\",\"-------\",.errors[]) end"
	elif [ "$1" = "recipe" ]; then
		jq -r "if .type == \"RECIPES\" then .recipes[].recipe.text else \"\" end"
	elif [ "$1" = "ingredients" ]; then
		jq -r "if .type == \"RECIPES\" then .recipes[].recipe.recipeIngredients[] else \"\" end"
	else
		cat
	fi
}

tsx scripts/clean-html-for-llm.ts testdata/$1 --output-minimal-text | jq "{pageContent: .output} | . += {\"langCode\": \"en\", \"url\":\"x\"}" | curl -s --json @- http://localhost:8180/api/v1/recipe/assess/markdown \
| postprocess $2
