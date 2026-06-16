# 签到清单 Checkin Tracker

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/SDA2333/checkin-tracker?style=social)](https://github.com/SDA2333/checkin-tracker/stargazers)

一个轻量的个人「签到清单 + 续期提醒」网站,解放你的记忆负担。

## ✨ 功能

- **今日签到** - 列出每天要签到的网站,点「去签到」自动打勾;显示🔥连续天数和进度条
- **日历视图** - 按月查看签到完成情况,点某天可补签
- **续期提醒** - 登记周期续期项目(如 40 天续期),自动算出到期日,临近/过期高亮提醒
- **网站管理** - 增删改、排序、归档签到网站
- **响应式设计** - 电脑/手机/平板都能用
- **可选背景图** - 右上角一键切换纯色/背景图模式

**技术栈**: Node.js + Express + SQLite (零依赖,一个文件搞定数据)

## 🚀 一键安装

在你的 **Linux 服务器**(需要 root 权限)上运行:

```bash
curl -fsSL https://raw.githubusercontent.com/SDA2333/checkin-tracker/master/install.sh | sudo bash
```

或者用 `wget`:

```bash
wget -qO- https://raw.githubusercontent.com/SDA2333/checkin-tracker/master/install.sh | sudo bash
```

**安装脚本会自动**:
1. ✅ 检查 Node.js 环境(需要 18+,不满足会提示)
2. ✅ 安装编译工具(gcc/make,用于编译 SQLite 原生模块)
3. ✅ 克隆代码到 `/opt/checkin`
4. ✅ 安装 npm 依赖
5. ✅ 生成随机强密码并配置 `.env`
6. ✅ 配置 systemd 服务(开机自启、崩溃自重启)
7. ✅ 启动服务并检查状态

安装完成后会显示:
- 🔐 **登录密码**(保存好,可稍后在 `/opt/checkin/.env` 中修改)
- 🌐 **访问地址** `http://你的服务器IP:3000`

**⚠️ 公网访问**:需要在云服务商控制台(安全组/防火墙)放行端口 `3000`。

## 📦 手动安装(可选)

如果不想用一键脚本,也可以手动操作:

```bash
# 1. 克隆仓库
git clone https://github.com/SDA2333/checkin-tracker.git /opt/checkin
cd /opt/checkin

# 2. 安装依赖
npm install --omit=dev

# 3. 配置环境变量
cp .env.example .env
nano .env  # 修改 APP_PASSWORD 为你的密码

# 4. 配置 systemd 服务
NODE_PATH=$(command -v node)
sed "s|__NODE__|$NODE_PATH|" deploy/checkin.service > /etc/systemd/system/checkin.service
systemctl daemon-reload
systemctl enable --now checkin

# 5. 检查状态
systemctl status checkin
```

## 🔄 更新代码

```bash
bash /opt/checkin/update.sh
```

更新脚本会:
- 备份配置和数据
- 拉取最新代码
- 自动更新依赖(如果 `package.json` 有变化)
- 重启服务
- 失败自动回滚

## 🛠️ 常用命令

```bash
systemctl status checkin       # 查看状态
systemctl restart checkin      # 重启服务
systemctl stop checkin         # 停止服务
journalctl -u checkin -f       # 实时日志
journalctl -u checkin -n 50    # 最近 50 行日志
```

## ⚙️ 配置

编辑 `/opt/checkin/.env`:

```env
# 登录密码
APP_PASSWORD=你的密码

# 监听端口
PORT=3000

# 数据库路径(默认 ./data/checkin.db)
# DB_PATH=./data/checkin.db

# 关闭登录验证(仅内网环境,公网勿用)
# AUTH_DISABLED=false
```

修改后重启服务:`systemctl restart checkin`

## 💾 备份

数据只在一个 SQLite 文件里:

```bash
# 备份
cp /opt/checkin/data/checkin.db ~/checkin-backup-$(date +%F).db

# 恢复
cp ~/checkin-backup-2026-06-16.db /opt/checkin/data/checkin.db
systemctl restart checkin
```

## 🐛 故障排查

**服务启动失败**:
```bash
journalctl -u checkin -n 50 --no-pager
```

**端口被占用**:
```bash
ss -tlnp | grep :3000
# 换端口:编辑 .env 改 PORT,然后 systemctl restart checkin
```

**公网访问不了**:
1. 检查服务是否在跑:`systemctl status checkin`
2. 检查是否监听 `0.0.0.0:3000`:`ss -tlnp | grep 3000`
3. 检查云服务商安全组是否放行端口 3000

## 📸 截图

![今日签到页面](screenshots/screenshot-today.jpg)

*今日签到页面 - 显示进度、连续天数、可选背景图*

## 📄 开源协议

MIT License

---

**⭐ 觉得好用请给个 Star!**
