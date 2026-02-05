#!/bin/bash
#
# OpsMap PKI - Certificate Generation Script
#
# This script generates a complete PKI hierarchy for OpsMap:
# - Root CA (should be kept offline in production)
# - Backend CA and certificates
# - Gateway CA and certificates
# - Agent CA and certificates
#
# Usage: ./generate-certs.sh [output_dir] [domain]
#

set -euo pipefail

OUTPUT_DIR="${1:-./certs}"
DOMAIN="${2:-opsmap.local}"
VALIDITY_DAYS="${3:-365}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create output directories
mkdir -p "${OUTPUT_DIR}"/{root-ca,backend,gateway,agent}

# Generate Root CA
generate_root_ca() {
    log_info "Generating Root CA..."

    # Generate Root CA private key
    openssl genrsa -out "${OUTPUT_DIR}/root-ca/root-ca.key" 4096

    # Generate Root CA certificate
    openssl req -x509 -new -nodes \
        -key "${OUTPUT_DIR}/root-ca/root-ca.key" \
        -sha256 -days $((VALIDITY_DAYS * 10)) \
        -out "${OUTPUT_DIR}/root-ca/root-ca.crt" \
        -subj "/C=US/ST=State/L=City/O=OpsMap/OU=PKI/CN=OpsMap Root CA"

    log_info "Root CA generated: ${OUTPUT_DIR}/root-ca/root-ca.crt"
}

# Generate intermediate CA
generate_intermediate_ca() {
    local name=$1
    local cn=$2

    log_info "Generating ${name} CA..."

    # Generate private key
    openssl genrsa -out "${OUTPUT_DIR}/${name}/${name}-ca.key" 4096

    # Generate CSR
    openssl req -new \
        -key "${OUTPUT_DIR}/${name}/${name}-ca.key" \
        -out "${OUTPUT_DIR}/${name}/${name}-ca.csr" \
        -subj "/C=US/ST=State/L=City/O=OpsMap/OU=${name}/CN=${cn}"

    # Sign with Root CA
    cat > "${OUTPUT_DIR}/${name}/${name}-ca.ext" << EOF
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always, issuer
EOF

    openssl x509 -req \
        -in "${OUTPUT_DIR}/${name}/${name}-ca.csr" \
        -CA "${OUTPUT_DIR}/root-ca/root-ca.crt" \
        -CAkey "${OUTPUT_DIR}/root-ca/root-ca.key" \
        -CAcreateserial \
        -out "${OUTPUT_DIR}/${name}/${name}-ca.crt" \
        -days $((VALIDITY_DAYS * 5)) \
        -sha256 \
        -extfile "${OUTPUT_DIR}/${name}/${name}-ca.ext"

    # Create CA chain
    cat "${OUTPUT_DIR}/${name}/${name}-ca.crt" "${OUTPUT_DIR}/root-ca/root-ca.crt" > "${OUTPUT_DIR}/${name}/ca-chain.crt"

    rm "${OUTPUT_DIR}/${name}/${name}-ca.csr" "${OUTPUT_DIR}/${name}/${name}-ca.ext"

    log_info "${name} CA generated: ${OUTPUT_DIR}/${name}/${name}-ca.crt"
}

# Generate server certificate
generate_server_cert() {
    local ca_name=$1
    local cert_name=$2
    local cn=$3
    local san=$4

    log_info "Generating ${cert_name} certificate..."

    # Generate private key
    openssl genrsa -out "${OUTPUT_DIR}/${ca_name}/${cert_name}.key" 2048

    # Generate CSR
    openssl req -new \
        -key "${OUTPUT_DIR}/${ca_name}/${cert_name}.key" \
        -out "${OUTPUT_DIR}/${ca_name}/${cert_name}.csr" \
        -subj "/C=US/ST=State/L=City/O=OpsMap/OU=${ca_name}/CN=${cn}"

    # Create extensions file
    cat > "${OUTPUT_DIR}/${ca_name}/${cert_name}.ext" << EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer
subjectAltName = ${san}
EOF

    # Sign with intermediate CA
    openssl x509 -req \
        -in "${OUTPUT_DIR}/${ca_name}/${cert_name}.csr" \
        -CA "${OUTPUT_DIR}/${ca_name}/${ca_name}-ca.crt" \
        -CAkey "${OUTPUT_DIR}/${ca_name}/${ca_name}-ca.key" \
        -CAcreateserial \
        -out "${OUTPUT_DIR}/${ca_name}/${cert_name}.crt" \
        -days ${VALIDITY_DAYS} \
        -sha256 \
        -extfile "${OUTPUT_DIR}/${ca_name}/${cert_name}.ext"

    # Create full chain
    cat "${OUTPUT_DIR}/${ca_name}/${cert_name}.crt" "${OUTPUT_DIR}/${ca_name}/ca-chain.crt" > "${OUTPUT_DIR}/${ca_name}/${cert_name}-fullchain.crt"

    rm "${OUTPUT_DIR}/${ca_name}/${cert_name}.csr" "${OUTPUT_DIR}/${ca_name}/${cert_name}.ext"

    log_info "${cert_name} certificate generated: ${OUTPUT_DIR}/${ca_name}/${cert_name}.crt"
}

# Generate client certificate (for agents)
generate_client_cert() {
    local ca_name=$1
    local cert_name=$2
    local cn=$3

    log_info "Generating ${cert_name} client certificate..."

    # Generate private key
    openssl genrsa -out "${OUTPUT_DIR}/${ca_name}/${cert_name}.key" 2048

    # Generate CSR
    openssl req -new \
        -key "${OUTPUT_DIR}/${ca_name}/${cert_name}.key" \
        -out "${OUTPUT_DIR}/${ca_name}/${cert_name}.csr" \
        -subj "/C=US/ST=State/L=City/O=OpsMap/OU=${ca_name}/CN=${cn}"

    # Create extensions file
    cat > "${OUTPUT_DIR}/${ca_name}/${cert_name}.ext" << EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer
EOF

    # Sign with intermediate CA
    openssl x509 -req \
        -in "${OUTPUT_DIR}/${ca_name}/${cert_name}.csr" \
        -CA "${OUTPUT_DIR}/${ca_name}/${ca_name}-ca.crt" \
        -CAkey "${OUTPUT_DIR}/${ca_name}/${ca_name}-ca.key" \
        -CAcreateserial \
        -out "${OUTPUT_DIR}/${ca_name}/${cert_name}.crt" \
        -days ${VALIDITY_DAYS} \
        -sha256 \
        -extfile "${OUTPUT_DIR}/${ca_name}/${cert_name}.ext"

    rm "${OUTPUT_DIR}/${ca_name}/${cert_name}.csr" "${OUTPUT_DIR}/${ca_name}/${cert_name}.ext"

    log_info "${cert_name} client certificate generated: ${OUTPUT_DIR}/${ca_name}/${cert_name}.crt"
}

# Main execution
main() {
    log_info "OpsMap PKI Generator"
    log_info "===================="
    log_info "Output directory: ${OUTPUT_DIR}"
    log_info "Domain: ${DOMAIN}"
    log_info "Validity: ${VALIDITY_DAYS} days"
    echo ""

    # Generate Root CA
    generate_root_ca

    # Generate Intermediate CAs
    generate_intermediate_ca "backend" "OpsMap Backend CA"
    generate_intermediate_ca "gateway" "OpsMap Gateway CA"
    generate_intermediate_ca "agent" "OpsMap Agent CA"

    # Generate Backend certificate
    generate_server_cert "backend" "backend" "backend.${DOMAIN}" \
        "DNS:backend.${DOMAIN},DNS:localhost,IP:127.0.0.1"

    # Generate Gateway certificates (multiple gateways per zone)
    generate_server_cert "gateway" "gateway-1" "gateway-1.${DOMAIN}" \
        "DNS:gateway-1.${DOMAIN},DNS:gateway.${DOMAIN},DNS:localhost,IP:127.0.0.1"

    # Generate sample Agent certificate
    generate_client_cert "agent" "agent-sample" "agent-sample.${DOMAIN}"

    # Copy Root CA to all directories for convenience
    cp "${OUTPUT_DIR}/root-ca/root-ca.crt" "${OUTPUT_DIR}/backend/ca.crt"
    cp "${OUTPUT_DIR}/root-ca/root-ca.crt" "${OUTPUT_DIR}/gateway/ca.crt"
    cp "${OUTPUT_DIR}/root-ca/root-ca.crt" "${OUTPUT_DIR}/agent/ca.crt"

    # Create combined CA bundle for cross-verification
    cat "${OUTPUT_DIR}/backend/backend-ca.crt" \
        "${OUTPUT_DIR}/gateway/gateway-ca.crt" \
        "${OUTPUT_DIR}/agent/agent-ca.crt" \
        "${OUTPUT_DIR}/root-ca/root-ca.crt" > "${OUTPUT_DIR}/ca-bundle.crt"

    echo ""
    log_info "PKI generation complete!"
    echo ""
    log_info "Files generated:"
    echo "  Root CA:     ${OUTPUT_DIR}/root-ca/root-ca.crt"
    echo "  Backend:     ${OUTPUT_DIR}/backend/backend.crt"
    echo "  Gateway:     ${OUTPUT_DIR}/gateway/gateway-1.crt"
    echo "  Agent:       ${OUTPUT_DIR}/agent/agent-sample.crt"
    echo "  CA Bundle:   ${OUTPUT_DIR}/ca-bundle.crt"
    echo ""
    log_warn "Keep root-ca.key OFFLINE and secure in production!"
}

main "$@"
