#!/bin/bash

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
RESET='\033[0m'

echo -e "${MAGENTA}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                                                                  ║"
echo "║     ██╗ ██████╗ ██████╗ ██████╗  █████╗ ███╗   ██╗             ║"
echo "║     ██║██╔═══██╗██╔══██╗██╔══██╗██╔══██╗████╗  ██║             ║"
echo "║     ██║██║   ██║██████╔╝██║  ██║███████║██╔██╗ ██║             ║"
echo "║██   ██║██║   ██║██╔══██╗██║  ██║██╔══██║██║╚██╗██║             ║"
echo "║╚█████╔╝╚██████╔╝██║  ██║██████╔╝██║  ██║██║ ╚████║             ║"
echo "║ ╚════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝             ║"
echo "║                                                                  ║"
echo "║              🤖  B O T   O F I C I A L  🤖                      ║"
echo "║                                                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

echo -e "${MAGENTA}══════════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "${CYAN}⚡ INICIANDO JORDAN BOT OFICIAL v2.0 ⚡${RESET}"
echo ""
echo -e "${YELLOW}✦ PREPARANDO SISTEMA ✦${RESET}"

for i in {0..100..4}; do
    filled=$((i / 2))
    empty=$((50 - filled))
    printf "\r${GREEN}[${RESET}"
    printf "%${filled}s" | tr ' ' '='
    printf "%${empty}s" | tr ' ' '-'
    printf "${GREEN}] ${i}%%${RESET}"
    sleep 0.01
done
echo -e " ${GREEN}✓ PRONTO!${RESET}"
echo ""

echo -e "${CYAN}📦 CARREGANDO MÓDULOS:${RESET}"
mods=("CONEXÃO" "BANCO-DE-DADOS" "COMANDOS" "PROTEÇÃO" "MÚSICA" "JOGOS")
for mod in "${mods[@]}"; do
    echo -ne "  ➤ ${mod} ..."
    sleep 0.15
    echo -e " ${GREEN}✔${RESET}"
done
echo ""

echo -e "${YELLOW}✦ JORDAN BOT OFICIAL PRONTO ✦${RESET}"
echo -e "${CYAN}🚀 Conectando ao WhatsApp com reconexão automática...${RESET}"
echo ""
echo -e "${MAGENTA}══════════════════════════════════════════════════════════════════${RESET}"
echo ""

node jordan-bot.js
