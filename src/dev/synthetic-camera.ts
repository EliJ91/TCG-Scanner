/** Explicit development-only fixture. Never substitutes for a real camera in production. */
export function syntheticCamera() {
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 900;
  const ctx = canvas.getContext('2d')!;
  let animation = 0, active = true, index = 0, began = -1, invalid = false, silver = false;
  let feedTimer: ReturnType<typeof setInterval> | undefined;
  const card = (y: number, number: number) => {
    const x = 310, w = 380, h = 530;
    ctx.fillStyle = silver ? '#f3f5f8' : '#d0ce82'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1e2937'; ctx.fillRect(x + 15,y + 15,w - 30,h - 30);
    ctx.fillStyle = '#e8ecdf'; ctx.fillRect(x + 26,y + 26,w - 52,h - 52);
    ctx.fillStyle = number % 2 ? '#7b9e62' : '#708fb2'; ctx.fillRect(x + 32,y + 68,w - 64,260);
    ctx.fillStyle = '#263420'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(`Synthetic test ${number}`,x + 36,y + 52);
    for(let i=0;i<16;i++) {ctx.fillStyle=i%2?'#798568':'#263420';ctx.fillRect(x+36,y+345+i*8,200+(i%3)*35,3);}
    for(let i=0;i<50;i++) {ctx.fillStyle=i%2?'#d6e4bf':'#394d2e';ctx.fillRect(x+45+(i*29)%260,y+85+(i*43)%230,15,11);}
  };
  const draw = (now: number) => {
    if (!active) return;
    ctx.fillStyle='#f8f8f8';ctx.fillRect(0,0,1000,900);
    if (began >= 0) {
      // Show the bare surface before sliding in the replacement.
      const p = Math.min(1, (now - began - 120) / 250);
      if (p >= 0) card(-545 + 730 * p, index + 1);
      if (p === 1) { index++; began = -1; }
    } else if (!invalid) card(185, index);
    animation=requestAnimationFrame(draw);
  };
  const slide = () => {invalid=false;if(began<0)began=performance.now();};
  const blank = () => {invalid=true;began=-1;};
  const silverBorder = () => {silver=true;invalid=false;};
  const feed = () => {clearInterval(feedTimer);let left=9;feedTimer=setInterval(()=>{slide();if(--left===0)clearInterval(feedTimer);},1000);};
  const cleanup = () => {active=false;cancelAnimationFrame(animation);clearInterval(feedTimer);window.removeEventListener('test-card-slide',slide);window.removeEventListener('test-card-invalid',blank);window.removeEventListener('test-card-silver',silverBorder);window.removeEventListener('test-card-feed',feed);};
  window.addEventListener('test-card-silver',silverBorder);window.addEventListener('test-card-feed',feed);
  window.addEventListener('test-card-slide',slide);window.addEventListener('test-card-invalid',blank); animation=requestAnimationFrame(draw);
  const stream=canvas.captureStream(30);
  stream.getVideoTracks()[0].addEventListener('ended',cleanup);
  // track.stop does not emit ended in browsers; observe stream disposal from Camera.stop.
  return { stream, dispose:cleanup };
}
