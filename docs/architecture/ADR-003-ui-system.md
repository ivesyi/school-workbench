# ADR-003: UI System and Visual Language

**状态：Accepted**  
**日期：2026-08-17**  
**适用版本：Workbench V0.1+**

## Context

Workbench 的唯一主要用户是学校变革陪跑顾问。产品必须支持“说情况、做判断、看变化”，而不是展示数据库结构或形成复杂管理后台。UI 技术栈已经包含 React、Tailwind CSS 和 shadcn/ui，但缺少组件准入、视觉 Token 与复杂度约束。

## Decision

采用 **Quiet Workbench** 视觉语言：浅色、低装饰、单强调色、结论优先、细节按需展开。

```text
React 19 + TypeScript + Vite
Tailwind CSS 4 theme variables
shadcn/ui source-owned components
Radix accessibility primitives
Lucide icons
React Router
Zod at IPC and input boundaries
```

V0.1 不把 React Hook Form 作为必需依赖。Zustand 只有出现真实跨页面临时 UI 状态时才引入，且不得镜像正式业务状态。

## Visual Tokens

```text
background   #F7F7F5
surface      #FFFFFF
foreground   #20221F
muted        #6F746E
border       #E3E5E1
primary      #2F6F68
destructive  #B44343
radius       8px
control      40px
```

使用系统中文字体。V0.1 只提供浅色主题；Token 保持可扩展。禁止渐变、玻璃拟态、装饰性大阴影、复杂页面转场和无业务意义的数据图表。

## Component Governance

shadcn/ui 固定采用 `new-york` 风格、`neutral` 基色和 Radix primitives。禁止一次性添加全部组件或展示型 Blocks。首个纵切只允许按需引入：Button、Input、Textarea、Dialog、Separator、Alert、Skeleton。

```text
packages/experience/src/components/ui/          基础组件
packages/experience/src/components/workbench/   领域体验组件
apps/desktop/src/renderer/features/              页面组合
```

功能代码不得直接使用具体色阶表达业务语义；必须使用 `background`、`foreground`、`primary`、`destructive` 等 Token。主要动作使用文字标签，图标不能成为含义不明确的唯一入口。

## Interaction Rules

- 全局只有“学校”和“设置”两个一级入口；
- 新建学校只有学校名称一个字段；
- 核心任务最多三次主要交互即可开始；
- 空状态必须告诉用户下一步能做什么；
- 技术错误必须翻译成用户语言；
- 动画仅用于状态反馈，时长 120–180ms，并尊重 reduced motion；
- 默认不展示 ACP、MCP、Runtime、Token、数据库或内部状态名。

## Consequences

组件数量和视觉自由度被主动限制，以换取一致性、可理解性和较低维护成本。新增组件库、图表库、主题或高密度布局必须由真实工作流证明，并通过新的 ADR 或本 ADR 修订。
