// 数学公式支持：自托管 MathJax v3（tex-svg），只在文档里真的出现公式时才加载。
//
// 为什么是「MathJax 的 SVG 输出」而不是 KaTeX：
//  ① 公众号编辑器会剥离 <style> 与类名，KaTeX 的排版完全依赖 katex.css 与自带字体，
//     粘贴过去必然散架；MathJax 的 SVG 是纯 <path> 矢量，不依赖任何外部 CSS 与字体。
//  ② 配置 svg.fontCache='none' 后，MathJax 把每个字形直接输出成内联 <path>，
//     **不产生 defs / use / xlink**，正合微信「禁用 defs、id、href(#id) 依赖」的硬约束。
//     （doocs/md 与 mpmath 两个公众号项目同走此路线，且 doocs/md 明确注明公式 SVG 不做 defs 清理。）
//  ③ SVG 用 currentColor 上色（MathJax 默认即如此），公式颜色自动跟随主题正文色与深色模式。
//
// 离线优先：脚本由 scripts/sync-mathjax.mjs 从本地依赖同步到 public/vendor/mathjax/，
// 页面以普通 <script> 懒加载，不走 CDN，不产生任何外部请求。
// 写成 public/ 下的相对路径（配合 vite.config.js 的 base:'./'）而不是 Vite 的 `?url` 资源导入，
// 是为了让这个模块在 `node --test` 里也能被直接 import。
const MATHJAX_SCRIPT = './vendor/mathjax/tex-svg.js'

let ready = false
let requested = false
let loading = null
const listeners = new Set()
// 公式 -> SVG 标记 的缓存：预览每次击键都会整篇重渲染，而 MathJax 每次排版要几十毫秒，
// 不做缓存的话公式多的文章会明显卡顿。输出与主题无关（用的是 currentColor），可跨主题复用。
const CACHE_LIMIT = 400
const cache = new Map()

export function onMathReady(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function isMathReady() {
  return ready
}

// 文档里出现过公式才会真正去加载；没公式时调用它是零成本的。
// 返回值语义：true = 公式已就绪（或本篇根本没有公式，无需就绪）；false = 需要公式但加载失败。
export function ensureMathLoaded() {
  if (ready) return Promise.resolve(true)
  if (!requested) return Promise.resolve(true)
  return loadMathJax()
}

function configMathJax() {
  // 必须在脚本加载前挂到 window 上，MathJax 启动时读取这份配置。
  globalThis.MathJax = {
    tex: { tags: 'ams' },
    svg: { fontCache: 'none' }, // 关键：不生成 defs/use，输出为自包含的内联 path
    startup: { typeset: false }, // 只用于 tex2svg，不扫描页面（否则会改写编辑器里的 $$…$$）
    options: { enableMenu: false },
  }
}

function loadMathJax() {
  if (loading) return loading
  loading = new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(false)
    configMathJax()
    const script = document.createElement('script')
    script.src = MATHJAX_SCRIPT
    script.async = true
    const fail = () => resolve(false)
    script.onerror = fail
    script.onload = () => {
      const mj = globalThis.MathJax
      if (!mj || typeof mj.tex2svg !== 'function') return fail()
      const finish = () => {
        ready = true
        for (const fn of listeners) {
          try {
            fn()
          } catch {
            // 单个订阅者出错不影响其它订阅者
          }
        }
        resolve(true)
      }
      if (mj.startup?.promise?.then) mj.startup.promise.then(finish).catch(fail)
      else finish()
    }
    document.head.appendChild(script)
  })
  return loading
}

// 尺寸与适配：公式宽度是 ex 单位（跟随正文字号），高度固定。这里只补两条：
//  · max-width:100% 让它不撑破正文栏；
//  · height:auto 让缩放时保持比例（SVG 带 viewBox，会按比例缩小而不是被压扁）。
// 行内的 vertical-align 由 MathJax 自己写在 style 上，必须原样保留，否则公式会离开基线。
function adaptSvg(svg, display, adaptor) {
  // 一律优先用 MathJax 的适配器 API：浏览器（真 DOM）与 Node（liteDOM）都提供这套方法，
  // 而两者的属性面并不一致——liteDOM 的元素没有 .firstChild / .outerHTML 属性，只有方法。
  const setStyle = (name, value) => {
    try {
      if (adaptor && typeof adaptor.setStyle === 'function') adaptor.setStyle(svg, name, value)
      else if (svg.style && typeof svg.style.setProperty === 'function') svg.style.setProperty(name, value)
    } catch {
      // 样式补丁只是锦上添花，失败不影响公式本体
    }
  }
  setStyle('max-width', '100%')
  setStyle('height', 'auto')
  try {
    if (adaptor && typeof adaptor.setAttribute === 'function') adaptor.setAttribute(svg, 'data-math', display ? 'block' : 'inline')
    else if (typeof svg.setAttribute === 'function') svg.setAttribute('data-math', display ? 'block' : 'inline')
  } catch {
    // 标记只用于验收断言，失败也不影响公式渲染
  }
  try {
    if (adaptor && typeof adaptor.outerHTML === 'function') return adaptor.outerHTML(svg)
  } catch {
    // 落到下面的属性路径
  }
  return svg.outerHTML || String(svg)
}

// 让宿主注入一个已经就绪的 MathJax 实例：宿主自己加载过 MathJax 时可以复用，
// 非浏览器环境（用 Node 适配器跑同一套输出代码做验收）也走这里。
// 浏览器正常路径不依赖它 —— 那是 loadMathJax() 的活。
export function installMathJax(instance) {
  if (!instance || typeof instance.tex2svg !== 'function') return false
  globalThis.MathJax = instance
  ready = true
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // 单个订阅者出错不影响其它订阅者
    }
  }
  return true
}

// 渲染一条公式：返回 SVG 标记，未就绪时返回 null（调用方给占位）。
export function renderMath(tex, display) {
  const key = (display ? '1\u0000' : '0\u0000') + tex
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const mj = globalThis.MathJax
  if (!ready || typeof mj?.tex2svg !== 'function') {
    requested = true
    loadMathJax()
    return null
  }
  let html = null
  try {
    mj.texReset()
    const node = mj.tex2svg(tex, { display })
    const adaptor = mj.startup && mj.startup.adaptor
    const svg =
      adaptor && typeof adaptor.firstChild === 'function' ? adaptor.firstChild(node) : node && node.firstChild
    if (svg) html = adaptSvg(svg, display, adaptor)
  } catch {
    // 非法 TeX：MathJax 自己会渲染成红色错误提示；这里再兜一层，绝不让整篇渲染崩掉
    html = null
  }
  if (html) {
    cache.set(key, html)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
  }
  return html
}
