#!/bin/sh
# Baixa (uma vez, no build) os assets do Swagger UI e ReDoc para servi-los localmente, sem CDN em runtime.
set -eu
DEST="$(dirname "$0")/../app/static/vendor"
SWAGGER="${SWAGGER_VERSION:-5.17.14}"
REDOC="${REDOC_VERSION:-2.1.5}"
mkdir -p "$DEST"
fetch() { [ -s "$DEST/$2" ] || curl -fsSL "$1" -o "$DEST/$2"; }
fetch "https://cdn.jsdelivr.net/npm/swagger-ui-dist@$SWAGGER/swagger-ui-bundle.js" swagger-ui-bundle.js
fetch "https://cdn.jsdelivr.net/npm/swagger-ui-dist@$SWAGGER/swagger-ui.css" swagger-ui.css
fetch "https://cdn.jsdelivr.net/npm/redoc@$REDOC/bundles/redoc.standalone.js" redoc.standalone.js
echo "assets em $DEST"
