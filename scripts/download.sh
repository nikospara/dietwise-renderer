#!/bin/bash

# Usage: ./scripts/download.sh <URL> > <OUTPUT FILE>
# The server should be running.
#
# Utilizes the server to download a URL and cache it; useful for creating a test dataset.

curl -s -X POST http://localhost:3000/render -d "{\"url\":\"$1\",\"simplify\":false}" -H "Content-Type: application/json" | jq -r .html
