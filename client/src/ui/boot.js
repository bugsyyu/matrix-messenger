// Boot sequence: faux-terminal log that types itself into existence.
const LINES = [
  '[ 0.000] SOURCE.NODE boot v0.1.0',
  '[ 0.012] verifying simulation kernel ........ ok',
  '[ 0.034] mounting /dev/agent ................ ok',
  '[ 0.061] loading planet manifold ............ ok',
  '[ 0.089] redpill cache primed ............... ok',
  '[ 0.121] dialing wss://multiplayer ......... pending',
  '',
  '> The Matrix has you.',
  '> But someone has to route the packets.',
  '',
  'press [enter] to jack in',
];

export async function bootSequence() {
  const boot = document.getElementById('boot');
  const log = document.getElementById('boot-log');
  log.textContent = '';

  for (const line of LINES) {
    await typeLine(log, line);
    await sleep(120 + Math.random() * 140);
  }

  await new Promise((resolve) => {
    const done = (e) => {
      if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') {
        window.removeEventListener('keydown', done);
        boot.removeEventListener('click', done);
        boot.classList.add('hidden');
        resolve();
      }
    };
    window.addEventListener('keydown', done);
    boot.style.pointerEvents = 'auto';
    boot.addEventListener('click', done);
  });
}

function typeLine(target, line) {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      target.textContent += line[i++] ?? '';
      if (i >= line.length) {
        target.textContent += '\n';
        resolve();
      } else {
        setTimeout(tick, 6 + Math.random() * 10);
      }
    };
    tick();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
