# 个人 IP 口播智能体：客户部署与 Agent 交接说明

> 这是本源码包的第一入口文档。接收方把整个文件夹交给编程 Agent 后，请让 Agent 先完整阅读本文档和 `AGENTS.md`，再配置、修改或部署。

## 1. 交付包是什么

这是一套“用户自带 API Key”的网页端数字人口播产品源码，包含：

- 邮箱密码注册、登录，默认不要求邮箱验证。
- 暗号免费开通、年费方案展示和管理员权限。
- 零散想法交给 DeepSeek 生成口播稿，或直接粘贴现成稿。
- 用户自己配置 DeepSeek、益民居·数字人和 ImageGen API Key。
- 声音素材上传、文字确认、声音档案、数字人上传与选择。
- 数字人基础成片、逐句字幕、顶部标题、封面图并行生成。
- 火山引擎/ECS 独立渲染节点，使用 Remotion + FunASR。
- 管理后台，可查用户、任务、成功/失败、耗时、排队与教学视频。
- 原片和最终成片默认保存 7 天，由渲染节点定时触发清理。

交付 ZIP 特意不包含：

- 原平台的 API Key、AccessKey、令牌、密码、`.env` 和 `.secrets`。
- 原 EdgeSpark 项目身份、生产域名、管理员邮箱和 OSS 桶名。
- 用户账号、数据库数据、上传素材、生成视频、封面、日志和审计截图。
- `.git`、`node_modules`、`dist` 和本地平台缓存。

## 2. 架构和部署边界

| 组件 | 目录 | 运行位置 | 职责 |
| --- | --- | --- | --- |
| Web | `web/` | EdgeSpark 静态站点 | React 工作台、设置、管理后台 |
| API | `server/` | EdgeSpark Worker | 认证、D1 数据、R2 文件、业务编排和密钥加密 |
| Render Worker | `render-worker/` | 独立 Linux 服务器 | 轮询任务、FunASR 转写、Remotion 字幕包装、ImageGen 任务 |
| 新手教学 | `server/src/routes/tutorial.ts` | 阿里云 OSS | 管理员上传教学视频，用户签名播放 |

不要把渲染 Worker 塞进 EdgeSpark Worker。Remotion、Chromium 和 FunASR 需要独立 Linux 计算资源。

## 3. 接收方需要准备的账号和资源

1. EdgeSpark 账号和一个全新项目。
2. 一个已备案或符合自身地区要求的域名。
3. 一台 Linux 服务器用于渲染；建议起步 4 vCPU / 8 GiB，内存越小，并发越要保守。
4. 阿里云 OSS Bucket 和一个仅授予该 Bucket 所需权限的 RAM 用户。
5. 需要收款时：微信支付商户平台、商户号、AppID，以及可在公网 HTTPS 访问的支付回调域名。
6. 普通用户各自申请 DeepSeek、益民居·数字人、ImageGen 账号与 Key。

## 4. 平台运营方配置

### 4.1 EdgeSpark 普通变量

这些值不是用户 API Key，但应按环境配置：

| 变量 | 示例/用途 |
| --- | --- |
| `APP_ENV` | `production` |
| `ADMIN_BOOTSTRAP_EMAIL` | 接收方自己的初始管理员邮箱 |
| `CHUANSHENYUN_API_BASE` | `https://szr.yiminju.xyz/api/v1` |
| `DEEPSEEK_API_BASE` | `https://api.deepseek.com` |
| `IMAGEGEN_API_BASE` | `https://openapi.yiminju.xyz/api/public/v1` |
| `ALIYUN_OSS_BUCKET` | 接收方自己的 OSS Bucket 名 |
| `ALIYUN_OSS_REGION` | 例如 `cn-guangzhou`，以自己 Bucket 地域为准 |

Agent 应先运行 `edgespark var --help`，再按当前 CLI 语法设置。已知当前项目的常用形式为 `edgespark var set KEY=VALUE`。

### 4.2 EdgeSpark 秘密配置

| Secret | 如何获得 | 用途 |
| --- | --- | --- |
| `USER_CREDENTIAL_MASTER_KEY` | 自行生成高强度随机值 | 加密所有普通用户的三类 API Key |
| `INVITE_CODE_HMAC_KEY` | 自行生成另一个高强度随机值 | 暗号摘要和注册临时凭证签名 |
| `RENDER_WORKER_TOKEN` | 自行生成第三个高强度随机值 | EdgeSpark API 与渲染服务器双向鉴权 |
| `ALIYUN_OSS_ACCESS_KEY_ID` | 阿里云 RAM 访问密钥 | 教学视频的签名上传和播放 |
| `ALIYUN_OSS_ACCESS_KEY_SECRET` | 阿里云 RAM 访问密钥 | 与上一项配对 |

可在终端本地生成随机值，例如 `openssl rand -hex 32`。三个内部随机值必须各不相同。

Agent 应先运行 `edgespark secret --help`。设置 Secret 时，EdgeSpark 会返回一个安全网页地址，必须由人类在该页面填值。不得把 Secret 粘贴到 Agent 对话、Git 提交、日志或截图中。

### 4.3 渲染服务器环境

从 `render-worker/.env.example` 复制到服务器的 `/etc/personal-ip-render-worker.env`，只在服务器本机填写：

- `EDGESPARK_API_BASE`：新项目的 HTTPS 域名。
- `RENDER_WORKER_TOKEN`：必须与 EdgeSpark Secret 中的同名值完全一致。
- `RENDER_WORKER_ID`：该节点的唯一名称。
- `RENDER_CONCURRENCY`：起步用 `1`，只有 CPU/内存验证稳定后才升高。
- `FUNASR_PYTHON`、`FUNASR_MODEL_DIR`、`FUNASR_CPU_THREADS`、`FUNASR_CHUNK_SECONDS`。
- `WORK_DIR`、`CHROME_EXECUTABLE`。
- `MIAOXIANG_API_BASE` 和 `MIAOXIANG_RENDER_WORKER_TOKEN` 是可选的第二后端，不用时留空。

使用 `render-worker/deploy/personal-ip-render-worker.service` 安装 systemd 服务。服务器至少需要 Node.js、npm、Chromium、Python 3、`render-worker/requirements.txt` 中的依赖和可用的中文字体。

### 4.4 OSS 要点

- Bucket 不应公开读写；上传和播放由服务端生成签名 URL。
- RAM 权限只授予目标 Bucket 的必需操作，不要使用主账号 AccessKey。
- CORS 应仅允许新网站域名的 `PUT`/`GET`/`HEAD` 和需要的请求头。
- 管理员部署完成后，从管理后台上传自己的新手教学视频。

## 5. 普通用户自己配置的三个 Key

这三项不应设在平台公共 `.env` 中。用户注册、开通后，在前端“API 设置”页面各自填写，服务端使用 `USER_CREDENTIAL_MASTER_KEY` 进行 AES-GCM 加密：

| 用户 Key | 申请地址 | 作用 |
| --- | --- | --- |
| DeepSeek | `https://platform.deepseek.com/api_keys` | 文案生成、标题和封面信息提炼 |
| 益民居·数字人 | `https://szr.yiminju.xyz/account` | 声音、形象、数字人视频 |
| ImageGen | `https://openapi.yiminju.xyz/register` | AI 封面图 |

平台运营方不承担这三项的 API 成本。

## 6. 微信支付的真实现状

当前代码已完成 `¥2800/年` 方案展示，但 `server/src/routes/billing.ts` 中的 `POST /api/billing/checkout` 仍是占位接口，会返回 `PAYMENT_PROVIDER_REQUIRED`。因此，不是填入商户密钥就会自动收款，接收方 Agent 还需要使用接收方自己的微信支付商户资料完成二次开发。

建议 Agent 按以下顺序实现：

1. 先确认产品场景：PC 网页优先考虑 Native 扫码支付；微信内打开优先考虑 JSAPI。
2. 在 D1 增加订单和支付事件表，通过正向 migration 创建，不得直接远程 DDL。
3. 在 `POST /api/billing/checkout` 创建本地待支付订单，再调微信支付统一下单。
4. 新增公网 HTTPS 回调路由，校验微信支付平台签名，解密通知，并以幂等交易更新订单。
5. 只在服务端确认支付成功后，写入/延长 `access_grants`，不能信任前端的“成功”跳转。
6. 增加订单查询、重复回调、超时关单、异常金额和签名失败测试。

商户号、API v3 Key、商户私钥、商户证书序列号、AppID 和回调验签材料必须作为 EdgeSpark Secret 或受保护的敏感配置，不得写入源码。新增 Secret 后，要同步更新 `server/src/defs/runtime.ts`。

## 7. Agent 部署顺序

1. 查看 `交付包清单.json`，确认 ZIP 来源与校验信息。
2. 运行 `git init`，建立接收方自己的私有仓库；第一次提交前先做密钥扫描。
3. 在 `server/`、`web/`、`render-worker/` 分别运行 `npm ci`。
4. 运行 `edgespark --help`，登录并新建 EdgeSpark 项目；把 `edgespark.toml` 的占位 `project_id` 替换成新项目 ID。
5. 按 `configs/auth-config.yaml` 应用认证配置。如无必要，不要改回邮箱必须验证。
6. 执行数据库 migration、存储定义应用、普通变量和 Secret 配置。对不确定的 CLI 语法，每次先运行对应的 `--help`。
7. 运行 `edgespark pull types`，确认生成类型对应新项目，不得人工编辑 `server/src/__generated__/`。
8. 先运行 `server` 类型检查、`web` 构建、`render-worker` 类型检查和测试，再执行 EdgeSpark 部署。
9. 配置新域名，然后安装并启动渲染 Worker。
10. 用 `ADMIN_BOOTSTRAP_EMAIL` 对应的邮箱注册第一个管理员，进入后台建暗号、上传教学视频。
11. 使用新的普通用户账号，完整走一次注册、暗号、三 Key、声音、数字人、文案、基础成片、字幕成片、封面和下载。
12. 微信支付完成前，不要对外声称“已可在线付费”。

EdgeSpark 常规工作流程是：定义变更 → 生成并应用 migration → 应用 storage/auth 配置 → 设置 vars/secrets → 检查生成类型 → 部署。

## 8. 上线前验收清单

- [ ] ZIP 中没有 `.env`、`.secrets`、`.git`、`node_modules`、`dist`、用户数据或生成媒体。
- [ ] `edgespark.toml` 已是接收方新项目 ID。
- [ ] 三个内部随机密钥不重复，且从未出现在对话和 Git 中。
- [ ] 普通用户在页面自己填三个 Key，页面只回显掩码。
- [ ] 用户 A 不能看到用户 B 的项目、素材、密钥和成片。
- [ ] 教学视频使用接收方自己的 OSS Bucket。
- [ ] 渲染 Worker 重启后自动恢复，不丢排队任务。
- [ ] 成片字幕与声音同步，标题、半透明背景条和黄色重点符合样式。
- [ ] 原片和最终成片会在 7 天后清理，前端有明确提示。
- [ ] 封面图会归档到本平台存储，不仅保存上游临时 URL。
- [ ] 管理后台用户、任务、耗时、错误和排队数据可正常分页。
- [ ] 微信支付已用沙箱/小额真实订单验证，回调重放不会重复开通。
- [ ] 生产网页使用无登录、无缓存的真实访问验收，而不是只看 HTTP 200。

## 9. 可直接发给接收方 Agent 的指令

```text
这是“个人 IP 口播智能体”的脱敏客户源码包。请先完整阅读 AGENTS.md 和 customer-deployment-and-agent-handoff.md，再动作。

你的任务是：
1. 先做只读安全检查，确认包内没有生产密钥、原项目 ID、原域名、原用户数据和生成媒体。
2. 列出需要我在安全网页或服务器本机填写的配置，不要要求我把 Secret 发到对话里。
3. 用我的 EdgeSpark 项目、域名、阿里云 OSS、渲染服务器和三方账号完成部署。
4. 保持“普通用户在前端自己配置 DeepSeek、益民居·数字人、ImageGen Key”的架构，不要改成全平台共用一个 Key。
5. 微信支付必须使用我自己的商户资料二次接入；当前 checkout 只是占位，不得假装已可收款。
6. 完成后运行类型检查、测试、构建和真实浏览器验收，然后只提交不含密钥的源码到我的私有 Git 仓库。
```
