#!/usr/bin/env bash
# ==============================================================================
# setup.sh — Automated Setup for Telegram Door Control Service
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOT_DIR="${PROJECT_ROOT}/bot"

echo "=========================================================="
echo "    Secure Telegram Door Control System — Setup           "
echo "=========================================================="

# 1. Check Node.js version
if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node.js is not installed. Please install Node.js >= 18.0.0."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "${NODE_VERSION}" | cut -d'.' -f1)

if [ "${NODE_MAJOR}" -lt 18 ]; then
    echo "ERROR: Node.js version ${NODE_VERSION} is detected. Minimum required version is 18.0.0."
    exit 1
fi
echo "[OK] Node.js ${NODE_VERSION} detected."

# 2. Prepare persistent data directory
mkdir -p "${PROJECT_ROOT}/data"
chmod 700 "${PROJECT_ROOT}/data"
echo "[OK] Data directory created at ${PROJECT_ROOT}/data"

# 3. Handle .env configuration
if [ ! -f "${PROJECT_ROOT}/.env" ]; then
    echo "[!] .env not found. Copying .env.example -> .env"
    cp "${PROJECT_ROOT}/.env.example" "${PROJECT_ROOT}/.env"
    chmod 600 "${PROJECT_ROOT}/.env"
    echo "[!] IMPORTANT: Edit ${PROJECT_ROOT}/.env and configure your BOT_TOKEN and ALLOWED_TELEGRAM_USER_IDS."
else
    echo "[OK] Existing .env file found."
fi

# 4. Install dependencies and build TypeScript
echo "[*] Installing Node.js dependencies in ${BOT_DIR}..."
cd "${BOT_DIR}"
npm install

echo "[*] Compiling TypeScript..."
npm run build

echo ""
echo "=========================================================="
echo "    Setup Complete! Next Steps:                           "
echo "=========================================================="
echo "1. Configure your environment variables:"
echo "   nano ${PROJECT_ROOT}/.env"
echo ""
echo "2. Obtain your numeric Telegram User ID:"
echo "   - Open Telegram and message @userinfobot"
echo "   - Copy the numerical Id (e.g., 123456789)"
echo "   - Put it in ALLOWED_TELEGRAM_USER_IDS in .env"
echo ""
echo "3. Run unit tests to verify system integrity:"
echo "   cd ${BOT_DIR} && npm test"
echo ""
echo "4. Start with PM2 for persistent 24/7 background operation:"
echo "   npm install -g pm2"
echo "   pm2 start dist/index.js --name telegram-door-control"
echo "   pm2 save"
echo "   pm2 startup"
echo "=========================================================="
