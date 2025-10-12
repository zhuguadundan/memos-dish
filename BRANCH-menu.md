**分支目的**
- 面向家庭分享的“菜单 + 点菜 + 订单统计”一体化能力：本地定义菜单，工作区共享发布公开菜单，支持匿名下单与订单汇总；并增强 Webhook 通知（WeCom/Bark/RAW）用于到单提醒。
- 与上游保持最小侵入：新增公开 API 与前端页面，复用原有 Memo/附件能力；不改动数据库结构。

**核心改动**
- 后端 API
  - 新增公开查询与匿名下单接口（Echo 路由注册见 `server/router/api/v1/v1.go:127`、`server/router/api/v1/v1.go:131`）：
    - `GET /api/public/menu`：按 `publicId`（可选 `memo` 资源名）获取公开菜单的 Memo（正文或 JSON 附件）。实现见 `server/router/api/v1/public_menu_get.go`。
    - `POST /api/public/menu-order`：匿名创建订单 Memo（代菜单创建者）。实现见 `server/router/api/v1/public_menu_order.go`。
  - 新增 Webhook 测试端点：`POST /api/v1/webhooks:test`（实现见 `server/router/api/v1/webhook_test_endpoint.go`）。
  - 订单文本解析与精简：在通知侧抽取“点菜人/时间/菜品”用于推送摘要，实现在 `server/notification/util.go:96`（`buildOrderSummary`）与 `server/notification/util.go:170`（`buildOrderText`）。
  - Webhook 派发增强：
    - 避免使用请求上下文，分别以 `10s`/`30s` 后台超时获取用户配置与发送通知，稳定送达（`server/notification/service.go`）。
    - 更全面的 Bark 自建识别与 JSON `/push` 首选；支持 `MEMOS_BARK_FORCE_GET=true` 强制退回 GET 方式（`server/notification/notifier_bark.go`）。
  - 前端静态路由兜底修复：`server/router/frontend/frontend.go:34` 在未命中时回退原始 URL Path，避免 SPA 首屏 404。
- 前端路由与页面
  - 新增公开点菜页：`/menu/public/:publicId`（`web/src/router/index.tsx:44`，页面实现 `web/src/pages/PublicMenuOrder.tsx`）。
  - 管理端菜单增强页：`web/src/pages/MenuEnhanced.tsx`（替换菜单入口渲染，原 `MenuMVP` 保留为基础版）。
  - 订单统计视图增强：`web/src/components/MenuOrdersView.tsx` 支持多种订单格式解析、金额汇总与测试下单。
  - UI 组件：新增 `web/src/components/ui/card.tsx`。
  - 设置-Webhook 增强：添加“测试”按钮，直连上述测试端点（`web/src/components/Settings/WebhookSection.tsx`）。
- 其他
  - 构建与开发：新增 `Dockerfile`、`.dockerignore` 与 Windows 开发脚本（`scripts/dev-backend.cmd`、`scripts/dev-frontend.cmd`、`scripts/start-frontend.ps1`）。
  - 文案与 i18n 细节调整：`web/src/locales/en.json` 若干“不可恢复”提示语句收敛。

**数据与格式约定**
- 菜单发布（公开）：
  - 正文内 `#menu-pub` + JSON 代码块（或超长时走 JSON 附件），结构示例：
    ```json
    {
      "version": 1,
      "kind": "menu-public",
      "publicId": "<随机ID>",
      "id": "menu-xxx",
      "name": "店内菜单",
      "items": [{"id":"i-1","name":"宫保鸡丁","image":"data:image/..."}],
      "allowOrder": true
    }
    ```
- 订单 Memo（示例，支持多种格式解析）：
  - 公共下单：
    ```text
    🍽️ 点菜订单 #order #menu-<publicId>

    点菜人：张三
    时间：2025-01-02 12:34:56
    来源菜单：<publicId>

    已选菜品：
    ✅ 宫保鸡丁 × 2份
    ✅ 鱼香肉丝 × 1份
    ```
  - 基础版（带价格）：`- 宫保鸡丁 × 2 × ¥25 = ¥50.00` 或旧格式 `- name:"宫保鸡丁" qty:2 price:25`
  - 解析与汇总参见 `web/src/components/MenuOrdersView.tsx` 与 `server/notification/util.go`。

**API 设计说明**
- `GET /api/public/menu`
  - 入参：`publicId`（必填），`memo`（选填，资源名 `memos/<uid>` 或 `workspaces/<id>/memos/<uid>`）。
  - 行为：优先按 `memo` 精确校验公开性与 `publicId`；否则分页扫描公开 Memo（≤5×50）。返回 v1.Memo JSON（正文/附件由前端自解）。
- `POST /api/public/menu-order`
  - 入参：`{ memo?:string, publicId:string, customerName:string, note?:string, items:[{itemId,name,quantity}] }`
  - 行为：按公开菜单备忘录的创建者代创建一条公开订单 Memo，并尝试派发 Webhook；返回 `{name}`（订单 Memo 资源名）。
  - 备注：内容长度与工作区限制沿用系统设置；正文构造与前端一致。

**安全与风险评估（需重点关注）**
- 未经认证下单能力：
  - 该设计允许任何持有公开链接的人匿名创建订单，对应 Memo 的 `CreatorID` 为菜单创建者。建议：
    - 对 `/api/public/menu-order` 增加最小限度的频控（IP/设备/滑动窗口）与可选验证码；
    - 后续考虑在公开菜单中附带 HMAC 签名参数，服务端验签后接受（抗枚举与批量攻击）。
- Webhook 测试端点访问控制：
  - 当前 `POST /api/v1/webhooks:test` 未强制校验登录态，任意请求只要知道 `name` 即可触发目标用户 Webhook。强烈建议：在 `server/router/api/v1/webhook_test_endpoint.go` 校验“当前用户必须为该 Webhook 所属用户或管理员”。
- gRPC v1 多处移除了 `user == nil` 检查：
  - `CreateMemo/UpdateMemo/DeleteMemo/Attachment/Reaction/User/Workspace` 等服务存在通过 `user.ID` 继续分支的写法，一旦未登录会造成 500 或 panic，而非 401/403。建议恢复“未认证即返回 Unauthenticated/PermissionDenied”的显式判断，以提升可预期性与安全边界。
- 公开 Memo 扫描：
  - 当前限制为 `≤5×50`，对性能影响很小；若公开内容量级上升，建议增加按标签/全文索引过滤或引入“publicId → memo”轻量映射缓存。

**部署与使用**
- 本地开发
  - 后端：`go run ./bin/memos --mode dev --port 8081`
  - 前端：`cd web && pnpm install && pnpm dev`（或使用 `scripts/start-frontend.ps1`）。
- Docker 打包
  - `docker build -t memos-menu .`
  - `docker run --rm -p 8081:8081 memos-menu`
- 配置
  - Bark：默认优先 JSON `/push`，可通过环境变量 `MEMOS_BARK_FORCE_GET=true` 强制 GET 路径式便于排障（`server/notification/notifier_bark.go`）。

**验证清单**
- 菜单发布
  - 管理端（登录）在“菜单”页发布公开菜单；超长内容自动走 JSON 附件（`web/src/pages/MenuEnhanced.tsx`）。
- 公开获取
  - 访问 `GET /api/public/menu?publicId=<id>`（可带 `memo` 精确）能返回 Memo；前端能解析正文/附件两种模式。
- 匿名下单
  - 公开页 `/menu/public/<publicId>` 选择菜品并提交，登录失败时自动走匿名下单兜底；后台生成订单 Memo 且可在统计页看到汇总。
- Webhook 通知
  - 设置里对用户 Webhook 点“测试”，分别验证 RAW/WeCom/Bark 收到消息；订单真实创建时推送消息为精简摘要。

**回滚/灰度建议**
- 以路由开关为界：
  - 若需临时关闭匿名下单，仅禁用 `gwGroup.POST("/api/public/menu-order", ...)` 与前端入口；保留公开查询接口以兼容旧链接。
  - Webhook 测试端点建议默认仅对登录态放行，必要时在网关层加白名单。

**已知事项与后续优化**
- 一致性与错误语义：建议恢复 gRPC v1 层的未认证判定，避免 `user == nil` 间接导致 500。
- Webhook 测试端点需加权限校验与频控；匿名下单建议引入频控与可选验证码/签名。
- 仓库中存在 `server/router/frontend/dist/index.html` 构建产物提交，建议移除并依赖前端 `release` 流程。
- Windows 终端显示中文有时出现乱码“�?”，源码为 UTF-8 不影响功能；若在 UI 中仍可见，请统一编码与字体。

**变更清单（相对 main）**
- 后端：
  - `server/router/api/v1/public_menu_get.go`
  - `server/router/api/v1/public_menu_order.go`
  - `server/router/api/v1/v1.go:127`（Webhook 测试）/`server/router/api/v1/v1.go:131`（公开接口）
  - `server/notification/service.go`、`server/notification/notifier_bark.go`、`server/notification/util.go:96`、`server/notification/util.go:170`
  - `server/router/frontend/frontend.go:34`
- 前端：
  - `web/src/router/index.tsx:44`、`web/src/pages/PublicMenuOrder.tsx`、`web/src/pages/MenuEnhanced.tsx`、`web/src/pages/MenuMVP.tsx`
  - `web/src/components/MenuOrdersView.tsx`、`web/src/components/Settings/WebhookSection.tsx`、`web/src/components/ui/card.tsx`
  - 删除 `web/src/components/ConfirmDialog/*`
- 其他：`Dockerfile`、`.dockerignore`、`scripts/*`、`web/src/locales/en.json`

— 以上为 menu 分支的总体说明与评审要点，建议按“安全项 > 功能项 > 体验项”的顺序推进修订与验收。

