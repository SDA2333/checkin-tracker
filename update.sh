#!/bin/bash
# 签到清单更新脚本 - 拉取最新代码并重启服务
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="/opt/checkin"

if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "${RED}未检测到安装目录 $INSTALL_DIR${NC}"
  echo "请先运行安装脚本"
  exit 1
fi

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 root 权限运行${NC}"
  exit 1
fi

echo -e "${GREEN}开始更新签到清单...${NC}"

cd "$INSTALL_DIR"

# 备份 .env 和数据(防止误操作)
echo -e "${YELLOW}[1/4]${NC} 备份配置和数据..."
[ -f .env ] && cp .env .env.backup
[ -d data ] && tar czf "data-backup-$(date +%Y%m%d-%H%M%S).tar.gz" data/ && echo -e "${GREEN}✓${NC} 数据已备份"

# 拉取最新代码
echo -e "${YELLOW}[2/4]${NC} 拉取最新代码..."
git fetch origin
LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})
if [ "$LOCAL" = "$REMOTE" ]; then
  echo -e "${GREEN}✓${NC} 已是最新版本"
else
  git pull
  echo -e "${GREEN}✓${NC} 代码已更新"
fi

# 更新依赖(检测 package.json 是否变化)
echo -e "${YELLOW}[3/4]${NC} 检查依赖..."
if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -q "package.json"; then
  echo -e "${YELLOW}package.json 有变化，重新安装依赖...${NC}"
  npm install --omit=dev
else
  echo -e "${GREEN}✓${NC} 依赖无变化"
fi

# 重启服务
echo -e "${YELLOW}[4/4]${NC} 重启服务..."
systemctl restart checkin
sleep 2

if systemctl is-active --quiet checkin; then
  echo -e "${GREEN}✓${NC} 服务已重启"
  echo ""
  echo -e "${GREEN}更新完成！${NC}"
  journalctl -u checkin -n 5 --no-pager
else
  echo -e "${RED}✗ 服务启动失败，回滚...${NC}"
  git reset --hard HEAD@{1}
  [ -f .env.backup ] && cp .env.backup .env
  systemctl restart checkin
  echo -e "${YELLOW}已回滚到上一版本${NC}"
  exit 1
fi
