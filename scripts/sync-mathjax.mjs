// 把 MathJax 的浏览器构建同步到 public/vendor/mathjax/，供页面以普通 <script> 懒加载。
//
// 为什么不直接 `import url from 'mathjax/es5/tex-svg.js?url'`：
//   本项目的单元测试是 `node --test` 直接跑 src/ 源码（不经过打包器），
//   而 `?url` 是 Vite 专有语法，Node 解析不了 —— 那样 renderer.js 一被 import 就报错。
//   改成 public/ 下的相对路径后，这个模块在 Node 与浏览器里都能直接 import。
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules', 'mathjax', 'es5', 'tex-svg.js')
const destDir = path.join(root, 'public', 'vendor', 'mathjax')
const dest = path.join(destDir, 'tex-svg.js')

if (!existsSync(src)) {
  console.error('[sync-mathjax] 找不到 ' + src)
  console.error('[sync-mathjax] 请先执行 npm install 安装依赖（mathjax 已列在 dependencies 里）')
  process.exit(1)
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

mkdirSync(destDir, { recursive: true })
// 用内容指纹判断是否需要同步：大小相同也可能是不同内容（本 skill 的既有教训）
const same = existsSync(dest) && statSync(dest).size === statSync(src).size && sha256(dest) === sha256(src)
if (same) {
  console.log('[sync-mathjax] public/vendor/mathjax/tex-svg.js 已是最新，跳过')
} else {
  copyFileSync(src, dest)
  console.log('[sync-mathjax] 已同步 tex-svg.js：' + statSync(dest).size + ' 字节  sha256=' + sha256(dest).slice(0, 16))
}
