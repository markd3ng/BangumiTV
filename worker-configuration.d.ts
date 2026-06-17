// 让 TypeScript 接受把 .html 当作文本模块导入（manage 页面模板）。
declare module '*.html' {
  const content: string
  export default content
}
