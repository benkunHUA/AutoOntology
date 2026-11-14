# AutoOntology

Node.js 编程智能体 —— 核心 agent loop 的 TypeScript 实现，CLI 优先。

设计来源：`docs/agent-loop-outline-design.md`、`docs/agent-loop-detail-design.md`；
架构与选型决策：`docs/architecture-and-selection.md`。

## 快速开始

```bash
pnpm install

# 离线体验（内置 mock 模型，无需密钥）：
pnpm cli:mock

# 对接真实模型（OpenAI Responses API）：
export OPENAI_API_KEY=sk-...
export AO_MODEL=gpt-5-codex        # 可选
pnpm cli
```

REPL 操作：直接输入即提交；回合进行中输入会自动「插话」；
`/abort` 中断当前回合；`/quit` 退出。会话历史以 JSONL 追加写入 `.ao/sessions/`。

## 技能（Skills）

Skill 是可发现、按需加载的指令包：系统扫描目录中的 `SKILL.md`，把可用技能
目录注入模型上下文；输入 `$skill-name` 会按需读取并注入对应正文。可用工具：
`skills.list` 与 `skills.read`。

- 默认扫描根：`<cwd>/.ontology/skills`。
- `SKILL.md` 需要 YAML frontmatter（`name`、`description`，可选 `short-description`）。
- 产品过滤默认 `codex`；设置 `AO_SKILLS=0` 可关闭技能注入。

## 工程结构

```
packages/
├── protocol/   契约层：历史条目、采样/会话事件、工具接口（零依赖）
├── api/        采样层：SSE 解析、Responses 客户端、重试、Mock
├── core/       引擎层：提交循环、回合、工具调度、持久化、扩展钩子
├── tools/      工具层：exec_command / read_file / write_file / list_dir
└── cli/        客户端：REPL + 事件渲染
```

依赖方向严格单向：`cli → core → api → protocol`，`core → tools` 仅经
`protocol` 的接口。

## 开发

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
```

无运行时第三方依赖；devDeps 仅 typescript / tsx / vitest / @types/node。
