# 签到清单 Checkin Tracker

一个轻量的个人「签到清单 + 续期提醒」网站：

- **今日签到**：列出每天要签到的网站，点「去签到」打开网站，自己签完回来打勾；显示连续天数和今日进度。
- **日历视图**：按月查看每天的完成情况（全部完成 / 部分完成 / 未签），点某天可补签。
- **续期提醒**：登记需要周期续期的项目（如 40 天续期），自动算出下次到期日，临近 / 过期高亮排在最前。
- **网站管理**：增删改、排序、归档要签到的网站。
- **单人密码登录**，数据存本地 SQLite，多设备通过同一服务器同步。

技术栈：Node.js + Express + better-sqlite3（无需额外数据库服务）。

---

## 本地开发

```bash
npm install
cp .env.example .env      # 修改里面的 APP_PASSWORD
npm start                 # 默认 http://localhost:3000
```

## 部署到服务器（systemd）

服务运行在 `/opt/checkin`，由 systemd 守护（开机自启、崩溃自重启）。

1. 把项目同步到服务器（不含 node_modules / data / .env）：
   ```bash
   rsync -az --exclude node_modules --exclude data --exclude .env \
     ./ root@SERVER:/opt/checkin/
   ```
2. 在服务器上安装依赖（会编译 better-sqlite3，需 gcc/make）：
   ```bash
   ssh root@SERVER 'cd /opt/checkin && npm install --omit=dev'
   ```
3. 创建 `.env`（首次部署可自动生成随机密码）：
   ```bash
   ssh root@SERVER 'cd /opt/checkin && [ -f .env ] || { cp .env.example .env; \
     pw=$(openssl rand -base64 12); sed -i "s|^APP_PASSWORD=.*|APP_PASSWORD=$pw|" .env; echo "密码: $pw"; }'
   ```
4. 安装并启动 systemd 服务（把 `__NODE__` 换成 `which node` 的结果）：
   ```bash
   NODE=$(ssh root@SERVER 'command -v node')
   ssh root@SERVER "sed 's|__NODE__|$NODE|' /opt/checkin/deploy/checkin.service > /etc/systemd/system/checkin.service \
     && systemctl daemon-reload && systemctl enable --now checkin"
   ```

更新代码：重复第 1、2 步后 `systemctl restart checkin`。

## 常用运维

```bash
systemctl status checkin            # 状态
journalctl -u checkin -f            # 实时日志
systemctl restart checkin           # 重启（改完 .env 后需要）
```

## 备份

数据只在一个文件里，直接拷走即可：

```bash
cp /opt/checkin/data/checkin.db  ~/checkin-backup-$(date +%F).db
```

## 配置项（.env）

| 变量 | 说明 | 默认 |
|------|------|------|
| `APP_PASSWORD` | 登录密码 | 无（必须设置） |
| `PORT` | 监听端口 | `3000` |
| `DB_PATH` | 数据库文件路径 | `./data/checkin.db` |
| `AUTH_DISABLED` | 设 `true` 关闭登录（仅可信内网） | `false` |

> 公网访问别忘了在云服务器**安全组 / 防火墙**放行对应端口。
