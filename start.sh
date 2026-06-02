#!/bin/bash

# Cores ANSI
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
WHITE='\033[1;37m'
PURPLE='\033[0;35m'
RESET='\033[0m'
BOLD='\033[1m'

# Banner KIMORI sem caracteres especiais problemáticos
echo -e "${MAGENTA}${BOLD}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               "
echo "║     ██╗  ██╗██╗███╗   ███╗ ██████╗ ██████╗ ██╗               "
echo "║     ██║ ██╔╝██║████╗ ████║██╔═══██╗██╔══██╗██║               "
echo "║     █████╔╝ ██║██╔████╔██║██║   ██║██████╔╝██║               "
echo "║     ██╔═██╗ ██║██║╚██╔╝██║██║   ██║██╔══██╗██║               "
echo "║     ██║  ██╗██║██║ ╚═╝ ██║╚██████╔╝██║  ██║██║               "
echo "║     ╚═╝  ╚═╝╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝               "
echo "║                                                               "
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# Linha decorativa
echo -e "${MAGENTA}════════════════════════════════════════════════════════════════${RESET}"
echo ""

# Texto gradiente simples
echo -e "${CYAN}⚡ INICIANDO SISTEMA OPERACIONAL KIMORI V1 ADVANCE ⚡${RESET}"
echo ""

# Animação de preparação
echo -e "${YELLOW}✦ PREPARANDO MÓDULOS ✦${RESET}"

# Barra de progresso sem caracteres especiais
echo -ne "${GREEN}[KIMORI V1]${RESET} "
for i in {0..100..2}; do
    filled=$((i / 2))
    empty=$((50 - filled))
    printf "\r${GREEN}[${RESET}"
    printf "%${filled}s" | tr ' ' '='
    printf "%${empty}s" | tr ' ' '-'
    printf "${GREEN}] ${i}%%${RESET}"
    sleep 0.02
done
echo -e " ${GREEN}✓ COMPLETO!${RESET}"
echo ""

# Dependências
echo -e "${CYAN}◤ CARREGANDO DEPENDÊNCIAS ◥${RESET}"
echo ""

# Módulos
echo -e "${CYAN}📦 CARREGANDO MÓDULOS:${RESET}"
modules=("CORE" "DATABASE" "COMMANDS" "EVENTS" "MIDIA" "API")
for module in "${modules[@]}"; do
    echo -ne "  ➤ ${module} "
    for s in {1..3}; do
        echo -ne "."
        sleep 0.2
    done
    echo -e " ${GREEN}✔${RESET}"
    sleep 0.1
done
echo ""

# Finalização
echo -e "${YELLOW}✦ KIMORI PRONTO PARA USAR ✦${RESET}"
echo -e "${CYAN}✨ KIMORI V1 ADVANCE - CONECTANDO AO WHATSAPP...${RESET}"
echo ""
echo -e "${MAGENTA}════════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "${GREEN}🚀 INICIANDO CONNECTION BRIDGE...${RESET}"
echo ""

# Executa o Node
if [ "$1" = "sim" ]; then
    node ./ARQUIVES/connect.js sim
elif [ "$1" = "não" ]; then
    node ./ARQUIVES/connect.js não
else
    node ./ARQUIVES/connect.js
fi