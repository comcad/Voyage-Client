/**
 * The first connected controller, read once a frame (the Gamepad API has no events for buttons). Whichever moves
 * (the layout's padMove: the D-pad or the left stick) holds the arrow directions; every other pressed button,
 * the D-pad's too when the stick moves, holds `pad:<index>`, which Game resolves through the controller layout.
 */
import { PAD_MOVE } from './controls.js';

const STICK_DEAD = 0.5;

export class PadInput {
  constructor(input, moveMode = () => 'ls') {
    this.input = input; this.moveMode = moveMode; this.pad = null;
    // A pad held as the window loses focus would stay held: the frame loop (and so poll) stops, and nothing else
    // clears the input's `sources` sets. Drop what the pad holds here, so the next poll re-populates the truth.
    addEventListener('blur', () => this.input.setHeld('pad', new Set()));
  }

  /** The controller's name for the settings tab, or null. */
  get name() { return this.pad?.id || null; }

  poll() {
    const pads = navigator.getGamepads?.() || [];
    const p = [...pads].find((x) => x && x.connected) || null;   // a disconnected pad reads back with connected false, so this clears it
    this.pad = p;
    const held = new Set(), dpadMoves = this.moveMode() === 'dpad';
    if (p) {
      p.buttons.forEach((b, i) => {
        if (!(b.pressed || b.value > 0.5)) return;
        if (dpadMoves && PAD_MOVE[i]) { held.add(PAD_MOVE[i]); return; }
        held.add(`pad:${i}`);
      });
      if (!dpadMoves) {
        const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
        if (ax < -STICK_DEAD) held.add('left'); else if (ax > STICK_DEAD) held.add('right');
        if (ay < -STICK_DEAD) held.add('up'); else if (ay > STICK_DEAD) held.add('down');
      }
    }
    this.input.setHeld('pad', held);
  }
}
