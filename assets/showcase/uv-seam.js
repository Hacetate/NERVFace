// Version 3 preserves every uint16 native-UV value using row deltas and gzip.
export async function loadSurface(root) {
  const response=await fetch(`${root}/uv-surface.json`);
  if(!response.ok)throw new Error('UV surface metadata could not load.');
  const metadata=await response.json();
  const compressed=metadata.version===3&&metadata.encoding==='uint16-delta-x-gzip';
  if((!compressed&&(metadata.version!==2||metadata.encoding!=='uint16-little-endian'))||!Number.isInteger(metadata.width)||!Number.isInteger(metadata.height)||metadata.width<2||metadata.height<2||metadata.width>4096||metadata.height>4096)throw new Error('Invalid UV surface metadata.');
  const pixels=await fetch(`${root}/${compressed?'uv-surface.delta.gz':'uv-surface.bin'}`);
  if(!pixels.ok)throw new Error('UV surface could not load.');
  let buffer=await pixels.arrayBuffer();
  const bytes=new Uint8Array(buffer);
  if(compressed&&bytes[0]===31&&bytes[1]===139)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(buffer.byteLength!==metadata.width*metadata.height*2)throw new Error('Incomplete UV surface.');
  const values=new Uint16Array(buffer);
  if(compressed)for(let y=0;y<metadata.height;y++)for(let x=1;x<metadata.width;x++)values[y*metadata.width+x]=(values[y*metadata.width+x]+values[y*metadata.width+x-1])&65535;
  return {...metadata,values};
}

export function surfaceU(data,x,y) {
  // UV values describe pixel centers; interpolate them instead of snapping to texels.
  const px=Math.max(0,Math.min(data.width-1,x*data.width-.5));
  const py=Math.max(0,Math.min(data.height-1,y*data.height-.5));
  const col=Math.floor(px),row=Math.floor(py),dx=px-col,dy=py-row;
  const nextCol=Math.min(col+1,data.width-1),nextRow=Math.min(row+1,data.height-1);
  const a=data.values[row*data.width+col]*(1-dx)+data.values[row*data.width+nextCol]*dx;
  const b=data.values[nextRow*data.width+col]*(1-dx)+data.values[nextRow*data.width+nextCol]*dx;
  return (a*(1-dy)+b*dy)/65535;
}
export async function createSurfaceMask(canvas,data,imageURL,size=1024) {
  const image=new Image(); image.src=imageURL;
  await image.decode();
  const n=Math.min(size,data.width);
  canvas.width=n;canvas.height=n;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('Canvas comparison is unavailable.');
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,0,0,n,n);
  const output=ctx.getImageData(0,0,n,n);
  const u=new Float32Array(n*n), gradient=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)u[y*n+x]=surfaceU(data,(x+.5)/n,(y+.5)/n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const p=y*n+x;
    gradient[p]=Math.max(1/65535,Math.hypot(u[y*n+Math.min(n-1,x+1)]-u[y*n+Math.max(0,x-1)],u[Math.min(n-1,y+1)*n+x]-u[Math.max(0,y-1)*n+x])/2);
  }
  return {
    update(threshold) {
      const pixels=output.data;
      for(let p=0;p<u.length;p++)pixels[p*4+3]=threshold<=0?255:threshold>=1?0:Math.round(Math.max(0,Math.min(1,.5+(u[p]-threshold)/gradient[p]))*255);
      ctx.putImageData(output,0,0);
      const paths=[];let previous=[],handle=threshold;
      for(let y=0;y<n;y++){
        let nearest=Infinity;const current=[],used=new Set();
        for(let x=1;x<n;x++){
          const a=u[y*n+x-1],b=u[y*n+x];
          if((a<threshold)!==(b<threshold)){
            const at=x-.5+(threshold-a)/(b-a), px=at/n*1000, py=(y+.5)/n*1000;
            let match=null,distance=n*.05;
            for(const candidate of previous){const d=Math.abs(candidate.x-at);if(!used.has(candidate)&&d<distance){match=candidate;distance=d;}}
            const point=`${px.toFixed(2)},${py.toFixed(2)}`;
            if(match){used.add(match);match.points.push('L'+point);current.push({x:at,points:match.points});}
            else{const points=['M'+point];paths.push(points);current.push({x:at,points});}
            if(y===Math.floor(n/2)&&Math.abs(at/n-.5)<nearest){nearest=Math.abs(at/n-.5);handle=at/n;}
          }
        }
        previous=current;
      }
      return {path:paths.map(points=>points.join('')).join(''),handlePercent:Math.max(2,Math.min(98,handle*100))};
    }
  };
}
