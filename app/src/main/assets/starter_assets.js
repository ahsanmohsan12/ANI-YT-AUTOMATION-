// starter_assets.js - Starter Character PNGs, Procedural Parkour Background Stream, UI Pop Sounds & Confetti

(function () {
  let uiAudioCtx = null;

  function getUiAudioContext() {
    if (!uiAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) uiAudioCtx = new AudioCtx();
    }
    if (uiAudioCtx && uiAudioCtx.state === 'suspended') {
      uiAudioCtx.resume().catch(() => {});
    }
    return uiAudioCtx;
  }

  // Play a crisp cartoon "pop" sound when pressing chunky buttons
  function playPopSound(pitchMultiplier = 1.0) {
    try {
      const ctx = getUiAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340 * pitchMultiplier, now);
      osc.frequency.exponentialRampToValueAtTime(680 * pitchMultiplier, now + 0.065);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch (_) {}
  }

  function playCelebrationSound() {
    try {
      const ctx = getUiAudioContext();
      if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const now = ctx.currentTime + idx * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.26);
      });
    } catch (_) {}
  }

  // Generate transparent PNG DataURL for Character A (Left - Confident Orange Blocky Hero)
  // or Character B (Right - Silly Reacting Purple Robot/Noob Buddy)
  function createStarterCharacterDataUrl(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 580;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    function drawRoundRect(x, y, w, h, r, fill, strokeWidth = 10) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (strokeWidth > 0) {
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = '#1b1b1b';
        ctx.stroke();
      }
    }

    if (type === 'A') {
      // Character A: Confident Orange Blocky Adventurer with Cyan Headphones & Cap (Facing Right)
      // White sticker halo
      ctx.save();
      // Backpack
      drawRoundRect(68, 260, 75, 160, 22, '#3ddc6a', 10);
      // Legs
      drawRoundRect(150, 420, 68, 115, 16, '#2b6cb0', 10);
      drawRoundRect(245, 420, 68, 115, 16, '#2b6cb0', 10);
      // Boots
      drawRoundRect(142, 495, 84, 50, 14, '#8b4513', 10);
      drawRoundRect(238, 495, 84, 50, 14, '#8b4513', 10);
      // Torso
      drawRoundRect(130, 250, 200, 185, 26, '#ff9a5c', 10);
      // Star badge on shirt
      drawRoundRect(195, 305, 70, 56, 14, '#ffd93b', 8);
      // Arms
      drawRoundRect(88, 268, 56, 130, 22, '#ff9a5c', 10);
      drawRoundRect(316, 258, 86, 62, 22, '#ff9a5c', 10);
      // Head (Blocky Cartoon Cube)
      drawRoundRect(118, 78, 224, 188, 34, '#ffb37b', 10);
      // Cool Cap
      drawRoundRect(112, 54, 236, 56, 22, '#ff5c5c', 10);
      drawRoundRect(240, 82, 145, 28, 12, '#ff5c5c', 10);
      // Headphone band & earcups
      drawRoundRect(92, 125, 40, 92, 16, '#ffd93b', 10);
      // Confident Eyes (looking right)
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.arc(215, 165, 15, 0, Math.PI * 2);
      ctx.arc(285, 165, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(220, 160, 5, 0, Math.PI * 2);
      ctx.arc(290, 160, 5, 0, Math.PI * 2);
      ctx.fill();
      // Confident Eyebrows
      ctx.lineWidth = 9;
      ctx.strokeStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.moveTo(192, 138);
      ctx.lineTo(234, 144);
      ctx.moveTo(266, 144);
      ctx.lineTo(308, 136);
      ctx.stroke();
      // Big Confident Grin
      ctx.beginPath();
      ctx.arc(250, 196, 36, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.restore();
    } else {
      // Character B: Silly Reacting Purple Blocky Robot / Goofy Sidekick (Facing Left)
      ctx.save();
      // Antennae
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.moveTo(200, 85);
      ctx.lineTo(175, 36);
      ctx.moveTo(280, 85);
      ctx.lineTo(305, 36);
      ctx.stroke();
      drawRoundRect(155, 18, 36, 36, 18, '#ff7aa8', 8);
      drawRoundRect(288, 18, 36, 36, 18, '#ffd93b', 8);

      // Legs
      drawRoundRect(162, 420, 64, 115, 16, '#8a63d2', 10);
      drawRoundRect(254, 420, 64, 115, 16, '#8a63d2', 10);
      // Sneakers
      drawRoundRect(144, 495, 86, 48, 16, '#3ddc6a', 10);
      drawRoundRect(246, 495, 86, 48, 16, '#3ddc6a', 10);
      // Torso
      drawRoundRect(140, 254, 200, 180, 26, '#b79cff', 10);
      // Chest screen meter
      drawRoundRect(176, 292, 128, 72, 14, '#bfe9ff', 8);
      // Waving left arm & right arm
      drawRoundRect(74, 240, 82, 58, 22, '#b79cff', 10);
      drawRoundRect(326, 270, 56, 125, 22, '#b79cff', 10);
      // Head
      drawRoundRect(116, 82, 248, 184, 34, '#c8b2ff', 10);
      // Ear bolts
      drawRoundRect(88, 142, 34, 64, 12, '#ff7aa8', 9);
      drawRoundRect(358, 142, 34, 64, 12, '#ff7aa8', 9);
      // Big Goofy Surprised Eyes (looking left)
      drawRoundRect(150, 126, 62, 62, 31, '#ffffff', 8);
      drawRoundRect(242, 126, 62, 62, 31, '#ffffff', 8);
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.arc(174, 158, 13, 0, Math.PI * 2);
      ctx.arc(266, 158, 13, 0, Math.PI * 2);
      ctx.fill();
      // Silly Wavy / Shocked Mouth
      drawRoundRect(184, 204, 88, 38, 16, '#ff7aa8', 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(202, 208, 52, 12);
      ctx.restore();
    }

    return canvas.toDataURL('image/png');
  }

  // Confetti burst overlay when video rendering finishes
  function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    canvas.classList.remove('hidden');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');

    const colors = ['#ffd93b', '#ff7aa8', '#3ddc6a', '#ff9a5c', '#b79cff', '#bfe9ff'];
    const pieces = Array.from({ length: 85 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 180,
      w: 10 + Math.random() * 10,
      h: 8 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 6,
      vy: 3.5 + Math.random() * 5.5,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.2
    }));

    let start = performance.now();
    function step(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#1b1b1b';
        ctx.lineWidth = 2;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (elapsed < 3200) {
        requestAnimationFrame(step);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.classList.add('hidden');
      }
    }
    requestAnimationFrame(step);
  }

  // Procedural Blocky Parkour Background Renderer (used when starter background video is active)
  function drawProceduralParkourFrame(ctx, width, height, timeSec) {
    // Sky gradient in 2D cartoon style
    ctx.fillStyle = '#6ec6ff';
    ctx.fillRect(0, 0, width, height);

    // Distant floating voxel clouds
    const cloudOffset = (timeSec * 45) % (width + 300);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 320 - cloudOffset + width + 300) % (width + 300)) - 150;
      const cy = 140 + (i % 2) * 110;
      ctx.beginPath();
      ctx.roundRect(cx, cy, 170, 56, 20);
      ctx.fill();
      ctx.stroke();
    }

    // Perspective 3D Voxel Parkour Stepping Blocks scrolling toward viewer
    const speed = timeSec * 2.8;
    const horizonY = height * 0.34;
    const totalSteps = 14;

    for (let i = totalSteps; i >= 1; i--) {
      const progress = ((i - (speed % 1)) / totalSteps);
      const depth = Math.pow(1 - progress, 1.65);
      const y = horizonY + depth * (height * 0.72);
      const stepIndex = Math.floor(speed) + i;
      const lane = Math.sin(stepIndex * 1.35) * 0.42;
      const centerX = width * 0.5 + lane * width * (0.15 + depth * 0.55);
      const blockW = 70 + depth * 320;
      const blockH = 26 + depth * 95;

      const palette = ['#3ddc6a', '#ffd93b', '#ff7aa8', '#ff9a5c', '#b79cff'];
      const topColor = palette[Math.abs(stepIndex) % palette.length];

      // Block shadow/side
      ctx.fillStyle = '#2d3748';
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = Math.max(3, depth * 6);
      ctx.beginPath();
      ctx.roundRect(centerX - blockW / 2, y, blockW, blockH, 12);
      ctx.fill();
      ctx.stroke();

      // Block grass/neon top surface
      ctx.fillStyle = topColor;
      ctx.beginPath();
      ctx.roundRect(centerX - blockW / 2, y - blockH * 0.28, blockW, blockH * 0.55, 12);
      ctx.fill();
      ctx.stroke();
    }

    // Floating collectible coins
    const coinBounce = Math.sin(timeSec * 6) * 14;
    ctx.fillStyle = '#ffd93b';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(width * 0.5 + Math.sin(timeSec * 2.2) * 120, height * 0.62 + coinBounce, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  window.StarterAssets = {
    playPopSound,
    playCelebrationSound,
    createStarterCharacterDataUrl,
    launchConfetti,
    drawProceduralParkourFrame
  };
})();
