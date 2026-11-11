const preventedKeys = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor() {
    this.held = new Set();
    this.pressed = new Set();
    this.enabled = false;

    window.addEventListener('keydown', (event) => {
      const target = event.target;
      const isFormField = target instanceof HTMLElement
        && (target.isContentEditable || target.matches('input, textarea, select'));
      if (!this.enabled || isFormField) return;
      if (preventedKeys.has(event.code)) event.preventDefault();
      if (!event.repeat) this.pressed.add(event.code);
      this.held.add(event.code);
    });
    window.addEventListener('keyup', (event) => {
      this.held.delete(event.code);
    });
    window.addEventListener('blur', () => this.clear());
  }

  isDown(code) {
    return this.enabled && this.held.has(code);
  }

  consumePress(code) {
    const wasPressed = this.enabled && this.pressed.has(code);
    this.pressed.delete(code);
    return wasPressed;
  }

  clear() {
    this.held.clear();
    this.pressed.clear();
  }
}