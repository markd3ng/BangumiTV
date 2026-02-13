# BangumiTV

> 在静态页面中渲染你的 Bangumi 追番进度，采用现代化的 Claymorphism (粘土拟态) 风格设计。

[![](https://img.shields.io/npm/v/bangumi-tv)](https://www.npmjs.com/package/bangumi-tv) [![](https://img.shields.io/badge/Author-GeeKaven-blueviolet)](https://github.com/GeeKaven) [![](https://img.shields.io/npm/l/bangumi-tv)](https://github.com/geekaven/BangumiTV/blob/main/LICENSE) [![](https://data.jsdelivr.com/v1/package/npm/bangumi-tv/badge)](https://www.jsdelivr.com/package/npm/bangumi-tv)

一个基于 Fastify + Node.js 的 [Bangumi.tv](https://bgm.tv) 追番进度展示组件。

## ✨ 特性

-   **粘土拟态设计**：基于 Claymorphism 风格，清新动感，自带毛玻璃效果。
-   **全响应式网格**：自动适配 5 列/移动端列表，完美的对齐系统（封面、标题、进度条）。
-   **交互式大图**：悬停缩放，点击触发 **灯箱 (Lightbox)** 预览封面大图。
-   **链接分离**：点击标题跳转 BGM 条目，点击图片缩放展示，防止误触。
-   **空间优化**：进度数字内嵌至状态栏，界面更紧凑。
-   **多级数据补全**：自动从 CDN 离线数据回退至官方实时 API，确保信息完整。

## 🚀 安装

### 后端部署 (Vercel)

1.  **Fork** 本项目。
2.  在仓库 `Settings -> Secrets -> Actions` 中添加关键变量：
    -   `BANGUMI_USER`: 你的 **bgm.tv 数字 ID 或用户名**（必填）。
3.  在 [Vercel](https://vercel.com/) 中新建项目，选择该仓库并一键部署。
4.  获取你的 Production 域名（如 `https://my-bangumi.vercel.app`）。

### 前端引入

在你的静态页面（如博客、个人主页）中插入以下代码：

```html
<!-- CSS 引入 -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bangumi-tv/public/src/bangumi.css">

<div class="bgm-container"></div>

<script>
  window.bgmConfig = {
      apiUrl: "https://你的域名.vercel.app", // 后端地址
      quote: "生命不止，追番不息！"
  }
</script>

<!-- JS 引入 -->
<script src="https://cdn.jsdelivr.net/npm/bangumi-tv/public/src/bangumi.js"></script>
```

## 🛠️ 本地开发

1.  复制 `.env.example` 为 `.env` 并填写 `BANGUMI_USER`。
2.  安装依赖：`npm install`
3.  同步数据：`npm run sync`
4.  本地运行：`npm run dev`

## 🖼️ 图片镜像反代 (Image Proxy)

为了解决 `lain.bgm.tv` 的访问速度问题或跨域限制，你可以配置图片反代前缀。

### 配置方式
在 Vercel 环境变量或 `.env` 文件中设置 `IMG_PROXY_PREFIX`。

### 支持的模式
1.  **直接替换模式**：
    将环境变量设为反代站点的地址（如 `https://i0.hdslb.com/bfs/bas`）。
    脚本会自动将 `https://lain.bgm.tv` 替换为你设置的前缀。
2.  **占位符模式**：
    如果你的反代服务需要完整的原始 URL（如 `https://worker.com/?url={origin-uri}`）。
    脚本会将 `{origin-uri}` 替换为经过编码的原始图片地址。

## 感谢❤️

-   [Bangumi-Subject](https://github.com/czy0729/Bangumi-Subject) 离线Bgm数据 (由 czy0729 提供)
-   [bangumi/api](https://github.com/bangumi/api) 提供官方 API 支持
