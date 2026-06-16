#!/bin/bash
# 签到清单一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/SDA2333/checkin-tracker/master/install.sh | bash
# 或者: wget -qO- https://raw.githubusercontent.com/SDA2333/checkin-tracker/master/install.sh | bash

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  签到清单 Checkin Tracker 一键安装  ${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# 检查是否 root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}请使用 root 权限运行此脚本${NC}"
  echo "sudo bash install.sh"
  exit 1
fi

# 创建专用用户(如果不存在)
if ! id -u checkin &>/dev/null; then
  echo -e "${YELLOW}创建专用用户 checkin...${NC}"
  useradd -r -s /bin/false -d /opt/checkin -M checkin
  echo -e "${GREEN}✓${NC} 用户 checkin 已创建"
else
  echo -e "${GREEN}✓${NC} 用户 checkin 已存在"
fi

# 检查 Node.js
echo -e "${YELLOW}[1/7]${NC} 检查 Node.js..."
if ! command -v node &> /dev/null; then
  echo -e "${RED}未检测到 Node.js，请先安装 Node.js 18+${NC}"
  echo "Ubuntu/Debian: apt install nodejs npm"
  echo "CentOS/RHEL: yum install nodejs npm"
  exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}Node.js 版本过低 (需要 18+，当前 $(node -v))${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# 检查编译工具(better-sqlite3 需要)
echo -e "${YELLOW}[2/7]${NC} 检查编译工具..."
if ! command -v gcc &> /dev/null || ! command -v make &> /dev/null; then
  echo -e "${YELLOW}未检测到 gcc/make，正在安装...${NC}"
  if command -v apt &> /dev/null; then
    apt update && apt install -y build-essential
  elif command -v yum &> /dev/null; then
    yum groupinstall -y "Development Tools"
  else
    echo -e "${RED}无法自动安装编译工具，请手动安装 gcc 和 make${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}✓${NC} gcc $(gcc --version | head -1 | awk '{print $NF}')"

# 克隆或更新代码
INSTALL_DIR="/opt/checkin"
echo -e "${YELLOW}[3/7]${NC} 下载代码到 $INSTALL_DIR ..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${YELLOW}检测到已有安装，正在更新...${NC}"
  cd "$INSTALL_DIR"
  git pull
else
  rm -rf "$INSTALL_DIR"
  git clone https://github.com/SDA2333/checkin-tracker.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 设置目录权限
chown -R checkin:checkin "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"

# 安装依赖
echo -e "${YELLOW}[4/7]${NC} 安装 Node.js 依赖..."
npm install --omit=dev

# 生成 .env(如果不存在)
echo -e "${YELLOW}[5/7]${NC} 配置环境变量..."
if [ ! -f .env ]; then
  cp .env.example .env
  # 生成随机密码(16位字母数字)
  PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)
  sed -i "s|^APP_PASSWORD=.*|APP_PASSWORD=$PASSWORD|" .env
  echo -e "${GREEN}✓${NC} 已生成随机密码: ${GREEN}$PASSWORD${NC}"
  echo -e "${YELLOW}  保存此密码！登录时需要。可稍后在 .env 中修改。${NC}"
else
  echo -e "${GREEN}✓${NC} 使用现有 .env 配置"
  PASSWORD=$(grep "^APP_PASSWORD=" .env | cut -d'=' -f2)
fi

# 安装 systemd 服务
echo -e "${YELLOW}[6/7]${NC} 配置 systemd 服务..."
NODE_PATH=$(command -v node)
sed "s|__NODE__|$NODE_PATH|" deploy/checkin.service > /etc/systemd/system/checkin.service
systemctl daemon-reload
systemctl enable checkin
systemctl restart checkin

# 检查服务状态
echo -e "${YELLOW}[7/7]${NC} 检查服务状态..."
sleep 2
if systemctl is-active --quiet checkin; then
  echo -e "${GREEN}✓${NC} 服务已启动"
else
  echo -e "${RED}✗ 服务启动失败，查看日志:${NC}"
  journalctl -u checkin -n 20 --no-pager
  exit 1
fi

# 检测监听端口
PORT=$(grep "^PORT=" .env 2>/dev/null | cut -d'=' -f2 || echo "3000")
if ss -tlnp | grep -q ":$PORT "; then
  echo -e "${GREEN}✓${NC} 正在监听端口 $PORT"
else
  echo -e "${RED}✗ 端口 $PORT 未监听，请检查日志${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}         安装成功！🎉               ${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "📍 安装位置: ${GREEN}$INSTALL_DIR${NC}"
echo -e "🔐 登录密码: ${GREEN}$PASSWORD${NC}"
echo -e "🌐 访问地址: ${GREEN}http://$(hostname -I | awk '{print $1}'):$PORT${NC}"
echo ""
echo -e "${YELLOW}⚠️  公网访问需要在云服务商控制台放行端口 $PORT${NC}"
echo ""
echo "常用命令:"
echo "  systemctl status checkin     # 查看状态"
echo "  systemctl restart checkin    # 重启服务"
echo "  journalctl -u checkin -f     # 查看日志"
echo "  nano $INSTALL_DIR/.env       # 修改配置(改完需重启)"
echo ""
echo -e "更新代码: ${GREEN}bash $INSTALL_DIR/update.sh${NC}"
echo ""
