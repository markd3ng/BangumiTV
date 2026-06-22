// 让 TypeScript 接受把 .html、.css、.js 当作文本模块导入。
declare module '*.html' {
  const content: string
  export default content
}
declare module '*.css' {
  const content: string
  export default content
}
declare module '*.js' {
  const content: string
  export default content
}
