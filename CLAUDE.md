# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Memos 是一个现代化的开源自托管知识管理和笔记平台。采用 Go 后端 + React/TypeScript 前端的前后端分离架构，基于 gRPC/gRPC-Gateway 提供 API 服务,支持 SQLite/PostgreSQL/MySQL 三种数据库。

**当前分支**: `menu` (基于 `main` 分支进行二次开发)
**二次开发目标**: 扩展菜单模块和 Webhook 通知功能 (详见 `memos二次开发计划.md`)
**Go 版本**: 1.25+ (见 go.mod)
**Node 版本**: 推荐 20.x+ (前端开发)

## 核心架构

### 后端架构 (Go)

```
bin/memos           # CLI 入口,启动 HTTP/gRPC 服务器
server/             # 核心服务器逻辑
  ├── server.go     # 服务器初始化,Echo + gRPC 双协议支持 (使用 cmux 多路复用)
  ├── router/       # 路由层
  │   ├── api/v1/   # gRPC 服务实现 (通过 gRPC-Gateway 同时提供 REST API)
  │   ├── frontend/ # 前端静态资源服务
  │   └── rss/      # RSS 订阅路由
  ├── runner/       # 后台任务 (如 S3 预签名)
  └── profiler/     # 性能分析 (仅 dev 模式)

store/              # 数据持久化层 (抽象层,支持多数据库)
  ├── db/           # 数据库连接和迁移
  ├── migration/    # 数据库迁移脚本 (SQLite/MySQL/Postgres 三库同步)
  └── *.go          # 数据访问对象 (DAO) 实现

internal/           # 共享内部逻辑
  ├── profile/      # 配置文件管理
  ├── util/         # 工具函数
  └── version/      # 版本信息

proto/              # Protocol Buffers 定义
  ├── api/v1/       # gRPC 服务定义 (使用 Buf 管理)
  ├── store/        # 数据存储结构定义
  └── gen/          # 生成的代码 (不要手动编辑)

plugin/             # 扩展插件 (如 webhook)
```

**关键设计模式**:
- **API-First**: 所有功能通过 gRPC 定义,自动生成 REST API
- **分层架构**: router → service (server/) → store (DAO)
- **数据库抽象**: store 层屏蔽具体数据库差异
- **事件驱动**: Webhook 等通知通过事件触发机制解耦

### 前端架构 (React/TypeScript)

```
web/
  ├── src/
  │   ├── components/  # 可复用组件
  │   ├── pages/       # 页面视图
  │   ├── stores/      # MobX 状态管理
  │   ├── helpers/     # 工具函数
  │   ├── i18n/        # 国际化翻译 (en/zh-Hans)
  │   └── types/       # TypeScript 类型定义
  ├── public/          # 静态资源
  └── dist/            # 构建输出 (由 vite 生成)
```

**技术栈**:
- 构建工具: Vite
- 状态管理: MobX + mobx-react-lite
- 路由: react-router-dom v7
- UI 库: Radix UI + Tailwind CSS v4
- 国际化: i18next
- Markdown: 自定义解析器 (`@usememos/gomark`)

## 常用开发命令

### 后端 (Go)

```bash
# 开发模式启动 (默认端口 8081,SQLite)
go run ./bin/memos --mode dev --port 8081

# 编译二进制 (Windows)
go build -o memos.exe ./bin/memos

# 编译二进制 (Linux/Mac)
go build -o memos ./bin/memos

# 运行测试
go test ./...

# 运行后端测试 (包含 store 层测试)
go test -v ./server/... ./store/...

# 运行单个测试文件
go test -v ./store/menu_test.go

# 代码检查 (需要 golangci-lint)
golangci-lint run

# 整理依赖
go mod tidy
```

**环境变量** (可选):
- `MEMOS_MODE`: 运行模式 (`dev`/`prod`)
- `MEMOS_PORT`: 服务端口
- `MEMOS_DATA`: 数据目录 (存储 SQLite 数据库和上传文件)
- `MEMOS_DRIVER`: 数据库驱动 (`sqlite`/`mysql`/`postgres`)
- `MEMOS_DSN`: 数据库连接字符串

### 前端 (React)

```bash
cd web

# 安装依赖 (使用 pnpm)
pnpm install

# 开发模式 (热重载,代理到后端 8081)
pnpm dev

# 生产构建 (输出到 web/dist/)
pnpm build

# 发布构建 (输出到 server/router/frontend/dist/)
pnpm release

# 类型检查 + 代码检查
pnpm lint
```

### Protocol Buffers

```bash
# 安装 buf (需要先安装)
# https://buf.build/docs/installation

# 生成代码 (在 proto/ 目录下)
cd proto
buf generate
```

## 数据库迁移

**三库同步原则**: SQLite/MySQL/Postgres 迁移必须同步实现。

迁移文件位置:
```
store/migration/
  ├── prod/           # 生产迁移 (按版本号命名)
  │   ├── 0.10/
  │   ├── 0.11/
  │   └── ...
  └── dev/            # 开发迁移 (最新改动)
```

**新增表的步骤**:
1. 在 `store/migration/dev/` 创建迁移文件 (参考现有文件)
2. 同时编写 SQLite/MySQL/Postgres 三种 DDL
3. 在 `store/` 下创建对应的 DAO 文件 (如 `menu.go`)
4. 定义数据结构和 CRUD 方法
5. 添加单元测试 (`menu_test.go`)

**约束**:
- 使用通用 SQL 类型 (避免数据库特定语法)
- 时间戳统一使用 `INTEGER` (Unix timestamp)
- 外键约束需要考虑 SQLite 的兼容性
- 索引命名遵循 `idx_<table>_<column>` 格式

## 代码风格规范

### Go 代码

- **格式化**: 使用 `gofmt` (tabs 缩进,自动导入分组)
- **包命名**: 全小写,单数形式 (如 `store`,`server`)
- **错误处理**: 使用 `pkg/errors` 包,wrap 错误时携带上下文 (`errors.Wrap(err, "context")`)
- **Context 传递**: 所有数据库操作和外部调用必须传递 `context.Context`
- **日志**: 使用 `log/slog` 结构化日志

**示例**:
```go
// 错误处理
if err != nil {
    return nil, errors.Wrap(err, "failed to create menu")
}

// 数据库操作
func (s *Store) CreateMenu(ctx context.Context, menu *Menu) error {
    // ...
}
```

### TypeScript/React 代码

- **格式化**: 使用 Prettier (配置见 `web/.prettierrc.js`)
- **命名约定**:
  - 组件文件: PascalCase (`MenuListView.tsx`)
  - Hook 文件: camelCase (`useMenu.ts`)
  - 工具函数: camelCase (`formatDate.ts`)
- **组件风格**: 函数组件 + Hooks
- **状态管理**: MobX stores (全局状态) + 组件本地 state
- **样式**: Tailwind CSS 工具类优先

**示例**:
```tsx
// 组件
export const MenuCard: React.FC<{ menu: Menu }> = ({ menu }) => {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-bold">{menu.title}</h3>
    </div>
  );
};

// Hook
export const useMenuList = () => {
  const [menus, setMenus] = useState<Menu[]>([]);
  // ...
};
```

## 国际化 (i18n)

所有用户可见文本必须使用 i18n 键。

**添加新文本的步骤**:
1. 在 `web/src/i18n/locales/en.json` 添加英文键值
2. 在 `web/src/i18n/locales/zh-Hans.json` 添加中文翻译
3. 组件中使用 `useTranslate()` hook

**示例**:
```tsx
// i18n/locales/en.json
{
  "menu": {
    "title": "Menu",
    "create": "Create Menu"
  }
}

// i18n/locales/zh-Hans.json
{
  "menu": {
    "title": "菜单",
    "create": "创建菜单"
  }
}

// 组件中使用
const t = useTranslate();
<button>{t("menu.create")}</button>
```

## 新增 API 端点的流程

**完整流程** (API-First):

1. **定义 Proto**:
   ```protobuf
   // proto/api/v1/menu_service.proto
   service MenuService {
     rpc ListMenus(ListMenusRequest) returns (ListMenusResponse) {
       option (google.api.http) = {
         get: "/api/v1/menus"
       };
     }
   }
   ```

2. **生成代码**:
   ```bash
   cd proto && buf generate
   ```

3. **实现 Store 层**:
   ```go
   // store/menu.go
   func (s *Store) ListMenus(ctx context.Context) ([]*Menu, error) {
     // 数据库查询
   }
   ```

4. **实现 Service 层**:
   ```go
   // server/router/api/v1/menu_service.go
   func (s *APIV1Service) ListMenus(ctx context.Context, req *v1pb.ListMenusRequest) (*v1pb.ListMenusResponse, error) {
     menus, err := s.Store.ListMenus(ctx)
     // ...
   }
   ```

5. **注册服务**:
   ```go
   // server/router/api/v1/api.go (或 menu_service.go)
   func (s *APIV1Service) registerMenuService() {
     v1pb.RegisterMenuServiceServer(s.GrpcServer, s)
   }
   ```

6. **前端调用**:
   ```typescript
   // web/src/stores/v1/menu.ts
   const { data } = await menuServiceClient.listMenus({});
   ```

## 二次开发注意事项

参考 `memos二次开发计划.md` 的修订版 v2:

### Webhook 模块 (当前重点)
- **沿用现有实现**: 使用 `UserSetting.WEBHOOKS`,不新增独立表
- **API 路径**: `/api/v1/{parent=users/*}/webhooks` (现有路径)
- **安全加固**:
  - SSRF 防护 (IP 黑名单,DNS 二次校验)
  - 可选 HMAC-SHA256 签名 (`X-Memos-Signature`)
  - 指数退避重试,并发限流,熔断机制
- **多类型支持**: RAW/WeCom/Bark (通过 `url` 前缀区分或 `title` 约定)
- **实现位置**: `plugin/webhook/` 目录

### 菜单模块 (MVP 阶段)
- **MVP 优先**: 先用前端拼装"订单 Memo"验证需求 (标签 `#order`)
- **正式建模**: 验证有价值后再新增 `menu_service.proto` 和数据库表
- **权限设计**: 遵循 `users/{user}/menus/{menu}` 资源命名风格
- **实现位置**:
  - 前端: `web/src/pages/MenuOrdersView.tsx` (MVP)
  - 后端: 待正式建模后在 `server/router/api/v1/` 添加

### 通用原则
- **最小侵入**: 新功能尽量作为可选模块,不影响核心流程
- **向后兼容**: 数据库迁移必须支持现有实例平滑升级
- **测试覆盖**: 新增代码必须有单元测试和集成测试
- **Git 工作流**: 基于 `menu` 分支开发,定期从 `main` 合并更新

## 提交规范

遵循 Conventional Commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型**:
- `feat`: 新功能
- `fix`: 修复 bug
- `chore`: 构建/工具链变更
- `docs`: 文档更新
- `refactor`: 重构
- `test`: 测试相关

**示例**:
```
feat(server): add menu service API endpoints

- Implement ListMenus, CreateMenu, GetMenu RPCs
- Add menu store layer with SQLite/MySQL/Postgres migrations
- Add unit tests for menu CRUD operations

Closes #123
```

## 依赖管理

### Go 模块
```bash
# 添加依赖
go get github.com/example/package

# 更新依赖
go get -u ./...

# 整理依赖
go mod tidy
```

### 前端依赖
```bash
cd web

# 添加依赖
pnpm add <package>

# 添加开发依赖
pnpm add -D <package>

# 更新依赖
pnpm update
```

## 常见问题

### 1. Proto 生成代码不更新
```bash
# 清理缓存并重新生成
rm -rf proto/gen
cd proto && buf generate
```

### 2. 前端代理配置
开发模式下前端代理到后端,配置在 `web/vite.config.mts`:
```typescript
server: {
  proxy: {
    '/api': 'http://localhost:8081',
  }
}
```

### 3. 数据库迁移失败
- 检查 `store/migration/` 中的 SQL 语法
- 确保三种数据库 (SQLite/MySQL/Postgres) 都有对应实现
- 使用 `go test ./store/...` 验证迁移逻辑

### 4. gRPC 和 REST API 同时提供
通过 `grpc-gateway` 实现:
- gRPC 定义中添加 `google.api.http` 注解
- 自动生成对应的 REST 端点
- 示例: `GET /api/v1/memos` 映射到 `ListMemos` RPC

### 5. Windows 开发环境注意事项
- 路径分隔符: Go 代码使用 `filepath` 包处理跨平台路径
- 构建输出: Windows 生成 `.exe` 文件
- 换行符: 配置 Git 使用 `core.autocrlf=true`

## 参考资源

- **项目主页**: https://www.usememos.com
- **文档**: https://www.usememos.com/docs
- **API 文档**: 启动服务后访问 `/api/v1/*` (gRPC-Gateway 自动路由)
- **开发计划**: `memos二次开发计划.md`
- **安全政策**: `SECURITY.md`
- **菜单功能文档**: `docs/menu.md`
- **分支差异说明**: `docs/menu-branch-diff.md`
