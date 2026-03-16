#!/usr/bin/env bash
# gen-certs.sh — generate a self-signed CA + Postgres server cert for station-bot
#
# Usage: bash scripts/gen-certs.sh
#
# Outputs (relative to repo root):
#   certs/ca.crt        CA certificate — mounted into the bot container
#   certs/ca.key        CA private key  — keep secure, not mounted into containers
#   certs/server.crt    Postgres server certificate
#   certs/server.key    Postgres server private key — requires special ownership (see below)
#
# After running this script you MUST fix the server.key ownership so Postgres accepts it:
#   sudo chown 70:70 certs/server.key   # uid 70 = postgres user in postgres:16-alpine
#   sudo chmod 600  certs/server.key

set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
DAYS=3650

if ! command -v openssl &>/dev/null; then
  echo "Error: openssl is not installed." >&2
  exit 1
fi

mkdir -p "$CERTS_DIR"

echo "Generating CA key and certificate..."
openssl req -new -x509 \
  -days "$DAYS" \
  -nodes \
  -out  "$CERTS_DIR/ca.crt" \
  -keyout "$CERTS_DIR/ca.key" \
  -subj "/CN=station-bot-ca"

echo "Generating Postgres server key and CSR..."
openssl req -new \
  -nodes \
  -out    "$CERTS_DIR/server.csr" \
  -keyout "$CERTS_DIR/server.key" \
  -subj "/CN=postgres"

echo "Signing server certificate with CA..."
openssl x509 -req \
  -days "$DAYS" \
  -in      "$CERTS_DIR/server.csr" \
  -CA      "$CERTS_DIR/ca.crt" \
  -CAkey   "$CERTS_DIR/ca.key" \
  -CAcreateserial \
  -out     "$CERTS_DIR/server.crt"

rm "$CERTS_DIR/server.csr"

chmod 600 "$CERTS_DIR/ca.key"
chmod 644 "$CERTS_DIR/ca.crt" "$CERTS_DIR/server.crt"
# server.key permissions are set here but must be re-applied after chown (see below)
chmod 600 "$CERTS_DIR/server.key"

echo ""
echo "Certificates written to $CERTS_DIR:"
ls -la "$CERTS_DIR"
echo ""
echo "IMPORTANT: Postgres requires server.key to be owned by its process user."
echo "Run the following on your Docker host before starting the stack:"
echo ""
echo "  sudo chown 70:70 $CERTS_DIR/server.key"
echo "  sudo chmod 600  $CERTS_DIR/server.key"
echo ""
echo "Then start the stack:"
echo "  docker compose -f docker-compose.prod.yml up -d"
