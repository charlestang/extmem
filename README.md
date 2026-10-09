# 所谓伊人在何方 — extmem-blog

独立的Hexo生活博客源项目，恢复自2023-09-01备份中的245篇已发布文章。
10篇私密文章、用户账号、评论和原始SQL未包含在仓库中。
75个实际图片引用已保存为本地资源；另25个未恢复图片保留原地址。

## 构建与预览

使用Node.js 24+与pnpm 10.30.3：

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run verify:site
pnpm run server -- --ip 127.0.0.1 --port 4000
```

本地打开 `http://127.0.0.1:4000/extmem/`。
已导入文章保留 `archives/文章ID.html` 相对结构，例如 `extmem/archives/508.html`。

## 离线重新导入

```sh
pnpm run import:wordpress -- /private/path/backup.sql.gz
pnpm run clean
pnpm run build
```

导入工具只解析SQL文本，不执行SQL或连接数据库。按WordPress ID生成确定性文件；重复导入不会重复文章，但会覆盖已导入文件的手工修改。
分类按原taxonomy/relationship及真实父子关系保留，并列分类不改成嵌套分类。
正文不语义改写，复杂表格与图注等保留HTML。图片映射位于 `data/image-map.json`。
评论全部舍弃，未配置任何评论服务。

## GitHub自动发布

公开源码仓库为 `https://github.com/charlestang/extmem`。
`.github/workflows/pages.yml` 在main分支推送后构建、验证资源并部署GitHub Pages。
发布地址为 `https://blog.charlestang.org/extmem/`，沿用用户站的现有自定义域名。
Hexo的url与root均配置为/extmem/子路径。无需改动根站仓库或DNS。

本地详细导入/缺图/验证记录在被Git忽略的 `migration/` 中；这些诊断记录不属于可发布内容。
