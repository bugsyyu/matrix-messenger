// Classic Matrix katakana rain on a 2D canvas behind the WebGL.
const CHARS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ' +
  '0123456789abcdefghijklmnopqrstuvwxyz<>/\\[]{}+-=*_:;.';

export function startRain(canvas) {
  const ctx = canvas.getContext('2d');
  let cols = 0;
  let drops = [];
  const fontSize = 16;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.scale(dpr, dpr);
    cols = Math.ceil(window.innerWidth / fontSize);
    drops = new Array(cols).fill(0).map(() => Math.random() * -50);
  }
  resize();
  window.addEventListener('resize', () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    resize();
  });

  ctx.font = `${fontSize}px ${getComputedStyle(document.body).getPropertyValue('--m-mono') || 'monospace'}`;

  function frame() {
    ctx.fillStyle = 'rgba(0,8,5,0.08)';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    for (let i = 0; i < drops.length; i++) {
      const x = i * fontSize;
      const y = drops[i] * fontSize;
      const ch = CHARS[Math.floor(Math.random() * CHARS.length)];

      // head bright, tail dim
      if (Math.random() < 0.02) ctx.fillStyle = '#bfffd0';
      else if (y > 0 && drops[i] > 1) ctx.fillStyle = '#00ff41';
      else ctx.fillStyle = '#008f11';

      ctx.fillText(ch, x, y);

      drops[i] += 0.85 + Math.random() * 0.7;
      if (y > window.innerHeight && Math.random() > 0.975) drops[i] = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
