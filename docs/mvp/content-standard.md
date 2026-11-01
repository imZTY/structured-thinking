# 内容标准 (Content Standard) v1

本项目定义内容的标准,渲染器只是它的一个参考实现。所有内容都是 `content/` 下的 JSON,与 `web/` 里的代码完全解耦。按本标准写出合法 JSON(人写或 AI 生成),就能为站点贡献一个新主题。

校验器是本标准的机器可读形态:`npm run validate`。公式文法的唯一实现是 `schema/formula.mjs`,校验器和渲染器共用它。

## 1. 核心模型

一个主题就是一条核心公式。公式右边的每个词都能展开成它自己的公式,层级不限:

```
稳定性 = 结果指标 + 过程指标
  结果指标 = 可用性 + 容量水位
    可用性 = MTBF ÷ (MTBF + MTTR)
```

内容分两层,在数据里是不同的字段,在界面里是互斥的两种模式:

| 层 | 字段 | 回答 | 界面模式 |
|---|---|---|---|
| 认知层 | `expr` `terms` `question` `note` `details` | 这件事由什么构成 | 认知模式(白天主题),可编辑 |
| 行动层 | `actions` | 针对这个词,可以做什么 | 行动模式(黑夜主题),认知层只读 |

认知模式下看不到行动层,行动模式下改不了公式。这是刻意的约束:先想清楚,再谈办法。

## 2. 目录结构

```
content/
├── manifest.json            # 主题列表与顺序(tab 顺序即数组顺序)
└── topics/
    ├── _template/           # 新主题模板(以 _ 开头的目录不是主题)
    ├── stability-governance/
    │   └── topic.json       # 一个主题 = 一个目录 + 一个 topic.json
    └── ai-knowledge-base/
        └── topic.json
```

- 主题目录名 = 主题 id:小写 kebab-case(`^[a-z0-9]+(-[a-z0-9]+)*$`)
- 一个主题一个 `topic.json`,单文件自包含,方便 PR 审阅和 AI 一次生成。将来文件过大再引入分片,届时 bump `standard`
- 主题按需加载:切换 tab 时才请求对应的 `topic.json`

## 3. manifest.json

```jsonc
{
  "standard": 1,
  "title": "structured-thinking",
  "topics": [
    {
      "id": "stability-governance",                      // = 目录名,全局唯一
      "title": "稳定性治理",                               // tab 上的名称
      "path": "topics/stability-governance/topic.json",
      "order": 1                                          // 可选,留给外部工具
    }
  ]
}
```

## 4. topic.json

```jsonc
{
  "standard": 1,
  "id": "stability-governance",   // 必须与目录名一致
  "title": "稳定性治理全景框架",
  "subtitle": "……",                // 可选
  "summary": "一段 **markdown**",  // 可选,未选中任何词时显示在检查器
  "tags": ["SRE"],                 // 可选
  "expandDepth": 2,                // 可选,初始展开的公式层数,根公式算第 1 层,默认 2
  "meta": { "provenance": { "description": "基于与 DeepSeek 的对话整理", "date": "2026-10" } },
  "root": { /* 词节点,必须有 expr */ }
}
```

`meta` 是自由字段,渲染器不解释。约定键:`provenance`(内容来源)、`version` / `updated`。

## 5. 词节点 (TermNode)

一个节点就是公式里的一个词。树的根是主题的核心公式。

```jsonc
{
  "expr": "MTTR = 感知时间 + 响应时间 + 止损时间",   // 有 = 这个词被展开成了公式
  "question": "故障恢复得快不快?",                    // 认知层
  "note": "越短越好。**行业基准**:P0 < 30min",       // 认知层,短 markdown
  "details": "更长的 markdown 正文",                  // 认知层,长文
  "actions": [                                         // 行动层
    { "kind": "action", "text": "GOC 值班制度", "status": "doing" },
    { "kind": "idea",   "text": "能否按业务峰谷自动调整水位阈值?" }
  ],
  "id": "mttr",                                        // 可选,仅被 links 引用时需要
  "links": [{ "to": "alert-accuracy", "rel": "感知上限由它决定" }],
  "refs": [{ "label": "SRE 手册", "url": "https://example.com" }],
  "meta": { "benchmark": "P0 < 30min" },
  "terms": {                                           // 键 = 公式右边出现的词
    "感知时间": { "note": "从故障发生到告警触达" },
    "响应时间": { "actions": [ /* … */ ] }
  }
}
```

所有字段都可选,但根节点必须有 `expr`。节点对象不允许出现未知字段,自由扩展请放进 `meta`。

### 5.1 行动 (actions)

| 字段 | 必填 | 说明 |
|---|---|---|
| `kind` | 是 | 开放词汇。约定 `action`(抓手 / 方法)、`idea`(想法)。未知值按原文显示 |
| `text` | 是 | 内容 |
| `status` | 否 | 开放词汇。约定 `todo` / `doing` / `done`。界面只给 `action` 提供状态切换 |

## 6. 公式文法

公式是一行纯文本。选纯文本而不是富文本,是因为中文输入法加内嵌锚点极易出问题,而纯文本加解析既稳定又对 AI 友好。

```
expr := 左边 等号 右边
等号 := = | ＝ | ≈ | ≔        取第一个出现的
```

- 左边:去首尾空白;`[ … ]` 包裹时去掉方括号
- 右边:按下列规则切成词、运算符和数字三类片段,空白没有语义

| 片段 | 规则 |
|---|---|
| 运算符(任何位置) | `+` `＋` `×` `*` `÷` `(` `)` `（` `）` `−` `－` `,` `，` `、` `;` `；` |
| 运算符(仅当两侧都是空白或边界) | `-` `/`。所以 `A - B` 是减,`Wi-Fi` 和 `TCP/IP` 是一个词 |
| 手动成词 | `[ … ]` 内整体是一个词,方括号不显示。用于词里需要出现运算符时,如 `[A+B 型用户]` |
| 数字 | `1`、`0.5`、`60%` 是常量,不成词 |
| 词 | 其余连续文本,内部空白折叠为一个空格 |

显示时 `*` 画成 `×`,`/` 画成 `÷`,`-` 画成 `−`,全角括号和标点画成半角。

同一条公式里的同名词是同一个词,按首次出现去重,如 `MTBF ÷ (MTBF + MTTR)` 里的 `MTBF` 只对应一个子节点。不同公式里的同名词互相独立,不共享子树,所以数据始终是一棵树。

## 7. 校验规则

`npm run validate` 强制以下规则,开发服务的写回接口也走同一份校验,非法内容不会落盘:

1. 结构符合 `schema/topic.schema.json`、`schema/manifest.schema.json`
2. `topic.id` 等于目录名,且已登记在 manifest;manifest 的 `path` 指向存在的文件
3. 根节点必须有 `expr`,所有 `expr` 都能解析
4. 非根节点的 `expr` 左边必须等于它在父公式里的词(`terms` 的键)
5. `terms` 的每个键必须出现在本节点 `expr` 的右边;没有 `expr` 的节点不能有 `terms`
6. `id` 在主题内唯一;`links[].to` 必须指向存在的 `id`
7. `refs[].url` 必须以 `http://`、`https://` 或 `mailto:` 开头
8. `expandDepth` 不超过实际公式层数

可以把没有展开的词留空:`terms` 里不写它,它就只是公式里的一个词。

## 8. 设计原则

1. **公式是主体**。结构由公式文本决定,`terms` 只补充每个词的内容,二者不会出现不一致,校验器保证这一点。
2. **认知与行动分离**。两层字段互不依赖,可以分别审阅、分别生成。
3. **不含渲染信息**。数据里没有坐标、颜色、折叠状态,推导式视图、3D、架构图都能消费同一份数据。
4. **宽进严出**。`kind`、`status`、`rel` 是开放词汇,但节点字段是封闭的,拼错字段名会被校验器抓到,而不是静默丢失。

## 9. 版本化

`standard` 是主版本。破坏性变更必须 bump 并在下面追加记录。

| 版本 | 日期 | 变更 |
|---|---|---|
| 1 | 2026-10-25 | 公式模型:一个节点 = 公式里的一个词,`expr` + `terms`;认知层 / 行动层分离,新增 `actions`。取代 2026-10-24 的图模型草案(`title` / `type` / `children` / `combine` / `edges`)。MVP 尚在验收迭代中,因此没有 bump 版本号 |
