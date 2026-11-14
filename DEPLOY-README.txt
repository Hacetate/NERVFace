NERVFace 项目页 — GitHub Pages 部署说明
=========================================

本目录 `deploy/` 是可直接上传的干净版本，已剔除本地预览工具和未完成的 case。


一、目录内容（上传这些，别再套一层文件夹）
----------------------------------------
deploy/
├── .nojekyll                  ← 保留！避免 GitHub 用 Jekyll 处理
├── index.html                 ← 必须在仓库根目录
├── styles.css
├── app.js
├── site-config.js
├── viewer.bundle.js           ← 已打包，线上不需要 npm 构建
├── favicon.svg
├── THIRD_PARTY_NOTICES.txt
├── export-checklist.txt
└── assets/
    ├── cases.json             ← 只含 01–04
    ├── overview.webp
    ├── cases/case-01..case-04/
    ├── hdri/                  ← 11 组 HDRI + 缩略图
    └── materials/             ← 15 张 WebP 贴图（4096→2048）


二、部署步骤
------------
1. GitHub 新建 Public 仓库，例如 `NERVFace`（不要勾 README）。
2. 仓库页 → Add file → Upload files。
3. 把 deploy 目录里的**全部内容**拖进去（含 .nojekyll 和 assets 文件夹）。
   - 注意：Windows 资源管理器默认隐藏以点开头的文件，
     上传后请确认仓库根目录里能看到 `.nojekyll`。
4. Commit changes。
5. Settings → Pages：
   - Source: Deploy from a branch
   - Branch: main   Folder: /(root)
   - Save
6. 等 1–2 分钟，访问：https://<你的用户名>.github.io/NERVFace/

以后更新：重复上传覆盖即可，自动重新部署。


三、体积核对（已实测）
----------------------
文件总数        86
总体积          33.22 MB      （Pages 上限 1 GB）
单文件最大       2.63 MB      （网页拖拽上传上限 25 MB，单文件硬上限 100 MB）
贴图压缩        52.68 MB → 4.57 MB（4096² → 2048² WebP, q90）

所以用网页拖拽上传也不会撞到限制，不必安装 Git。


四、已做的验证
--------------
- 66 个运行时请求（页面/gltf/bin/贴图/HDRI/清单）全部 200。
- 模拟子路径部署 `http://host/deploy/`：PT 渲染到 56 spp、无 404、无 JS 报错，
  资源解析为 `/deploy/assets/...` 正确（说明放子目录不会 404）。
- PT / 实时渲染切换、切换 case、切换 HDRI 均实际出图。
- 渲染结果人工核验：皮肤有贴图与真实肤色、双眼虹膜可见、画面无噪点、无破面。


五、注意事项
------------
1. **仓库公开 = 全部素材可被任何人下载**，含真人肖像与 4K 降采样后的面部纹理。
   公开范围请自行确认。
2. **HDRI 来自你本地 `D:\HDRI Sky`**，若原素材包许可证不允许再分发，
   公开前应删除 `assets/hdri/` 并在 `assets/hdri/manifest.json` 中移除条目，
   或仅保留「原始光照」。已在 THIRD_PARTY_NOTICES.txt 标注来源。
3. 原站 MARCUS-Avatar 仅作参考，代码为本项目独立实现，未复制其源码。
4. 本地 4K 原始贴图与 `.blend` 文件均未修改，仍在 `blender-match/` 和原始工作目录。
5. 网页 3D 是浏览器近似材质，与 Blender/Cycles 成图仍有差异，属已知限制。


六、可选：绑定自己的域名
------------------------
Settings → Pages → Custom domain 填入域名，
再到域名服务商加 CNAME 指向 `<用户名>.github.io`，勾选 Enforce HTTPS。