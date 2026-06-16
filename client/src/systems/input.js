// Keyboard input → unified move/look state.
export class InputState {
  constructor(el = window) {
    this.keys = new Set();
    this.mouseDx = 0;
    this.mouseDy = 0;
    this._captured = false;

    el.addEventListener('keydown', (e) => {
      // never swallow keys when the chat input is focused
      if (document.activeElement?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      // Space scrolls — block it
      if (e.code === 'Space') e.preventDefault();
    });
    el.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    el.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this._captured = document.pointerLockElement !== null;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this._captured) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });
  }

  /** Returns {forward, strafe, yaw, jump} for the physics step. */
  consume(dt) {
    let forward = 0, strafe = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))    forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))  forward -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))  strafe  -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe  += 1;

    // mouse yaw + Q/E keyboard turn
    let yaw = -this.mouseDx * 0.0025;
    if (this.keys.has('KeyQ')) yaw += 1.6 * dt;
    if (this.keys.has('KeyE')) yaw -= 1.6 * dt;
    this.mouseDx = 0;
    this.mouseDy = 0;

    const jump = this.keys.has('Space');
    return { forward, strafe, yaw, jump };
  }

  requestCapture(canvas) {
    canvas.requestPointerLock?.();
  }
}
