# structured-thinking

轻量、简洁、可拓展的**结构化思维**浏览器工具。思考的主体是公式：一条公式的每个词都能展开成它自己的公式，公式拆公式，层级不限。内容即 JSON，本项目只负责渲染和编辑，并定义内容的标准。

## 项目核心事实

- **标准先行**：内容 JSON 标准（`docs/mvp/content-standard.md`）是核心资产，渲染器（`web/`）只是它的一个参考实现。标准不含任何渲染信息。
- **公式是主体**：结构完全由公式文本（`expr`）决定，`terms` 只补充每个词的内容，二者的一致性由校验器保证。
- **两层分离**：认知层（`expr` / `question` / `note` / `details`）回答「这件事由什么构成」；行动层（`actions`）回答「针对这个词可以做什么」。认知与行动在数据里是不同字段、在界面里是互斥模式。
- **纯核架构**：`web/src/core` 零 DOM，`schema/formula.mjs` 是公式文法的唯一实现，校验器与渲染器共用。

## 目录结构

```
content/     内容(数据)：manifest.json + topics/<id>/topic.json（一个主题一个目录，单文件自包含）
schema/      内容标准：JSON Schema、公式文法、校验逻辑
docs/mvp/    本迭代的战略、范围与选型记录、内容标准、验收清单
docs/adr/    架构决策记录(ADR)——语义建模的判定标准与踩坑沉淀，见下节
```

## ⚠️ 修改或新增内容前，必读 ADR 目录

**任何涉及 `content/` 下内容的修改或新增（新主题、改公式、加节点、注访谈/调研结论、清算 actions），必须先通读 `docs/adr/` 目录下的全部 ADR 文档，并以其判定标准和纪律为准。**

ADR 目录沉淀的是内容标准（管数据合法性）管不到的**语义合理性**标准，均由真实踩坑总结而来，主要包括：

- 公式的合法性判定标准（加法/乘法/除法各自的语义规则、MECE 检验、修复模式）
- 外部结论（访谈、调研）注入认知框架时的分层原则（何时动公式、何时只写 note）
- 行动层（actions/ideas）的生命周期清算纪律
- 项目建模决策的取舍记录

ADR 是活文档：新的坑和标准会持续往目录里加。**判断依据以目录内最新内容为准，而不是依赖这里枚举的清单**——所以引用一律指向 `docs/adr/` 目录整体，通读即可，不需要（也不要）在这里维护逐文件的链接。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发服务（可编辑，自动写回 `content/`） |
| `npm run validate` | 按标准校验 `content/` 下全部内容——**每次改内容后必须跑** |
| `npm test` | 单元测试（公式解析、模型编辑、状态、路由） |
| `npm run build` | 类型检查 + 生产构建 |

## 内容贡献要点

- 新主题：`cp -r content/topics/_template content/topics/<kebab-case-id>`，填 `topic.json`（根节点必填 `expr`），在 `content/manifest.json` 的 `topics` 数组登记（数组顺序即 tab 顺序），`npm run validate` 通过。
- 节点字段封闭（不允许未知字段，自由扩展放 `meta`）；`kind` / `status` / `rel` 是开放词汇。
- 主题参考材料可放 `content/topics/<id>/reference/`（注意：`refs[].url` 只允许 http/https/mailto，本地文件不能进 refs，来源信息写进 `meta.provenance`）。
- 详细格式见 `docs/mvp/content-standard.md`。
