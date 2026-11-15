// Keyboard, mouse and pointer lock. The sim reads a snapshot: held keys,
// accumulated look deltas, and edge-triggered presses consumed once per tick.
// Nothing here knows about the game; main.js maps presses to actions.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const look = { x: 0, y: 0 };
  const mouse = { fire: false, ads: false };
  // Analog move vector, written by touch controls: x strafe, y forward.
  const move = { x: 0, y: 0 };
  let locked = false;
  let wheelDelta = 0;

  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onMouseMove(e) {
    if (!locked) return;
    look.x += e.movementX || 0;
    look.y += e.movementY || 0;
  }

  function onMouseDown(e) {
    if (!locked) return;
    if (e.button === 0) mouse.fire = true;
    if (e.button === 2) mouse.ads = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) mouse.fire = false;
    if (e.button === 2) mouse.ads = false;
  }

  function onWheel(e) {
    if (!locked) return;
    wheelDelta += Math.sign(e.deltaY);
  }

  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      mouse.fire = false;
      mouse.ads = false;
      keys.clear();
    }
    if (onLockChange) onLockChange(locked);
  }

  function onBlur() {
    keys.clear();
    pressed.clear();
    mouse.fire = false;
    mouse.ads = false;
    move.x = 0;
    move.y = 0;
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('pointerlockchange', onLock);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    keys,
    look,
    mouse,
    move,
    isLocked() {
      return locked;
    },
    requestLock() {
      if (!locked) canvas.requestPointerLock();
    },
    releaseLock() {
      if (locked) document.exitPointerLock();
    },
    // Edge trigger: true once per physical press, consumed by the caller.
    // press() injects one from another device, e.g. a touch button.
    press(code) {
      pressed.add(code);
    },
    wasPressed(code) {
      if (pressed.has(code)) {
        pressed.delete(code);
        return true;
      }
      return false;
    },
    takeLook() {
      const out = { x: look.x, y: look.y };
      look.x = 0;
      look.y = 0;
      return out;
    },
    takeWheel() {
      const d = wheelDelta;
      wheelDelta = 0;
      return d;
    },
  };
}
