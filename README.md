# structured-thinking

轻量、简洁、可拓展的**结构化思维**浏览器工具。思考的主体是公式:一条公式的每个词都能展开成它自己的公式,公式拆公式,层级不限。内容即 JSON,本项目只负责渲染和编辑,并定义内容的标准。

```
稳定性 = 结果指标 + 过程指标
  结果指标 = 可用性 + 容量水位
    可用性 = MTBF ÷ (MTBF + MTTR)
      MTTR = 感知时间 + 响应时间 + 止损时间 + 定位时间 + 修复时间
```

- **推导式视图**:点公式里的词,它的公式铺在这一行下方。纯文本公式,系统自动把右边切成词
- **认知 / 行动两种模式**:白天是认知模式,只能展开和改公式;黑夜是行动模式,公式只读,只能往词上挂抓手和想法
- **本地编辑,自动写回**:`npm run dev` 下直接在页面里改,内容写回 `content/` 下的 JSON,可撤销重做
- 左下角 Excel 风格的 tab,一个 tab 一个主题
- 黑白墨线风格,可安装为 PWA。线上部署是只读的

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173/structured-thinking/ ,可编辑
```

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发服务,带写回接口 |
| `npm run validate` | 按标准校验 `content/` 下全部内容 |
| `npm test` | 单元测试(公式解析、模型编辑、状态、路由) |
| `npm run build` | 类型检查 + 生产构建,输出 `web/dist/`(只读站点) |
| `npm run preview` | 预览生产构建 |

## 目录结构

```
content/     内容(数据):manifest.json + topics/<id>/topic.json
schema/      内容标准:JSON Schema、公式文法、校验逻辑(校验器与渲染器共用)
scripts/     内容校验器(npm run validate)
web/         渲染器:src/core(纯逻辑,零 DOM)+ src/ui(DOM 薄适配层)
docs/mvp/    本迭代的战略、范围与选型记录、内容标准、验收清单
```

## 贡献一个主题

最省事:`npm run dev` 后点左下角 `＋` 直接在页面里写。

手写或让 AI 生成:

1. 复制模板:`cp -r content/topics/_template content/topics/<your-topic-id>`
2. 按 [内容标准](docs/mvp/content-standard.md) 填写 `topic.json`,必填只有根节点的 `expr`
3. 在 `content/manifest.json` 的 `topics` 数组追加一项(数组顺序即 tab 顺序)
4. `npm run validate` 通过后提 PR,CI 会再校验一遍

`topic.json` 是单文件自包含的,把[内容标准](docs/mvp/content-standard.md)连同你的主题要求交给 AI,再用校验器兜底即可。

## 设计取向

- **标准先行**:内容 JSON 标准是核心资产,渲染器只是它的一个参考实现。标准不含任何渲染信息,换成 3D 或架构图不需要改标准。
- **公式是主体**:结构完全由公式文本决定,校验器保证 `terms` 和公式不会不一致。
- **渲染克制**:运行时只依赖 `marked`,无 UI 框架,约 25KB gzip。
- **纯核架构**:`web/src/core` 不碰 DOM,将来移植到其他端只需要重写 `ui` 层。

详见 [战略与范围](docs/mvp/strategy-and-scope.md)。

## License

MIT
