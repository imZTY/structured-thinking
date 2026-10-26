# 新主题模板

最省事的做法:`npm run dev`,点左下角 `＋` 新建主题,直接在页面里写,改动自动写回 `content/`。

要手写或让 AI 生成,就复制本目录:

1. **复制**:`cp -r content/topics/_template content/topics/<your-topic-id>`(id 用小写 kebab-case,和 `topic.json` 里的 `id` 一致)
2. **填写**:删掉 `（…）` 占位。必填只有根节点的 `expr`
3. **登记**:在 `content/manifest.json` 的 `topics` 数组追加一项(数组顺序 = tab 顺序)
4. **校验**:`npm run validate`

## 一个主题长什么样

一个主题就是一条核心公式。公式右边的每个词都可以展开成它自己的公式,层级不限。

```json
"root": {
  "expr": "成功 = 能力 × 机会",
  "terms": {
    "能力": { "expr": "能力 = 知识 + 经验" }
  }
}
```

- `expr` 是一行文本 `左边 = 右边`。右边按 `+ − × ÷ ( )` 切成词,每个词都是可展开的锚点
- `terms` 以词为键,存放这个词的子节点。键必须出现在本节点 `expr` 的右边
- 子公式的左边必须等于它在父公式里的词(`能力 = …` 对应父公式里的 `能力`)
- 没有 `expr` 的词就是叶子,可以带说明或行动

## 字段速查

| 字段 | 说明 |
|---|---|
| `expr` | 公式。根节点必填;其余节点有它 = 这个词被展开了 |
| `terms` | `{ 词: 子节点 }` |
| `question` / `note` / `details` | 认知层:本质问题 / 短说明 / 长文(markdown)。在认知模式下编辑 |
| `actions` | 行动层:`{ kind, text, status? }`。`kind` 约定 `action`(抓手)/ `idea`(想法)。在行动模式下编辑 |
| `id` | 可选。只有被别处 `links` 引用时才需要 |
| `links` | 跨分支关联 `{ to, rel? }`,`to` 是目标节点的 `id` |
| `refs` | 参考资料 `{ label, url? }` |
| `meta` | 自由字段,渲染器不解释 |

公式文法与全部校验规则见 `docs/mvp/content-standard.md`。
