# Camera registration review — 2026-11-15

Open [the before/after review](index.html). Every comparison uses the input photo
on the left and render on the right, split along projected native U=0.5.

- **A: 7_target_mismatch** — seven cases whose original fitting target differed
  from the displayed input. Mean regional landmark RMS: 7.40 → 3.21 pixels.
- **B: 14_other_residuals** — fourteen other cases flagged for local residuals.
  Mean regional landmark RMS: 4.88 → 4.36 pixels.

These are camera-only candidates, not a claim that all cases are fully fixed.
Ronaldo 01's bridge, homelander's lips, and Feng Ge 04's lips still exceed the
8-pixel review threshold. Dwayne Johnson 01 retains the original camera.
Chiang Kai-shek 01 improves the worst region but not the mean error.
Measurements are automatic landmark estimates at 1024×1024, not ground truth.
Mesh positions, transforms and UVs passed before/after hash verification for all
21 cases. This review does not replace the main website's production assets.

## Files

Each case directory contains the final render and mesh image, original and new
UV composites, before/after pair, projected surface data, native UV field,
camera state/history, and geometry verification. `summary.json` preserves the
source provenance and camera parameters; `comparison-metrics.json` summarizes
the results. `comparisons/` and the ZIP separate the two groups explicitly.

The scripts are snapshots of the local workflow, not a standalone turnkey build.
They depend on the original `selected_cases_archive`, audit report, local Blender
5.2/CUDA setup, Python scientific/image packages, and MediaPipe model paths in
`observe.py`. Original paths remain in the scripts and metadata for provenance.
Run them from their original `F:/NERVFaceWeb/tools` layout or adapt those paths
to another machine. The large source/registered Blender scenes and intermediate
trial renders remain in the local archive; they are not duplicated in Git.
