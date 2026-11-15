NERVFace compressed web assets - 61-case handoff

Authoritative input: F:/NERVFaceWeb/selected_cases_archive/web_handoff_cases.json
All 61 entries are exported from their explicitly referenced final.blend files.
The source archive is never saved or modified. Nothing has been uploaded.

This directory contains a snapshot of the current site shell for local preview.
It does not replace F:/NERVFaceWeb/deploy or the source site's structure.
To integrate into the redesigned site, use assets/showcase/cases.json, cases/,
textures/, and the compatible assets/showcase/uv-seam.js loader together.
The hero retains its four comparison examples. "Same scene. Two renderers."
now offers all 61 characters through the dropdown and thumbnail strip, using
the same compressed models as the case collection. Each case additionally
contains viewer-scene.json, read from its final archived Blender scene.
The case collection uses 24 cases per page (6 columns by 4 rows on desktop).
Cards place a centered slider above a row containing the name and Explore more.
There is no card Reset button; Home on the slider restores the UV midline.
The slider occupies 76% of the padded inner width (about 67% on six-column cards).
Comparison canvases adapt to display size; bilinear UV sampling and connected
contours smooth the native-UV cut. The real-time dual renderer uses 4x MSAA.
New cases open at 1.35 times the source camera distance; Source camera restores
the original viewpoint. Raster depth clipping fits the model's bounding sphere
to prevent z-fighting with distant cameras and tiny source near planes. This
preserves the image projection; source metadata and PT clipping are unchanged.
PT unprojects rays in camera space before world translation, avoiding float32
cancellation with the archived telephoto cameras; shifted frusta are retained.
Dynamic low-resolution PT previews are disabled. Moving cameras are coalesced
until a visible full-resolution PT frame is available, then the latest camera
is traced. PT motion therefore updates less frequently than real-time mode.
Camera regression: node F:/NERVFaceWeb/tools/test_pt_camera.mjs (all 61 cases).
PT atlas blits force UV0 on the copy quad, retaining UV1/UV2 on the actual
model textures. The guarded build-time patch is tools/pt-atlas-patch.mjs.
Gray/full material changes rebuild PT scene bindings, so loading a case in
gray mode and returning to Appearance cannot retain gray-sized atlas buffers.
Reload viewer recreates the renderer, model and textures without reloading the
page. It preserves the selected case, material/render modes, camera and lighting.
Input mapping audit: tools/audit_input_mapping.py verifies all 61 input.webp
files exactly match uncropped exports of archived input images. Seven cases
have different synthetic registration targets; crop offsets cannot resolve
their local facial alignment differences.

Compression settings:
- Head and eye geometry: no decimation; geometry accessor bytes unchanged.
- Native head UVs preserved; eye colors use separate non-overlapping bake UVs.
- Color textures and eye atlases: up to 1024 x 1024, lossless WebP encoding.
- Final roughness/specular shader node chains: baked per case at 1024 x 1024.
  Beard and brow masks are evaluated before export. Only identical final image
  bytes are deduplicated; raw shared source maps are not substituted for masks.
- Scalars are explicitly packed as linear data: roughness in G; twice Blender
  Specular IOR Level in alpha for KHR_materials_specular. Web maps use 8-bit
  values; the original high-precision source textures remain in the archive.
- Normal maps, where present: up to 2048 x 2048.
- Display images: up to 1024 x 1024, WebP quality 93; thumbnails quality 90.
- Native UV comparison field: uint16 row deltas plus gzip. Decoding restores
  every original value, including the eye-depth occlusion treatment.

Models use EXT_texture_webp. Keep their relative references to ../../textures/.
The UV loader supports both version 2 binary and version 3 delta-gzip fields.
Serve the directory through HTTP; opening index.html with file:// is unsuitable
for fetch-based model and metadata loading.

The interactive renderer approximates Blender lighting. Source Cycles renders
remain the appearance reference; compression does not imply renderer parity.

Build script: F:/NERVFaceWeb/tools/build_archive_release.py
Validation: F:/NERVFaceWeb/tools/validate_archive_release.py
Dual renderer source: F:/NERVFaceWeb/tools/dual-viewer.js
Dual renderer build: node F:/NERVFaceWeb/tools/build_dual_viewer.mjs
Dual renderer metadata: F:/NERVFaceWeb/tools/prepare_dual_viewer_metadata.py
Detailed size and validation report: F:/NERVFaceWeb/_build/release61/report.json
