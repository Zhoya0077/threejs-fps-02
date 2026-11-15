// The HUD: health, ammo, money, timer, score, kill feed, minimap, buy menu,
// banners and overlays. All DOM, updated only when a value changes, so the
// per-frame cost is a handful of comparisons. The minimap redraws at 10 Hz
// from the same colliders the sim uses.
import { WEAPONS, GEAR, BUY_MENU } from './weapons.js';
import { aliveOf } from './state.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud(S, world) {
  const ui = {
    hud: el('hud'),
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    vignette: el('vignette'),
    timer: el('timer'),
    roundLabel: el('round-label'),
    scoreW: el('score-w'),
    scoreJ: el('score-j'),
    aliveW: el('alive-w'),
    aliveJ: el('alive-j'),
    bombInd: el('bomb-ind'),
    feed: el('feed'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    healthNum: el('health-num'),
    healthFill: el('health-fill'),
    armorInd: el('armor-ind'),
    weaponName: el('weapon-name'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    grenFrag: el('gren-frag'),
    grenSmoke: el('gren-smoke'),
    money: el('money'),
    chargeInd: el('charge-ind'),
    hint: el('hint'),
    channel: el('channel'),
    channelFill: el('channel-fill'),
    channelLabel: el('channel-label'),
    spectate: el('spectate'),
    minimap: el('minimap'),
    buyMenu: el('buy-menu'),
    buyList: el('buy-list'),
    buyMoney: el('buy-money'),
    buyMsg: el('buy-msg'),
    overlay: el('overlay'),
    overlayTitle: el('overlay-title'),
    overlayCopy: el('overlay-copy'),
    playBtn: el('play-btn'),
    restartBtn: el('restart-btn'),
  };
  const mapCtx = ui.minimap.getContext('2d');
  const last = {};
  let buyOpen = false;
  let bannerUntil = 0;
  let hitUntil = 0;
  let mapT = 0;
  let feedLen = -1;
  let feedLastT = -1;
  let onBuyCb = null;
  let onCloseCb = null;

  function setText(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }

  // Buy menu buttons, built once from the catalogue.
  BUY_MENU.forEach((item, i) => {
    const def = item.kind === 'gun' ? WEAPONS[item.id] : GEAR[item.id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy-item';
    btn.dataset.id = item.id;
    btn.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name"></span><span class="buy-price"></span>`;
    btn.querySelector('.buy-name').textContent = def.name;
    btn.querySelector('.buy-price').textContent = `$${def.price}`;
    btn.addEventListener('click', () => {
      if (onBuyCb) onBuyCb(item.id);
    });
    ui.buyList.appendChild(btn);
  });
  el('buy-close').addEventListener('click', () => {
    if (onCloseCb) onCloseCb();
  });

  function refreshBuy(player) {
    setText(ui.buyMoney, 'buyMoney', `$${player.money}`);
    for (const btn of ui.buyList.children) {
      const id = btn.dataset.id;
      const def = WEAPONS[id] || GEAR[id];
      const owned = id === 'armor'
        ? player.armor
        : WEAPONS[id]
          ? !!player.owned[id]
          : player.grenades[id] >= (GEAR[id].max || 2);
      btn.classList.toggle('owned', !!owned);
      btn.classList.toggle('poor', player.money < def.price && !owned);
    }
  }

  function drawMinimap(player) {
    const ctx = mapCtx;
    const W = ui.minimap.width;
    const H = ui.minimap.height;
    const sx = W / 64;
    const sz = H / 48;
    const px = (x) => (x + 32) * sx;
    const pz = (z) => (z + 24) * sz;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,22,26,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#6b655c';
    for (const c of world.colliders) {
      if (c.y1 - c.y0 < 0.5) continue;
      ctx.fillRect(px(c.x0), pz(c.z0), (c.x1 - c.x0) * sx, (c.z1 - c.z0) * sz);
    }
    ctx.strokeStyle = 'rgba(255,180,84,0.8)';
    ctx.lineWidth = 1;
    for (const key of ['A', 'B']) {
      const s = world.sites[key];
      ctx.strokeRect(px(s.x0), pz(s.z0), (s.x1 - s.x0) * sx, (s.z1 - s.z0) * sz);
      ctx.fillStyle = 'rgba(255,180,84,0.9)';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.fillText(key, px(s.x0) + 2, pz(s.z0) + 10);
    }
    // Allies always; enemies only where they were just heard shooting.
    for (const e of S.entities) {
      if (!e.alive) continue;
      if (e.team === 'W') {
        ctx.fillStyle = e.isPlayer ? '#ffffff' : '#2f8f83';
        ctx.beginPath();
        ctx.arc(px(e.pos.x), pz(e.pos.z), e.isPlayer ? 3.5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#c25e33';
    for (const s of S.sounds) {
      if (s.team === 'J' && S.time - s.t < 1.5) {
        ctx.beginPath();
        ctx.arc(px(s.x), pz(s.z), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (S.bomb.state === 'planted' || S.bomb.state === 'dropped') {
      ctx.fillStyle = '#ffb454';
      const bx = px(S.bomb.pos.x);
      const bz = pz(S.bomb.pos.z);
      ctx.beginPath();
      ctx.moveTo(bx, bz - 4);
      ctx.lineTo(bx + 4, bz);
      ctx.lineTo(bx, bz + 4);
      ctx.lineTo(bx - 4, bz);
      ctx.closePath();
      ctx.fill();
    }
    // Player facing wedge.
    if (player.alive) {
      const cx = px(player.pos.x);
      const cz = pz(player.pos.z);
      const fx = -Math.sin(player.yaw);
      const fz = -Math.cos(player.yaw);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(cx + fx * 7, cz + fz * 7);
      ctx.lineTo(cx - fz * 3.5, cz + fx * 3.5);
      ctx.lineTo(cx + fz * 3.5, cz - fx * 3.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  return {
    isBuyOpen() {
      return buyOpen;
    },
    onBuy(cb) {
      onBuyCb = cb;
    },
    onCloseBuy(cb) {
      onCloseCb = cb;
    },
    onPlay(cb) {
      ui.playBtn.addEventListener('click', cb);
    },
    onRestart(cb) {
      ui.restartBtn.addEventListener('click', cb);
    },

    openBuy(player) {
      buyOpen = true;
      ui.buyMenu.hidden = false;
      ui.buyMsg.textContent = '';
      refreshBuy(player);
    },
    closeBuy() {
      buyOpen = false;
      ui.buyMenu.hidden = true;
    },
    setBuyMsg(msg) {
      ui.buyMsg.textContent = msg;
    },
    refreshBuy,

    hitMarker(kill, head, holdMs) {
      ui.hitmarker.classList.add('on');
      ui.hitmarker.classList.toggle('kill', !!kill);
      ui.hitmarker.classList.toggle('head', !!head);
      hitUntil = performance.now() + (holdMs || 90);
    },

    showBanner(title, sub, cls, holdMs) {
      ui.bannerTitle.textContent = title;
      ui.bannerSub.textContent = sub || '';
      ui.banner.className = `show ${cls || ''}`;
      bannerUntil = performance.now() + (holdMs || 2600);
    },
    hideBanner() {
      ui.banner.className = '';
      bannerUntil = 0;
    },

    showOverlay(kind, data) {
      ui.overlay.hidden = false;
      ui.restartBtn.hidden = kind !== 'match';
      ui.playBtn.hidden = kind === 'match';
      if (kind === 'start') {
        ui.overlayTitle.textContent = 'SALTLINE';
        ui.overlayCopy.textContent = 'A round-based tactical shooter at a salt-harvest terminal. Hold the sites, or break them. First to five rounds takes the match.';
        ui.playBtn.textContent = 'Click to play';
      } else if (kind === 'paused') {
        ui.overlayTitle.textContent = 'Paused';
        ui.overlayCopy.textContent = 'The round waits for no one. Click to jump back in.';
        ui.playBtn.textContent = 'Resume';
      } else if (kind === 'match') {
        const won = data && data.winner === 'W';
        ui.overlayTitle.textContent = won ? 'TERMINAL HELD' : 'TERMINAL LOST';
        ui.overlayCopy.textContent = `Final score ${S.wins.W} — ${S.wins.J}. ${won ? 'The Wardens keep the salt.' : 'The Jackals broke through.'}`;
      }
    },
    hideOverlay() {
      ui.overlay.hidden = true;
    },

    setHint(text) {
      setText(ui.hint, 'hint', text);
    },

    update(player, spreadPx, dt, now) {
      // Timers.
      if (bannerUntil && now > bannerUntil) {
        ui.banner.className = '';
        bannerUntil = 0;
      }
      if (hitUntil && now > hitUntil) {
        ui.hitmarker.classList.remove('on', 'kill', 'head');
        hitUntil = 0;
      }

      // Crosshair gap follows live spread.
      const gap = Math.round(4 + spreadPx);
      if (last.gap !== gap) {
        last.gap = gap;
        ui.crosshair.style.setProperty('--gap', `${gap}px`);
      }
      ui.crosshair.style.opacity = player.alive && !buyOpen ? '1' : '0';

      const hp = Math.max(0, Math.ceil(player.hp));
      setText(ui.healthNum, 'hp', `${hp}`);
      const hpFrac = hp / 100;
      if (last.hpFrac !== hpFrac) {
        last.hpFrac = hpFrac;
        ui.healthFill.style.width = `${hpFrac * 100}%`;
        ui.healthFill.className = hpFrac > 0.5 ? '' : hpFrac > 0.25 ? 'low' : 'crit';
      }
      ui.armorInd.style.opacity = player.armor ? '1' : '0.25';

      const def = WEAPONS[player.weapon];
      const ammo = player.ammo[player.weapon];
      setText(ui.weaponName, 'gun', def.name);
      setText(ui.ammoMag, 'mag', player.reloading > 0 ? '--' : `${ammo.mag}`);
      setText(ui.ammoReserve, 'res', `/ ${ammo.reserve}`);
      ui.ammoMag.parentElement.classList.toggle('empty', ammo.mag === 0);
      setText(ui.grenFrag, 'frag', `Frag ${player.grenades.frag}`);
      setText(ui.grenSmoke, 'smoke', `Smoke ${player.grenades.smoke}`);
      setText(ui.money, 'money', `$${player.money}`);

      const t = Math.max(0, S.phaseT);
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      setText(ui.timer, 'timer', S.phase === 'buy' ? `BUY ${secs}` : S.phase === 'live' ? `${mins}:${String(secs).padStart(2, '0')}` : S.phase.toUpperCase());
      setText(ui.roundLabel, 'round', `ROUND ${S.round} · FIRST TO 5`);
      setText(ui.scoreW, 'sw', `${S.wins.W}`);
      setText(ui.scoreJ, 'sj', `${S.wins.J}`);
      setText(ui.aliveW, 'aw', `${aliveOf(S, 'W')}`);
      setText(ui.aliveJ, 'aj', `${aliveOf(S, 'J')}`);

      // Bomb line.
      let bombText = '';
      if (S.bomb.state === 'planted') {
        bombText = `CHARGE AT ${S.bomb.site} · ${Math.ceil(S.bomb.fuseLeft)}s`;
      } else if (S.bomb.state === 'dropped') {
        bombText = 'CHARGE DROPPED';
      } else if (S.bomb.state === 'carried') {
        bombText = 'CHARGE WITH THE JACKALS';
      }
      setText(ui.bombInd, 'bomb', bombText);
      ui.bombInd.className = S.bomb.state === 'planted' ? 'hot' : '';
      const carrying = player.hasCharge;
      ui.chargeInd.hidden = !carrying;
      if (carrying) setText(ui.chargeInd, 'carry', 'YOU CARRY THE CHARGE — PLANT AT A OR B');

      // Channel bar.
      if (player.channel && player.alive) {
        ui.channel.hidden = false;
        const total = player.channel === 'plant' ? 3 : 5;
        const frac = Math.min(1, player.channelT / total);
        ui.channelFill.style.width = `${frac * 100}%`;
        setText(ui.channelLabel, 'chan', player.channel === 'plant' ? 'PLANTING…' : 'DEFUSING…');
      } else {
        ui.channel.hidden = true;
      }

      // Damage vignette: hurt flash plus a low-health pulse.
      const hurt = Math.max(0, player.hurtT);
      const lowHp = hp <= 25 && player.alive ? 0.25 + Math.sin(now / 300) * 0.08 : 0;
      const vig = Math.min(0.85, hurt * 1.6 + lowHp + (player.alive ? 0 : 0.35));
      if (Math.abs((last.vig || 0) - vig) > 0.02) {
        last.vig = vig;
        ui.vignette.style.opacity = `${vig}`;
      }

      // Spectate line.
      if (!player.alive && S.phase === 'live') {
        ui.spectate.hidden = false;
        setText(ui.spectate, 'spec', 'You are down — spectating a teammate. Click to switch.');
      } else {
        ui.spectate.hidden = true;
      }

      // Kill feed.
      if (S.feed.length !== feedLen || (S.feed.length && S.feed[S.feed.length - 1].t !== feedLastT)) {
        feedLen = S.feed.length;
        feedLastT = S.feed.length ? S.feed[S.feed.length - 1].t : -1;
        ui.feed.innerHTML = '';
        for (const item of S.feed.slice(-5)) {
          const div = document.createElement('div');
          div.className = `feed-item ${item.cls}`;
          div.textContent = item.text;
          ui.feed.appendChild(div);
        }
      }

      // Minimap at 10 Hz.
      mapT -= dt;
      if (mapT <= 0) {
        mapT = 0.1;
        drawMinimap(player);
      }
      if (buyOpen) refreshBuy(player);
    },
  };
}
