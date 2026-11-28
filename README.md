# NERVFace project page

The deployed website and editable viewer sources, with 61 selected cases,
compressed models/textures, native UV sliders, and final offline renders.
The gallery shows 24 cases per page on desktop. The 3D viewer offers the 42 characters from the supplement.

Live site: https://hacetate.github.io/NERVFace/

## Local development

Use Node.js 22 or newer. Serve through HTTP; do not open index.html with file://.

```powershell
npm ci
npm start -- 8084
```

Open http://127.0.0.1:8084/. WebGPU/PT needs a supported browser and GPU.

| Files | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js`, `site-config.js` | Main page and interactions |
| `assets/showcase/showcase.js`, `showcase.css`, `uv-seam.js` | Gallery, dialog and UV slider; edit directly |
| `assets/motion/` | Facial animation, expression and speech clips, and additional cover UV views |
| `src/dual-viewer.js` | Main real-time and PT viewer source |
| `src/showcase-viewer.js` | Case dialog's 3D viewer source |
| `scripts/build.mjs`, `scripts/pt-atlas-patch.mjs` | PT build, including texture atlas fix |
| `assets/showcase/cases.json` | Selected case catalog |
| `assets/showcase/cases/`, `assets/showcase/textures/` | Models, cameras, images, UV fields and textures |

After editing the main viewer, run `npm run build`. After editing the case dialog
viewer, run `npm run build:showcase`. Commit the source and generated bundle
together. `npm test` checks camera projection precision for all 61 cases.

## Git workflow

The maintained checkout is `F:/NERVFaceWeb/compressed_release_61`.
Its `WEB` branch tracks `origin/WEB` in `Hacetate/NERVFace` and publishes the project page. Adjacent export/backup directories are separate.

```powershell
cd F:/NERVFaceWeb/compressed_release_61
# Check out the website branch before editing.
git switch WEB
git pull --ff-only
# Edit files. Rebuild the corresponding bundle if viewer sources changed.
npm test
git status
git add -A
git commit -m "Describe the website change"
git push origin WEB
```

For larger changes use `git switch -c codex/your-change` and review before merging.
Use `git revert <commit>` to undo a published change while preserving history.
Do not force-push main.

Git Credential Manager stores authentication; the remote URL has no token.
If authentication expires, run `git credential-manager github login`.
The local checkout uses this computer's current HTTP proxy. If that changes,
update the repository-local `http.proxy`, or use `git config --unset http.proxy`
when direct access works.

## Deployment and assets

The checked-in root is the ready-to-publish static website. GitHub Pages should
use `main` and the repository root. `.nojekyll` is included. The static host
does not need npm. `node_modules` is ignored. Keep all asset paths relative
so the `/NERVFace/` project URL works.

Website files occupy approximately 315 MB. High-resolution Blender scenes and
generation archives remain local and are not required to clone/run the website.
This repository builds the viewers; it does not reproduce the original Blender
asset-generation pipeline. Preserve model/texture/UV-field consistency when
replacing a case. See `THIRD_PARTY_NOTICES.txt` for bundled library notices.
