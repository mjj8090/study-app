# 备考助手 — Vercel 部署说明

## 一、注册 Vercel（用 GitHub 账号登录）

1. 打开 [vercel.com](https://vercel.com)
2. 点右上角 **Sign Up**
3. 选 **Continue with GitHub**，会跳到 GitHub 页面，点 **Authorize Vercel**
4. 填一些基本信息（个人用，Plan 选 Hobby，免费）
5. 进入 Vercel 控制台

---

## 二、部署项目

1. 在 Vercel 控制台首页，点左上角 **Add New…** → **Project**
2. 在 "Import Git Repository" 下找到 `study-app`，点旁边的 **Import**
3. 进入配置页面：
   - Framework Preset：选 **Other**（不要选 Next.js）
   - 其他不用改
4. 点 **Deploy**，等 1~2 分钟，出现 "Congratulations" 就说明部署成功
5. 这时候你会得到一个 URL，比如 `study-app-xxx.vercel.app`

---

## 三、安装 Upstash Redis（用于存储题库和用户）

1. 在 Vercel 控制台顶部菜单点 **Marketplace**（如果看不到，在左侧边栏找）
2. 搜索 **Upstash**，点进去，找 **Upstash for Redis**，点 **Install**
3. 选 **Add New Database**
4. 数据库名随便填（如 `study-db`），Region 选 **ap-southeast-1（Singapore）**，Plan 选 **Free**
5. 点 **Create**
6. 创建完后，点 **Connect Project** → 选你的 **study-app** → 点 **Connect**
7. 系统会自动把 Redis 的连接信息写入你项目的环境变量（不需要手动填）

---

## 四、设置环境变量

1. 在 Vercel 控制台左侧，点你的 **study-app** 项目
2. 点上方 **Settings** 标签
3. 左侧菜单点 **Environment Variables**
4. 依次添加以下 3 个变量（每个点 Add 保存）：

   | Name | Value | 说明 |
   |------|-------|------|
   | `ADMIN_USER` | 你想要的管理员用户名，比如 `admin` | |
   | `ADMIN_PASS` | 你的管理员密码，比如 `mypass123` | 自己记住 |
   | `JWT_SECRET` | 一串随机字符，见下方生成方法 | |

   **生成 JWT_SECRET 的方法：**
   在手机或电脑的浏览器里打开任意网页，按 F12（电脑）或长按→检查，在 Console 里粘贴这行代码回车：
   ```
   Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('')
   ```
   复制输出的那串字符，粘贴到 JWT_SECRET 的 Value 里

5. 添加完 3 个变量后，回到项目的 **Deployments** 标签
6. 找最新那次部署，点右边的 **…** → **Redeploy**（重新部署，让新变量生效）
7. 等 1 分钟，重新部署完成

---

## 五、开始使用

1. 打开你的 Vercel URL（`study-app-xxx.vercel.app`）
2. 用你设置的 `ADMIN_USER` / `ADMIN_PASS` 登录
3. 点底部 **导入** 标签，上传题库 TXT 文件，选择科目，确认导入
4. 点底部 **用户** 标签，创建其他人的账号
5. 把 URL 和账号密码发给对方，他们在 iOS Safari 打开，点分享→**添加到主屏幕**即可当 App 使用

---

## 说明

- 题库只存在 Upstash 服务器，用户手机上不保存原始题目内容
- 每个账号同时只能一个设备登录（在新设备登录会自动退出旧设备）
- 每个用户的学习进度（打卡、完成情况）保存在各自手机本地，互不影响
