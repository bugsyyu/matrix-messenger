// Bottom-of-screen chat / command terminal.
// Routes input either to the WS chat ("networkEvent") or to the local game (commands like /goto, /accept).
export class Terminal {
  constructor({ onCommand, onChat }) {
    this.el = document.getElementById('terminal');
    this.log = document.getElementById('term-log');
    this.input = document.getElementById('term-input');
    this.form = document.getElementById('term-form');
    this.onCommand = onCommand;
    this.onChat = onChat;
    this.history = [];
    this.histIdx = -1;

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = this.input.value.trim();
      if (!value) return;
      this.input.value = '';
      this.history.unshift(value);
      this.histIdx = -1;
      this.echo(value, 'msg');
      if (value.startsWith('/')) {
        const [cmd, ...args] = value.slice(1).split(/\s+/);
        this.onCommand?.(cmd.toLowerCase(), args);
      } else {
        this.onChat?.(value);
      }
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.histIdx = Math.min(this.histIdx + 1, this.history.length - 1);
        this.input.value = this.history[this.histIdx] ?? '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.histIdx = Math.max(this.histIdx - 1, -1);
        this.input.value = this.history[this.histIdx] ?? '';
      }
    });
  }

  show() {
    this.el.classList.remove('hidden');
  }

  echo(text, cls = '') {
    const line = document.createElement('div');
    line.className = `line ${cls}`;
    line.textContent = text;
    this.log.appendChild(line);
    this.log.scrollTop = this.log.scrollHeight;
    while (this.log.children.length > 200) this.log.removeChild(this.log.firstChild);
  }

  sys(text) { this.echo(text, 'sys'); }
  ok(text)  { this.echo(text, 'ok'); }
  err(text) { this.echo(text, 'err'); }
  chat(who, text) { this.echo(`${who}> ${text}`, 'msg'); }

  focus() { this.input.focus(); }
}
