# 贡献指南

感谢你考虑为签到清单项目做贡献！

## 如何贡献

### 报告 Bug

如果发现 Bug,请[提交 Issue](https://github.com/SDA2333/checkin-tracker/issues/new) 并包含:
- 运行环境(操作系统、Node.js 版本)
- 复现步骤
- 预期行为 vs 实际行为
- 错误日志(`journalctl -u checkin -n 50`)

### 提交功能建议

欢迎提交新功能想法！请先[开个 Issue](https://github.com/SDA2333/checkin-tracker/issues/new) 讨论,避免重复工作。

### Pull Request 流程

1. **Fork 仓库**并克隆到本地
2. **创建分支**: `git checkout -b feature/你的功能名`
3. **本地开发**:
   ```bash
   npm install
   cp .env.example .env  # 修改密码
   npm start             # http://localhost:3000
   ```
4. **测试**: 确保功能正常,不破坏现有功能
5. **提交**: 遵循 [约定式提交](https://www.conventionalcommits.org/zh-hans/)
   - `feat: 添加 xxx 功能`
   - `fix: 修复 xxx Bug`
   - `docs: 更新文档`
   - `style: 代码格式调整`
   - `refactor: 重构 xxx`
6. **推送**并提交 Pull Request

### 代码风格

- 使用 2 空格缩进
- 单引号字符串(除非有插值)
- 保持现有代码风格一致

### 许可

提交 PR 即表示你同意你的贡献以 MIT 协议开源。

---

再次感谢你的贡献! 🎉
