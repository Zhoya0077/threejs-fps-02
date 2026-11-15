// PUBG-style touch controls: a floating analog stick on the left half, drag
// to look on the right half, and on-screen buttons for fire, aim, jump,
// crouch, reload, weapon swap, grenades, use and buy. The layer stays hidden
// until the first real touch, so mouse-and-keyboard play — and the staged
// screenshots — never see it. All state flows through the input snapshot the
// sim already reads: held keys, the look accumulator, mouse buttons, edge
// presses and the analog move vector.
export function createTouch(input) {
  const ui = document.getElementById('touch-ui');
  const none = { isTouch() { return false; } };
  if (!ui) return none;
  const stickBase = document.getElementById('stick-base');
  const stickKnob = document.getElementById('stick-knob');
  const move = input.move;
  const RADIUS = 56;
  let seen = false;
  let stickId = -1;
  let lookId = -1;
  let stickOX = 0;
  let stickOY = 0;
  let lookX = 0;
  let lookY = 0;
  let crouchOn = false;

  function activate() {
    if (seen) return;
    seen = true;
    ui.classList.add('on');
    const controls = document.getElementById('controls');
    if (controls) {
      controls.innerHTML = 'Left thumb: analog stick to move · Right thumb: drag to look<br>Hold FIRE to shoot · AIM toggles aim · USE plants / defuses<br>BUY opens the shop · SWAP cycles weapons';
    }
  }

  function stickEnd() {
    stickId = -1;
    move.x = 0;
    move.y = 0;
    stickBase.style.display = 'none';
  }

  ui.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    activate();
    if (e.target.closest('.tbtn')) return;
    e.preventDefault();
    if (e.clientX < window.innerWidth * 0.45 && stickId === -1) {
      stickId = e.pointerId;
      stickOX = e.clientX;
      stickOY = e.clientY;
      stickBase.style.display = 'block';
      stickBase.style.left = `${stickOX}px`;
      stickBase.style.top = `${stickOY}px`;
      stickKnob.style.transform = 'translate(0px, 0px)';
      ui.setPointerCapture(e.pointerId);
    } else if (lookId === -1) {
      lookId = e.pointerId;
      lookX = e.clientX;
      lookY = e.clientY;
      ui.setPointerCapture(e.pointerId);
    }
  });

  ui.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      const dx = e.clientX - stickOX;
      const dy = e.clientY - stickOY;
      const len = Math.hypot(dx, dy);
      const cl = len > RADIUS ? RADIUS / len : 1;
      const x = dx * cl;
      const y = dy * cl;
      stickKnob.style.transform = `translate(${x}px, ${y}px)`;
      move.x = x / RADIUS;
      move.y = -y / RADIUS;
    } else if (e.pointerId === lookId) {
      input.look.x += (e.clientX - lookX) * 1.6;
      input.look.y += (e.clientY - lookY) * 1.6;
      lookX = e.clientX;
      lookY = e.clientY;
    }
  });

  function onUp(e) {
    if (e.pointerId === stickId) stickEnd();
    else if (e.pointerId === lookId) lookId = -1;
  }
  ui.addEventListener('pointerup', onUp);
  ui.addEventListener('pointercancel', onUp);

  // Hold buttons press on down and release on up; tap buttons fire one edge
  // press; toggles flip a held key and keep their lit state.
  function hold(id, down, up) {
    const btn = document.getElementById(id);
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('held');
      down();
    });
    function release(e) {
      if (e.pointerType !== 'touch') return;
      btn.classList.remove('held');
      up();
    }
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  function tap(id, fn, flash) {
    const btn = document.getElementById(id);
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      fn();
      if (flash === false) return;
      btn.classList.add('held');
      setTimeout(() => btn.classList.remove('held'), 120);
    });
  }

  hold('t-fire', () => { input.mouse.fire = true; }, () => { input.mouse.fire = false; });
  hold('t-use', () => { input.keys.add('KeyE'); }, () => { input.keys.delete('KeyE'); });
  tap('t-aim', () => {
    input.mouse.ads = !input.mouse.ads;
    document.getElementById('t-aim').classList.toggle('held', input.mouse.ads);
  }, false);
  tap('t-jump', () => input.press('Space'));
  tap('t-crouch', () => {
    crouchOn = !crouchOn;
    if (crouchOn) input.keys.add('KeyC');
    else input.keys.delete('KeyC');
    document.getElementById('t-crouch').classList.toggle('held', crouchOn);
  }, false);
  tap('t-reload', () => input.press('KeyR'));
  tap('t-swap', () => input.press('KeyQ'));
  tap('t-frag', () => input.press('KeyG'));
  tap('t-smoke', () => input.press('KeyF'));
  tap('t-buy', () => input.press('KeyB'));

  // The first touch anywhere — including the play button — arms the layer.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') activate();
  }, { passive: true });

  return {
    isTouch() {
      return seen;
    },
  };
}
