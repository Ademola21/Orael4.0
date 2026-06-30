#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Orael — Docker Installation Script
#  Handles full setup: env config, Docker build, deploy.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          ORAEL — Docker Installer                 ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# Check we're in the project root
if [ ! -f "package.json" ] || [ ! -f "Dockerfile" ]; then
  echo -e "${RED}✗ Error: Run this script from the Orael project root${NC}"
  echo "  (the directory containing package.json and Dockerfile)"
  exit 1
fi

# ─── 1. Check Docker ───────────────────────────────────────────
echo -e "${YELLOW}[1/6] Checking Docker installation...${NC}"
if ! command -v docker &> /dev/null; then
  echo -e "${RED}✗ Docker is not installed.${NC}"
  echo ""
  echo "Install Docker first:"
  echo "  • Linux:   curl -fsSL https://get.docker.com | sh"
  echo "  • macOS:   https://docs.docker.com/desktop/mac/install/"
  echo "  • Windows: https://docs.docker.com/desktop/windows/install/"
  exit 1
fi
echo -e "${GREEN}✓ Docker found: $(docker --version)${NC}"

if ! docker compose version &> /dev/null; then
  echo -e "${RED}✗ Docker Compose v2 not found.${NC}"
  echo "  Install Docker Compose plugin: https://docs.docker.com/compose/install/"
  exit 1
fi
echo -e "${GREEN}✓ Docker Compose found: $(docker compose version --short)${NC}"
echo ""

# ─── 2. Configure .env ─────────────────────────────────────────
echo -e "${YELLOW}[2/6] Configuring environment...${NC}"

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "${GREEN}✓ Created .env from .env.example${NC}"
  echo ""
  echo -e "${YELLOW}  ⚠ You MUST edit .env before going live. Required values:${NC}"
  echo "     • BOT_TOKEN              — from @BotFather"
  echo "     • ADMIN_IDS              — your Telegram user ID(s), comma-separated"
  echo "     • ADSGRAM_SECRET         — from Adsgram dashboard"
  echo "     • DOMAIN                 — your public URL"
  echo ""
  read -p "  Edit .env now? [Y/n] " edit_env
  if [[ "$edit_env" != "n" && "$edit_env" != "N" ]]; then
    ${EDITOR:-nano} .env
  fi
else
  echo -e "${GREEN}✓ .env already exists${NC}"
fi
echo ""

# Validate critical env vars
source .env
MISSING=()
[ -z "$BOT_TOKEN" ] && MISSING+=("BOT_TOKEN")
[ -z "$ADMIN_IDS" ] && MISSING+=("ADMIN_IDS")
[ -z "$ADSGRAM_SECRET" ] && MISSING+=("ADSGRAM_SECRET")

if [ ${#MISSING[@]} -gt 0 ]; then
  echo -e "${RED}✗ Missing required env vars: ${MISSING[*]}${NC}"
  echo "  Edit .env and fill these in, then re-run: ./install.sh"
  exit 1
fi
echo -e "${GREEN}✓ All required env vars present${NC}"
echo ""

# ─── 3. Stop existing containers ───────────────────────────────
echo -e "${YELLOW}[3/6] Stopping any existing Orael containers...${NC}"
if docker compose ps -q orael &> /dev/null; then
  docker compose down
  echo -e "${GREEN}✓ Stopped existing containers${NC}"
else
  echo -e "${GREEN}✓ No existing containers to stop${NC}"
fi
echo ""

# ─── 4. Build Docker image ─────────────────────────────────────
echo -e "${YELLOW}[4/6] Building Docker image (this may take a few minutes)...${NC}"
docker compose build --no-cache
echo -e "${GREEN}✓ Image built${NC}"
echo ""

# ─── 5. Start the container ────────────────────────────────────
echo -e "${YELLOW}[5/6] Starting Orael...${NC}"
docker compose up -d
echo ""

# Wait for health check
echo -e "${YELLOW}  Waiting for health check...${NC}"
for i in {1..30}; do
  if curl -sf http://localhost:${PORT:-3000}/api/health &> /dev/null; then
    echo -e "${GREEN}✓ Server is healthy${NC}"
    break
  fi
  if [ $i -eq 30 ]; then
    echo -e "${RED}✗ Server failed to start within 30 seconds${NC}"
    echo "  Check logs: docker compose logs -f"
    exit 1
  fi
  sleep 1
done
echo ""

# ─── 6. Done ───────────────────────────────────────────────────
echo -e "${YELLOW}[6/6] Deployment complete!${NC}"
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              DEPLOYMENT SUCCESSFUL                ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Server:${NC}  http://localhost:${PORT:-3000}"
echo -e "  ${GREEN}Domain:${NC}   ${DOMAIN:-not set}"
echo -e "  ${GREEN}Admin:${NC}    Open the bot in Telegram → /admin"
echo ""
echo -e "  ${YELLOW}Useful commands:${NC}"
echo "    • View logs:        docker compose logs -f"
echo "    • Restart:          docker compose restart"
echo "    • Stop:             docker compose down"
echo "    • Update & rebuild: git pull && docker compose up -d --build"
echo ""
echo -e "  ${YELLOW}Admin panel:${NC}"
echo "    Open your bot in Telegram, send /admin command."
echo "    You're an admin if your Telegram ID is in ADMIN_IDS in .env"
echo "    (Your IDs: ${ADMIN_IDS})"
echo ""
