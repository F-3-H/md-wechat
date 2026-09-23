import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../src/lib/renderer.js'
import { themes } from '../src/lib/themes.js'

const base = { galleryMode: 'collage' }
const opts = (extra = {}) => ({ ...base, ...extra })

// 单元测试跑在 Node 里，没有 DOM 也就没有 MathJax：此时渲染器必须给出"占位态"，
// 而不是把公式源码当普通文本丢掉，也不能抛异常。真正的 SVG 由浏览器端验收覆盖。
const PENDING = 'data-math-pending="1"'

test('行内公式 $…$ 被识别为公式，而不是普通文本', () => {
  const html = renderMarkdown('质能方程 $E = mc^2$ 很简单。', themes[0], opts())
  assert.match(html, new RegExp(`<span ${PENDING}[^>]*>\\$E = mc\\^2\\$</span>`))
  // 关键：$ 两侧不再被当成正文，而是落在公式标记里
  assert.doesNotMatch(html, /<p[^>]*>[^<]*\$E = mc\^2\$/)
})

test('行内公式 \(…\) 同样被识别', () => {
  const html = renderMarkdown('勾股定理 \\(a^2+b^2=c^2\\) 成立。', themes[0], opts())
  assert.match(html, new RegExp(`<span ${PENDING}[^>]*>\\$a\\^2\\+b\\^2=c\\^2\\$</span>`))
})

test('独立成段的 $$…$$ 渲染为块级公式容器', () => {
  const html = renderMarkdown('前文\n\n$$\n\\int_0^1 x^2 \\, dx\n$$\n\n后文', themes[0], opts())
  assert.match(html, new RegExp(`<section data-line="\\d+" ${PENDING}[^>]*>`))
  assert.match(html, /text-align:center/)
})

test('单行 $$…$$ 与 \\[…\\] 也识别为块级公式', () => {
  const single = renderMarkdown('$$E = mc^2$$', themes[0], opts())
  assert.match(single, new RegExp(PENDING))
  const bracket = renderMarkdown('\\[\\frac{1}{2}\\]', themes[0], opts())
  assert.match(bracket, new RegExp(PENDING))
})

test('金额不会被误判成公式（$100 / $1,000.00 / 我花了 $5 买了 $10 的东西）', () => {
  const cases = [
    '单价 $100 元，很便宜。',
    '总计 $1,000.00 已经付过了。',
    '我花了 $5 买了 $10 的东西，真划算。',
    '价格是 $5 到 $10 之间。',
  ]
  for (const src of cases) {
    const html = renderMarkdown(src, themes[0], opts())
    assert.doesNotMatch(html, new RegExp(PENDING), '被误判为公式：' + src)
  }
})

test('转义的 \\$ 保持字面美元符号', () => {
  const html = renderMarkdown('价格是 \\$5 且 \\$x$ 不成立', themes[0], opts())
  assert.match(html, /\$5/)
})

test('行内代码里的 $…$ 归行内代码，不归公式', () => {
  const html = renderMarkdown('写成 `$x$` 才是纯文本。', themes[0], opts())
  assert.doesNotMatch(html, new RegExp(PENDING))
  assert.match(html, /<code[^>]*>\$x\$<\/code>/)
})

test('代码块里的 $$ 不会被当成公式', () => {
  const html = renderMarkdown('```\n$$\nE = mc^2\n$$\n```', themes[0], opts())
  assert.doesNotMatch(html, new RegExp(PENDING))
})

test('关闭公式后按原文保留（math:false）', () => {
  const src = '质能方程 $E = mc^2$ 很简单。'
  const html = renderMarkdown(src, themes[0], opts({ math: false }))
  assert.doesNotMatch(html, new RegExp(PENDING))
  assert.match(html, /\$E = mc\^2\$/)
})

test('不完整的公式写法不会抛异常、也不会吞掉正文', () => {
  const cases = ['未闭合 $x + y', '空公式 $$ $$', '只有一个 $', '$$', '\\(未闭合', '双美元 $$$']
  for (const src of cases) {
    const html = renderMarkdown(src, themes[0], opts())
    assert.equal(typeof html, 'string')
    assert.ok(html.length > 0)
  }
})

test('公式内容里的 HTML 会被转义，不会注入标签', () => {
  const html = renderMarkdown('$x<script>alert(1)</script>$', themes[0], opts())
  assert.doesNotMatch(html, /<script>/)
})

test('所有主题下公式都能渲染出占位而不报错', () => {
  for (const theme of themes) {
    const html = renderMarkdown('行内 $a+b$ 与\n\n$$\nc^2\n$$', theme, opts())
    assert.match(html, new RegExp(PENDING), '主题 ' + theme.id + ' 未能识别公式')
  }
})

test('math 选项参与渲染缓存键（切换开关必须重渲染）', () => {
  const src = '行内 $a+b$ 结尾'
  const on = renderMarkdown(src, themes[0], opts({ math: true }))
  const off = renderMarkdown(src, themes[0], opts({ math: false }))
  assert.match(on, new RegExp(PENDING))
  assert.doesNotMatch(off, new RegExp(PENDING))
  // 再切回来必须仍拿到公式版本（否则就是缓存键漏了 math）
  const onAgain = renderMarkdown(src, themes[0], opts({ math: true }))
  assert.match(onAgain, new RegExp(PENDING))
})
