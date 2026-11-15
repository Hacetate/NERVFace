// Atlas blits copy image pixels, not mesh UVs. three-gpu-pathtracer 0.0.28
// retains texture.channel on its copy quad, which only has UV0. A UV1/UV2
// texture can therefore compile a missing-attribute shader for the whole atlas.
export function patchAtlasBlit(source) {
  const clone = 'const clone = texture.clone();';
  const targetStart = 'const prevAutoUpdate = texture.matrixAutoUpdate;';
  const targetEnd = 'texture.matrixAutoUpdate = prevAutoUpdate;';
  for (const anchor of [clone, targetStart, targetEnd]) {
    if (source.split(anchor).length !== 2) throw new Error(`PT atlas patch needs review: ${anchor}`);
  }
  return source
    .replace(clone, `${clone}\n\t\t\t\tclone.channel = 0;`)
    .replace(targetStart, `${targetStart}\n\t\t\t\tconst prevChannel = texture.channel;\n\t\t\t\ttexture.channel = 0;`)
    .replace(targetEnd, `${targetEnd}\n\t\t\t\ttexture.channel = prevChannel;`);
}
