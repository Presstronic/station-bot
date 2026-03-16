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
KEY_SIZE=4096

if ! command -v openssl &>/dev/null; then
  echo "Error: openssl is not installed." >&2
  exit 1
fi

mkdir -p "$CERTS_DIR"

# Initialize temp file vars before the trap so the trap never references
# an unset variable if the script exits before they are assigned (set -u).
CA_CNF=""
SERVER_CSR_CNF=""
SERVER_EXT_CNF=""
trap 'rm -f "$CA_CNF" "$SERVER_CSR_CNF" "$SERVER_EXT_CNF"' EXIT

# ---------------------------------------------------------------------------
# 1. CA — explicit basicConstraints and keyUsage so the cert is a valid CA
#    across all OpenSSL configurations. RSA 4096 + SHA-256 explicitly set.
# ---------------------------------------------------------------------------
CA_CNF=$(mktemp)
cat > "$CA_CNF" << 'CONF'
[req]
distinguished_name = dn
x509_extensions    = v3_ca
prompt             = no

[dn]
CN = station-bot-ca

[v3_ca]
basicConstraints       = critical,CA:TRUE
keyUsage               = critical,keyCertSign,cRLSign
subjectKeyIdentifier   = hash
CONF

echo "Generating CA key and certificate (RSA ${KEY_SIZE})..."
openssl req -new -x509 \
  -days    "$DAYS" \
  -newkey  "rsa:${KEY_SIZE}" \
  -nodes \
  -sha256 \
  -out     "$CERTS_DIR/ca.crt" \
  -keyout  "$CERTS_DIR/ca.key" \
  -config  "$CA_CNF"

# ---------------------------------------------------------------------------
# 2. Server cert — includes SAN DNS:postgres so TLS clients that require SANs
#    (rejectUnauthorized=true) accept the certificate when connecting to the
#    "postgres" hostname used in DATABASE_URL. RSA 4096 + SHA-256 explicitly set.
# ---------------------------------------------------------------------------
SERVER_CSR_CNF=$(mktemp)
cat > "$SERVER_CSR_CNF" << 'CONF'
[req]
distinguished_name = dn
prompt             = no

[dn]
CN = postgres
CONF

SERVER_EXT_CNF=$(mktemp)
cat > "$SERVER_EXT_CNF" << 'CONF'
[v3_server]
basicConstraints       = CA:FALSE
keyUsage               = critical,digitalSignature,keyEncipherment
extendedKeyUsage       = serverAuth
subjectAltName         = DNS:postgres
CONF

echo "Generating Postgres server key and CSR (RSA ${KEY_SIZE})..."
openssl req -new \
  -newkey  "rsa:${KEY_SIZE}" \
  -nodes \
  -out    "$CERTS_DIR/server.csr" \
  -keyout "$CERTS_DIR/server.key" \
  -config "$SERVER_CSR_CNF"

echo "Signing server certificate with CA..."
openssl x509 -req \
  -days       "$DAYS" \
  -sha256 \
  -in         "$CERTS_DIR/server.csr" \
  -CA         "$CERTS_DIR/ca.crt" \
  -CAkey      "$CERTS_DIR/ca.key" \
  -CAserial   "$CERTS_DIR/ca.srl" \
  -CAcreateserial \
  -out        "$CERTS_DIR/server.crt" \
  -extensions v3_server \
  -extfile    "$SERVER_EXT_CNF"

rm "$CERTS_DIR/server.csr"

chmod 600 "$CERTS_DIR/ca.key" "$CERTS_DIR/ca.srl"
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
printf '  sudo chown 70:70 "%s/server.key"\n' "$CERTS_DIR"
printf '  sudo chmod 600  "%s/server.key"\n' "$CERTS_DIR"
echo ""
echo "Then start the stack with SSL enabled:"
echo "  docker compose -f docker-compose.prod.yml -f docker-compose.ssl.yml up -d"
