import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
// Run the exact production CV implementation with the real packaged WASM engine.
// OpenCV's large generated surface is deliberately treated as a dynamic runtime here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cv: any, vision: any;
beforeAll(async () => {
  cv = await require('@techstark/opencv-js');
  const context = { globalThis: {} };
  vm.runInNewContext(await readFile(new URL('../public/vision.js', import.meta.url), 'utf8'), context);
  vision = (context.globalThis as { CardVision: unknown }).CardVision;
});
function synthetic(border: number, angle = 0) {
  const src = new cv.Mat(900,900,cv.CV_8UC4,new cv.Scalar(248,248,248,255));
  const center = { x:450,y:450 }, w = 440,h = 615;
  const points = [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y]) => ({ x:Math.round(center.x+x*Math.cos(angle)-y*Math.sin(angle)), y:Math.round(center.y+x*Math.sin(angle)+y*Math.cos(angle)) }));
  const contour = cv.matFromArray(4,1,cv.CV_32SC2,points.flatMap(p=>[p.x,p.y]));
  const list = new cv.MatVector(); list.push_back(contour);
  cv.fillPoly(src,list,new cv.Scalar(border,border,border,255));
  // Interior artwork rectangle plus high contrast printed detail.
  cv.rectangle(src,new cv.Point(290,270),new cv.Point(610,570),new cv.Scalar(80,130,65,255),-1);
  for(let i=0;i<14;i++) cv.line(src,new cv.Point(290,610+i*7),new cv.Point(600-(i%3)*20,610+i*7),new cv.Scalar(40,40,40,255),2);
  contour.delete();list.delete(); return {src,points};
}
describe('real OpenCV boundary detection and validation', () => {
  for(const [label,border] of [['white',230],['silver',190],['yellow-like',155],['dark',30]] as const) {
    it(`finds the exterior ${label} card on white`, () => {
      const {src,points}=synthetic(border);
      try { const found=vision.findCard(cv,src); expect(found.confidence).toBeGreaterThan(.55);
        for(const point of points) expect(Math.min(...found.corners.map((p:{x:number;y:number})=>Math.hypot(point.x-p.x,point.y-p.y)))).toBeLessThan(15);
      } finally {src.delete();}
    });
  }
  it('detects rotated exterior corners and corrects perspective to portrait', () => {
    const {src}=synthetic(60,.13);
    let out;
    try {const found=vision.findCard(cv,src);out=vision.rectify(cv,src,found,{outputWidth:900,minSharpness:10});
      expect(out.height).toBeGreaterThan(out.width);expect(out.width/out.height).toBeCloseTo(63/88,2);expect(out.sharpness).toBeGreaterThan(10);
    } finally {src.delete();out?.mat.delete();}
  });
  it('rejects missing corners', () => {
    const src=new cv.Mat(900,900,cv.CV_8UC4,new cv.Scalar(248,248,248,255));
    try {expect(()=>vision.findCard(cv,src)).toThrow(/boundaries/);} finally {src.delete();}
  });
  it('corrects a mildly trapezoidal card', () => {
    const {src}=synthetic(45); const projected=new cv.Mat(); let out;
    const from=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,899,0,899,899,0,899]);
    const to=cv.matFromArray(4,1,cv.CV_32FC2,[35,20,860,45,895,875,10,890]);
    const matrix=cv.getPerspectiveTransform(from,to);
    try {
      cv.warpPerspective(src,projected,matrix,new cv.Size(900,900),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(248,248,248,255));
      const found=vision.findCard(cv,projected);out=vision.rectify(cv,projected,found,{outputWidth:900,minSharpness:10});
      expect(out.width/out.height).toBeCloseTo(63/88,2);expect(found.confidence).toBeGreaterThan(.55);
    } finally {src.delete();projected.delete();from.delete();to.delete();matrix.delete();out?.mat.delete();}
  });
  it('makes a landscape capture portrait without cutting off the long side', () => {
    const {src}=synthetic(50);const rotated=new cv.Mat();let out;
    try {
      cv.rotate(src,rotated,cv.ROTATE_90_CLOCKWISE);
      out=vision.rectify(cv,rotated,vision.findCard(cv,rotated),{outputWidth:900,minSharpness:10});
      expect(out.height).toBeGreaterThan(600);expect(out.width/out.height).toBeCloseTo(63/88,2);
    } finally {src.delete();rotated.delete();out?.mat.delete();}
  });
  it('rejects excessively blurry correction', () => {
    const {src}=synthetic(40);const blurred=new cv.Mat();
    try {const found=vision.findCard(cv,src);cv.GaussianBlur(src,blurred,new cv.Size(65,65),20);
      expect(()=>vision.rectify(cv,blurred,found,{outputWidth:900,minSharpness:45})).toThrow(/blurry/);
    } finally {src.delete();blurred.delete();}
  });
  it('rejects partially outside or invalid quadrilaterals', () => {
    expect(vision.geometry([{x:0,y:100},{x:440,y:100},{x:440,y:715},{x:0,y:715}],900,900)).toBeNull();
    expect(vision.geometry([{x:50,y:50},{x:800,y:50},{x:800,y:800},{x:50,y:800}],900,900)).toBeNull();
  });
});
