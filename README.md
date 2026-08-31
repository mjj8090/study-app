# 备考助手 — Vercel 部署说明

## 一次性部署步骤

### 1. 注册 Vercel

1. 打开 [vercel.com](https://vercel.com)，点击 **Sign Up**
2. 选择 **Continue with GitHub**，用你的 GitHub 账号登录
3. 授权 Vercel 访问你的 GitHub

---

### 2. 开启 Vercel KV（存储）

1. 进入 Vercel 控制台 → 点击顶部 **Storage**
2. 点击 **Create**，选择 **KV**
3. 名字随便取（如 `study-kv`），Region 选 **Singapore（sin1）**
4. 创建完成后，点击 **Connect Project** → 选择你的 study-app 项目

---

### 3. 设置环境变量

在 Vercel 项目 → **Settings → Environment Variables** 添加以下 3 个变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `ADMIN_USER` | `admin`（或自定义）| 管理员用户名 |
| `ADMIN_PASS` | 你的管理员密码 | 不要太简单 |
| `JWT_SECRET` | 随机字符串（32位以上）| 如 `k8f2mQx...`，用于加密 token |

生成随机字符串的方法：在浏览器控制台运行 `crypto.randomUUID()`

---

### 4. 导入 GitHub 仓库并部署

1. Vercel 控制台 → **Add New Project**
2. 选择 **Import Git Repository** → 找到 `study-app`
3. 框架选 **Other**（不要选 Next.js 等）
4. 点击 **Deploy**
5. 等 1~2 分钟，部署完成后会给你一个公网 URL（如 `study-app-xxx.vercel.app`）

---

## 日常使用

### 管理员（你）
1. 用浏览器打开 Vercel 给的 URL
2. 用 `ADMIN_USER` / `ADMIN_PASS` 登录
3. 点「导入」上传 TXT 题库（可按科目多次导入）
4. 点「用户」创建其他人的账号
5. 把 URL 和账号密码发给对方

### 普通用户
1. iOS Safari 打开 URL
2. 点击底部分享按钮 → **添加到主屏幕**
3. 用分配的账号密码登录，正常使用所有学习功能

---

## 安全说明

- 题库只存在服务器（Vercel KV），用户设备上没有 TXT 原文
- 每个用户同时只能一个设备登录（在新设备登录会自动踢出旧会话）
- 用户进度（完成情况、打卡等）存在各自手机本地，互不影响
