// render_engine.js - 1080x1920 (9:16) Canvas Compositor, AnalyserNode Bounce, 7 Caption Templates & MediaRecorder Mixer

(function () {
  const FRAME_W = 1080;
  const FRAME_H = 1920;
  const GAP_SEC = 0.15;

  // Back-out easing for 0.25s character slide-in pop/bounce
  function easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const t = Math.max(0, Math.min(1, x));
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function easeInBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const t = Math.max(0, Math.min(1, x));
    return c3 * t * t * t - c1 * t * t;
  }

  // Compute timeline intervals for all dialogue lines with 0.15s gap between lines
  function buildTimeline(lines) {
    let cursor = 0;
    const segments = [];
    lines.forEach((line, index) => {
      const dur = Math.max(0.6, Number(line.durationSec) || 1.8);
      const start = cursor;
      const end = start + dur;
      segments.push({
        index,
        speaker: line.speaker || (index % 2 === 0 ? 'A' : 'B'),
        text: (line.text || '').trim(),
        audioBuffer: line.audioBuffer || null,
        startSec: start,
        endSec: end,
        durationSec: dur
      });
      cursor = end + (index < lines.length - 1 ? GAP_SEC : 0);
    });
    return {
      segments,
      totalDurationSec: Math.max(1.0, cursor)
    };
  }

  // Sample RMS loudness (0.0 -> 1.0) from an AnalyserNode
  function sampleLoudnessFromAnalyser(analyser, dataArray) {
    if (!analyser || !dataArray) return 0;
    analyser.getByteTimeDomainData(dataArray);
    let sumSq = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const norm = (dataArray[i] - 128) / 128;
      sumSq += norm * norm;
    }
    const rms = Math.sqrt(sumSq / dataArray.length);
    return Math.min(1.0, rms * 3.8);
  }

  // Draw Background Layer (Fill, Fit + Blur, or Custom Zoom/Pan) covering full 1080x1920 frame
  function drawBackgroundLayer(ctx, bgVideoEl, useProceduralBg, settings, currentTimeSec) {
    ctx.save();
    const fitMode = settings.bgFit || 'fill';

    if (useProceduralBg || !bgVideoEl || !bgVideoEl.videoWidth) {
      // Draw procedural parkour background onto an offscreen or direct canvas
      if (fitMode === 'fit_blur') {
        // Draw full background first, then a framed 16:9 box in the middle to demonstrate Fit + Blur
        window.StarterAssets.drawProceduralParkourFrame(ctx, FRAME_W, FRAME_H, currentTimeSec);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fillRect(0, 0, FRAME_W, FRAME_H);
        const boxH = Math.round(FRAME_W * (9 / 16));
        const boxY = Math.round((FRAME_H - boxH) / 2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, boxY, FRAME_W, boxH);
        ctx.clip();
        window.StarterAssets.drawProceduralParkourFrame(ctx, FRAME_W, FRAME_H, currentTimeSec);
        ctx.restore();
        ctx.strokeStyle = '#1b1b1b';
        ctx.lineWidth = 6;
        ctx.strokeRect(0, boxY, FRAME_W, boxH);
      } else if (fitMode === 'custom') {
        const zoom = Math.max(1.0, (Number(settings.bgZoom) || 120) / 100);
        const panX = ((Number(settings.bgPanX) || 0) / 100) * (FRAME_W * (zoom - 1) * 0.5);
        const panY = ((Number(settings.bgPanY) || 0) / 100) * (FRAME_H * (zoom - 1) * 0.5);
        ctx.translate(FRAME_W / 2 + panX, FRAME_H / 2 + panY);
        ctx.scale(zoom, zoom);
        ctx.translate(-FRAME_W / 2, -FRAME_H / 2);
        window.StarterAssets.drawProceduralParkourFrame(ctx, FRAME_W, FRAME_H, currentTimeSec);
      } else {
        window.StarterAssets.drawProceduralParkourFrame(ctx, FRAME_W, FRAME_H, currentTimeSec);
      }
      ctx.restore();
      return;
    }

    const vw = bgVideoEl.videoWidth || 1080;
    const vh = bgVideoEl.videoHeight || 1920;
    const coverScale = Math.max(FRAME_W / vw, FRAME_H / vh);
    const containScale = Math.min(FRAME_W / vw, FRAME_H / vh);

    if (fitMode === 'fill') {
      const drawW = vw * coverScale;
      const drawH = vh * coverScale;
      const dx = (FRAME_W - drawW) / 2;
      const dy = (FRAME_H - drawH) / 2;
      ctx.drawImage(bgVideoEl, dx, dy, drawW, drawH);
    } else if (fitMode === 'fit_blur') {
      // 1. Blurred scaled background covering 100% of 1080x1920
      const bgW = vw * coverScale * 1.12;
      const bgH = vh * coverScale * 1.12;
      const bgX = (FRAME_W - bgW) / 2;
      const bgY = (FRAME_H - bgH) / 2;
      ctx.save();
      ctx.filter = 'blur(28px) brightness(0.82)';
      ctx.drawImage(bgVideoEl, bgX, bgY, bgW, bgH);
      ctx.restore();

      // 2. Sharp uncropped whole video in the middle
      const fgW = vw * containScale;
      const fgH = vh * containScale;
      const fgX = (FRAME_W - fgW) / 2;
      const fgY = (FRAME_H - fgH) / 2;
      ctx.drawImage(bgVideoEl, fgX, fgY, fgW, fgH);
    } else if (fitMode === 'custom') {
      const zoom = Math.max(1.0, (Number(settings.bgZoom) || 100) / 100);
      const drawW = vw * coverScale * zoom;
      const drawH = vh * coverScale * zoom;
      const maxOffsetX = Math.max(0, (drawW - FRAME_W) / 2);
      const maxOffsetY = Math.max(0, (drawH - FRAME_H) / 2);
      const panX = ((Number(settings.bgPanX) || 0) / 100) * maxOffsetX;
      const panY = ((Number(settings.bgPanY) || 0) / 100) * maxOffsetY;
      const dx = (FRAME_W - drawW) / 2 + panX;
      const dy = (FRAME_H - drawH) / 2 + panY;
      ctx.drawImage(bgVideoEl, dx, dy, drawW, drawH);
    }

    ctx.restore();
  }

  // Draw Character A (Left) and Character B (Right) around vertical middle (50% default)
  function drawCharactersLayer(ctx, charAImg, charBImg, activeSeg, settings, timeInSegSec, loudness) {
    const baseWidthRatio = 0.40 * ((Number(settings.charSize) || 100) / 100);
    const charW = FRAME_W * baseWidthRatio;
    const centerY = FRAME_H * ((Number(settings.charVerticalPos) || 50) / 100);
    const edgeOffsetPx = FRAME_W * ((Number(settings.charEdgeDist) ?? 4) / 100);
    const silentMode = settings.silentMode || 'hide';
    const slideDur = 0.25;

    const activeSpeaker = activeSeg ? activeSeg.speaker : 'A';
    const segDur = activeSeg ? activeSeg.durationSec : 2.0;

    function drawSingleChar(side, img, isSpeaking) {
      if (!img) return;
      if (!isSpeaking && silentMode === 'hide') return;

      const aspect = (img.naturalHeight && img.naturalWidth)
        ? (img.naturalHeight / img.naturalWidth)
        : 1.2;
      const w = charW;
      const h = w * aspect;

      const restingX = side === 'A'
        ? edgeOffsetPx
        : (FRAME_W - edgeOffsetPx - w);

      const offscreenX = side === 'A'
        ? (-w - 60)
        : (FRAME_W + 60);

      let currentX = restingX;
      let popScale = 1.0;
      let alpha = 1.0;

      if (isSpeaking) {
        // Slide-in during first 0.25s, slide-out during last 0.18s if silentMode === 'hide'
        if (timeInSegSec < slideDur) {
          const p = timeInSegSec / slideDur;
          const eased = easeOutBack(p);
          currentX = offscreenX + (restingX - offscreenX) * eased;
          popScale = 0.86 + 0.14 * eased;
        } else if (silentMode === 'hide' && segDur - timeInSegSec < 0.16 && segDur > 0.5) {
          const outP = 1 - (segDur - timeInSegSec) / 0.16;
          const easedOut = easeInBack(outP);
          currentX = restingX + (offscreenX - restingX) * easedOut;
        }
        // Talking audio-synced bounce & scale
        const talkBounce = 1.0 + loudness * 0.11;
        popScale *= talkBounce;
      } else {
        // Dim and shrink silent character
        popScale = 0.76;
        alpha = 0.45;
      }

      const drawW = w * popScale;
      const drawH = h * popScale;
      const drawCenterX = currentX + w / 2;
      const bounceOffsetY = isSpeaking ? (-loudness * 22) : 0;
      const drawX = drawCenterX - drawW / 2;
      const drawY = centerY - drawH / 2 + bounceOffsetY;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();
    }

    // Draw silent character first (if dim_shrink), then active speaker on top
    if (activeSpeaker === 'A') {
      drawSingleChar('B', charBImg, false);
      drawSingleChar('A', charAImg, true);
    } else {
      drawSingleChar('A', charAImg, false);
      drawSingleChar('B', charBImg, true);
    }
  }

  // Draw Captions Layer with 7 Templates, Word Chunking, Speaker Tag & Language Fonts
  function drawCaptionsLayer(ctx, activeSeg, settings, timeInSegSec, charNames) {
    if (!settings.captionsEnabled || !activeSeg || !activeSeg.text) return;

    const words = activeSeg.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const totalWords = words.length;
    const progress = Math.max(0, Math.min(0.9999, timeInSegSec / Math.max(0.2, activeSeg.durationSec)));
    const activeWordGlobalIdx = Math.floor(progress * totalWords);
    const wordProgressWithinCurrent = (progress * totalWords) - activeWordGlobalIdx;

    const wordsPerScreen = Math.max(1, Math.min(4, Number(settings.wordsPerScreen) || 3));
    const chunkIndex = Math.floor(activeWordGlobalIdx / wordsPerScreen);
    const chunkStart = chunkIndex * wordsPerScreen;
    const chunkWords = words.slice(chunkStart, chunkStart + wordsPerScreen);
    const activeWordInChunk = activeWordGlobalIdx - chunkStart;

    const template = settings.captionTemplate || 'classic_yellow';
    const fontFamily = settings.captionFont || 'Fredoka';
    const fontSize = Math.max(42, Math.min(115, Number(settings.captionSize) || 74));
    const outlineWidth = Math.max(0, Math.min(24, Number(settings.outlineThickness) ?? 10));
    const highlightColor = settings.highlightColor || '#ffd93b';

    // Position: top (20%), center (52%), bottom third default (79%)
    let baseY = FRAME_H * 0.79;
    if (settings.captionPosition === 'top') baseY = FRAME_H * 0.20;
    else if (settings.captionPosition === 'center') baseY = FRAME_H * 0.52;

    ctx.save();
    const effectiveFont = template === 'comic' ? 'Bangers' : fontFamily;
    ctx.font = `900 ${fontSize}px '${effectiveFont}', 'Baloo 2', sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Optional Speaker Name Tag in character's color
    if (settings.showSpeakerTag) {
      const speakerLabel = activeSeg.speaker === 'A'
        ? (charNames.charAName || 'A')
        : (charNames.charBName || 'B');
      const tagColor = activeSeg.speaker === 'A' ? '#ff9a5c' : '#b79cff';
      ctx.save();
      ctx.font = `800 ${Math.round(fontSize * 0.52)}px '${fontFamily}', sans-serif`;
      const tagMetrics = ctx.measureText(speakerLabel.toUpperCase());
      const tagW = tagMetrics.width + 48;
      const tagH = Math.round(fontSize * 0.76);
      const tagX = (FRAME_W - tagW) / 2;
      const tagY = baseY - fontSize * 1.15 - tagH / 2;

      ctx.fillStyle = tagColor;
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 18);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#1b1b1b';
      ctx.textAlign = 'center';
      ctx.fillText(speakerLabel.toUpperCase(), FRAME_W / 2, tagY + tagH / 2 + 2);
      ctx.restore();
    }

    // Measure word widths and wrap into 1 or 2 balanced lines if wider than 920px
    const spaceW = ctx.measureText(' ').width * 1.15;
    const maxLineW = FRAME_W * 0.86;
    const linesOfWords = [[]];
    let currentLineW = 0;

    chunkWords.forEach((word, idx) => {
      const displayWord = (template === 'classic_yellow' || template === 'comic' || template === 'pop_bounce')
        ? word.toUpperCase()
        : word;
      const wWidth = ctx.measureText(displayWord).width;
      if (currentLineW + wWidth > maxLineW && linesOfWords[linesOfWords.length - 1].length > 0) {
        linesOfWords.push([]);
        currentLineW = 0;
      }
      linesOfWords[linesOfWords.length - 1].push({
        text: displayWord,
        width: wWidth,
        isCurrent: idx === activeWordInChunk,
        isPast: idx < activeWordInChunk
      });
      currentLineW += wWidth + spaceW;
    });

    const lineHeight = fontSize * 1.26;
    const totalBlockH = linesOfWords.length * lineHeight;
    const startY = baseY - totalBlockH / 2 + lineHeight / 2;

    // Background container for 'boxed' or 'comic' templates
    if (template === 'boxed' || template === 'comic') {
      let maxRowW = 0;
      linesOfWords.forEach((row) => {
        const rw = row.reduce((acc, item) => acc + item.width, 0) + Math.max(0, row.length - 1) * spaceW;
        if (rw > maxRowW) maxRowW = rw;
      });
      const padX = 42;
      const padY = 26;
      const boxW = maxRowW + padX * 2;
      const boxH = totalBlockH + padY * 2;
      const boxX = (FRAME_W - boxW) / 2;
      const boxY = baseY - boxH / 2;

      ctx.save();
      if (template === 'boxed') {
        ctx.fillStyle = 'rgba(20, 20, 24, 0.82)';
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 28);
        ctx.fill();
      } else if (template === 'comic') {
        ctx.translate(FRAME_W / 2, baseY);
        ctx.rotate(-0.035);
        ctx.translate(-FRAME_W / 2, -baseY);
        ctx.fillStyle = '#ff5c5c';
        ctx.strokeStyle = '#1b1b1b';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 20);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw each row of words
    linesOfWords.forEach((row, rowIndex) => {
      const rowW = row.reduce((acc, item) => acc + item.width, 0) + Math.max(0, row.length - 1) * spaceW;
      let cursorX = (FRAME_W - rowW) / 2;
      const rowY = startY + rowIndex * lineHeight;

      row.forEach((wordObj) => {
        const wordCenterX = cursorX + wordObj.width / 2;
        ctx.save();

        if (template === 'ae_hormozi') {
          // Adobe After Effects Hormozi Pop (3D offset shadow + elastic overshoot + neon green/yellow)
          const isCurr = wordObj.isCurrent;
          const bounceScale = isCurr
            ? (1.0 + 0.30 * Math.sin(Math.min(1, wordProgressWithinCurrent * 1.5) * Math.PI))
            : 1.0;
          ctx.translate(wordCenterX, rowY);
          ctx.scale(bounceScale, bounceScale);
          if (isCurr) ctx.rotate(-0.035);
          ctx.textAlign = 'center';
          // 3D hard drop shadow
          ctx.shadowColor = '#000000';
          ctx.shadowOffsetX = 8;
          ctx.shadowOffsetY = 8;
          ctx.shadowBlur = 0;
          // Outer thick black sticker outline
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = Math.max(12, outlineWidth * 2.5);
          ctx.strokeText(wordObj.text, 0, 0);
          ctx.shadowColor = 'transparent';
          // Inner fill: bright neon green or selected highlight
          ctx.fillStyle = isCurr ? (highlightColor || '#00ff66') : '#ffffff';
          ctx.fillText(wordObj.text, 0, 0);
        } else if (template === 'ae_kinetic') {
          // Adobe After Effects Kinetic Word Snap (rapid cut zoom-in with action badge)
          const isCurr = wordObj.isCurrent;
          const snapScale = isCurr
            ? (wordProgressWithinCurrent < 0.22 ? 1.34 : 1.08)
            : 0.95;
          ctx.translate(wordCenterX, rowY);
          ctx.scale(snapScale, snapScale);
          ctx.textAlign = 'center';
          if (isCurr) {
            ctx.fillStyle = '#ff1a40';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.roundRect(-wordObj.width * 0.62, -fontSize * 0.62, wordObj.width * 1.24, fontSize * 1.24, 14);
            ctx.fill();
            ctx.stroke();
          }
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = Math.max(10, outlineWidth * 2.2);
          ctx.strokeText(wordObj.text, 0, 0);
          ctx.fillStyle = isCurr ? '#ffd93b' : '#ffffff';
          ctx.fillText(wordObj.text, 0, 0);
        } else if (template === 'ae_glow') {
          // Adobe After Effects Cyber Neon Glow with Chromatic Aberration RGB split
          const isCurr = wordObj.isCurrent;
          ctx.textAlign = 'center';
          // Chromatic cyan & magenta fringe
          if (isCurr) {
            ctx.save();
            ctx.shadowColor = '#00f5ff';
            ctx.shadowBlur = 32;
            ctx.fillStyle = 'rgba(0, 245, 255, 0.75)';
            ctx.fillText(wordObj.text, wordCenterX - 4, rowY);
            ctx.shadowColor = '#ff007f';
            ctx.shadowBlur = 32;
            ctx.fillStyle = 'rgba(255, 0, 127, 0.75)';
            ctx.fillText(wordObj.text, wordCenterX + 4, rowY);
            ctx.restore();
          }
          if (outlineWidth > 0) {
            ctx.strokeStyle = '#080318';
            ctx.lineWidth = Math.max(8, outlineWidth * 1.8);
            ctx.strokeText(wordObj.text, wordCenterX, rowY);
          }
          ctx.fillStyle = isCurr ? '#ffd93b' : '#ffffff';
          ctx.fillText(wordObj.text, wordCenterX, rowY);
        } else if (template === 'ae_beast') {
          // Adobe After Effects MrBeast Action Badge
          const isCurr = wordObj.isCurrent;
          ctx.translate(wordCenterX, rowY);
          if (isCurr) ctx.rotate(-0.04);
          ctx.textAlign = 'center';
          if (isCurr) {
            ctx.save();
            ctx.fillStyle = '#ffd93b';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 7;
            ctx.shadowColor = '#000000';
            ctx.shadowOffsetX = 7;
            ctx.shadowOffsetY = 7;
            ctx.beginPath();
            ctx.roundRect(-wordObj.width * 0.60, -fontSize * 0.58, wordObj.width * 1.20, fontSize * 1.16, 16);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
            ctx.fillStyle = '#000000';
            ctx.fillText(wordObj.text, 0, 0);
          } else {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = Math.max(10, outlineWidth * 2.2);
            ctx.shadowColor = '#000000';
            ctx.shadowOffsetX = 5;
            ctx.shadowOffsetY = 5;
            ctx.strokeText(wordObj.text, 0, 0);
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(wordObj.text, 0, 0);
          }
        } else if (template === 'ae_split') {
          // Adobe After Effects Cutout Capsule
          const isCurr = wordObj.isCurrent;
          if (isCurr) {
            ctx.fillStyle = highlightColor || '#ffd93b';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.roundRect(cursorX - 14, rowY - fontSize * 0.58, wordObj.width + 28, fontSize * 1.16, 18);
            ctx.fill();
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.fillStyle = '#000000';
            ctx.fillText(wordObj.text, wordCenterX, rowY);
          } else {
            ctx.textAlign = 'center';
            if (outlineWidth > 0) {
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = outlineWidth * 1.8;
              ctx.strokeText(wordObj.text, wordCenterX, rowY);
            }
            ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
            ctx.fillText(wordObj.text, wordCenterX, rowY);
          }
        } else if (template === 'classic_yellow') {
          ctx.textAlign = 'center';
          if (outlineWidth > 0) {
            ctx.strokeStyle = '#1b1b1b';
            ctx.lineWidth = outlineWidth * 2;
            ctx.strokeText(wordObj.text, wordCenterX, rowY);
          }
          ctx.fillStyle = wordObj.isCurrent ? highlightColor : '#ffffff';
          ctx.fillText(wordObj.text, wordCenterX, rowY);
        } else if (template === 'pop_bounce') {
          const bounceScale = wordObj.isCurrent
            ? (1.0 + 0.22 * Math.sin(Math.min(1, wordProgressWithinCurrent * 1.6) * Math.PI))
            : 1.0;
          ctx.translate(wordCenterX, rowY);
          ctx.scale(bounceScale, bounceScale);
          ctx.textAlign = 'center';
          if (outlineWidth > 0) {
            ctx.strokeStyle = '#1b1b1b';
            ctx.lineWidth = outlineWidth * 2;
            ctx.strokeText(wordObj.text, 0, 0);
          }
          ctx.fillStyle = wordObj.isCurrent ? (settings.highlightColor || '#3ddc6a') : '#ffffff';
          ctx.fillText(wordObj.text, 0, 0);
        } else if (template === 'neon_glow') {
          ctx.textAlign = 'center';
          const glowColor = wordObj.isCurrent ? '#ff7aa8' : '#00f5ff';
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = 28;
          if (outlineWidth > 0) {
            ctx.strokeStyle = '#120824';
            ctx.lineWidth = Math.max(6, outlineWidth * 1.4);
            ctx.strokeText(wordObj.text, wordCenterX, rowY);
          }
          ctx.fillStyle = wordObj.isCurrent ? '#ffd93b' : '#e0ffff';
          ctx.fillText(wordObj.text, wordCenterX, rowY);
        } else if (template === 'minimal_clean') {
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 4;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(wordObj.text, wordCenterX, rowY);
        } else if (template === 'boxed') {
          if (wordObj.isCurrent) {
            ctx.fillStyle = highlightColor;
            ctx.strokeStyle = '#1b1b1b';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.roundRect(cursorX - 12, rowY - fontSize * 0.56, wordObj.width + 24, fontSize * 1.12, 16);
            ctx.fill();
            ctx.stroke();
          }
          ctx.textAlign = 'center';
          ctx.fillStyle = wordObj.isCurrent ? '#1b1b1b' : '#ffffff';
          ctx.fillText(wordObj.text, wordCenterX, rowY);
        } else if (template === 'karaoke' || template === 'ae_wave') {
          ctx.textAlign = 'left';
          if (outlineWidth > 0) {
            ctx.strokeStyle = '#1b1b1b';
            ctx.lineWidth = outlineWidth * 1.8;
            ctx.strokeText(wordObj.text, cursorX, rowY);
          }
          // Base unfilled white text
          ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.fillText(wordObj.text, cursorX, rowY);

          // Progressive fill for past & current spoken words
          const fillFraction = wordObj.isPast ? 1.0 : (wordObj.isCurrent ? wordProgressWithinCurrent : 0.0);
          if (fillFraction > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(cursorX, rowY - fontSize, wordObj.width * fillFraction, fontSize * 2);
            ctx.clip();
            ctx.fillStyle = highlightColor || '#ffd93b';
            ctx.fillText(wordObj.text, cursorX, rowY);
            ctx.restore();
          }
        } else if (template === 'comic') {
          ctx.textAlign = 'center';
          ctx.strokeStyle = '#1b1b1b';
          ctx.lineWidth = Math.max(10, outlineWidth * 2.1);
          ctx.strokeText(wordObj.text, wordCenterX, rowY);
          ctx.fillStyle = wordObj.isCurrent ? '#ffd93b' : '#ffffff';
          ctx.fillText(wordObj.text, wordCenterX, rowY);
        }

        ctx.restore();
        cursorX += wordObj.width + spaceW;
      });
    });

    ctx.restore();
  }

  // Render a single composite 1080x1920 frame
  function renderCompositeFrame(params) {
    const {
      ctx,
      bgVideoEl,
      useProceduralBg,
      charAImg,
      charBImg,
      charNames,
      timeline,
      settings,
      currentTimeSec,
      liveLoudness
    } = params;

    ctx.clearRect(0, 0, FRAME_W, FRAME_H);

    // 1. Background
    drawBackgroundLayer(ctx, bgVideoEl, useProceduralBg, settings, currentTimeSec);

    // 2. Determine active dialogue segment at currentTimeSec
    let activeSeg = timeline.segments.find(
      (s) => currentTimeSec >= s.startSec && currentTimeSec <= s.endSec
    );
    if (!activeSeg && timeline.segments.length > 0) {
      // During the 0.15s inter-line gap, hold previous segment without speaking bounce
      const prev = timeline.segments
        .slice()
        .reverse()
        .find((s) => currentTimeSec >= s.endSec);
      activeSeg = prev || timeline.segments[0];
    }

    const isInsideActiveWindow = activeSeg
      ? (currentTimeSec >= activeSeg.startSec && currentTimeSec <= activeSeg.endSec)
      : false;
    const timeInSegSec = activeSeg
      ? Math.max(0, currentTimeSec - activeSeg.startSec)
      : 0;
    const effectiveLoudness = isInsideActiveWindow ? liveLoudness : 0;

    // 3. Characters
    drawCharactersLayer(ctx, charAImg, charBImg, activeSeg, settings, timeInSegSec, effectiveLoudness);

    // 4. Captions
    if (isInsideActiveWindow && activeSeg) {
      drawCaptionsLayer(ctx, activeSeg, settings, timeInSegSec, charNames);
    }
  }

  // Full 1080x1920 Video & Audio Render Pipeline using Web Audio API + MediaRecorder
  async function recordFullVideo(options) {
    const {
      bgVideoEl,
      useProceduralBg,
      charAImg,
      charBImg,
      charNames,
      lines,
      settings,
      onProgress
    } = options;

    const timeline = buildTimeline(lines);
    const totalDurationSec = timeline.totalDurationSec;

    // Offscreen 1080x1920 canvas
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = FRAME_W;
    renderCanvas.height = FRAME_H;
    const ctx = renderCanvas.getContext('2d');

    // Web Audio API Context + MediaStreamAudioDestinationNode + AnalyserNode
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const mixDestination = audioCtx.createMediaStreamDestination();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    const analyserData = new Uint8Array(analyser.frequencyBinCount);

    // Monitor gain so user hears the render lightly without clipping
    const monitorGain = audioCtx.createGain();
    monitorGain.gain.value = 0.7;
    monitorGain.connect(audioCtx.destination);

    // Connect analyser to both the recorded MediaStreamAudioDestinationNode and monitor output
    analyser.connect(mixDestination);
    analyser.connect(monitorGain);

    // Background audio source at user volume slider (default 10%)
    const bgVolume = Math.max(0, Math.min(1, (Number(settings.bgVolume) ?? 10) / 100));
    const bgGainNode = audioCtx.createGain();
    bgGainNode.gain.value = bgVolume;
    bgGainNode.connect(mixDestination);
    bgGainNode.connect(monitorGain);

    let bgOscillators = [];
    let videoClone = null;

    if (!useProceduralBg && bgVideoEl && bgVideoEl.src) {
      try {
        videoClone = bgVideoEl.cloneNode(true);
        videoClone.muted = false;
        videoClone.volume = 1.0;
        videoClone.loop = true;
        videoClone.crossOrigin = 'anonymous';
        await new Promise((res) => {
          if (videoClone.readyState >= 2) return res();
          videoClone.onloadeddata = () => res();
          videoClone.onerror = () => res();
          setTimeout(res, 1200);
        });

        // Handle start offset rule if video is longer than dialogue length
        const vidDur = Number(videoClone.duration) || 0;
        let startOffset = 0;
        if (vidDur > totalDurationSec && settings.bgTrimMode === 'random') {
          startOffset = Math.random() * Math.max(0, vidDur - totalDurationSec);
        }
        videoClone.currentTime = startOffset;

        const mediaElemSource = audioCtx.createMediaElementSource(videoClone);
        mediaElemSource.connect(bgGainNode);
        await videoClone.play().catch(() => {});
      } catch (e) {
        console.warn('Video clone audio routing fallback:', e);
      }
    } else if (bgVolume > 0.005) {
      // Gentle procedural chiptune background loop when starter procedural parkour is used
      const baseNoteFreqs = [220, 277.18, 329.63, 440];
      baseNoteFreqs.forEach((f, idx) => {
        const osc = audioCtx.createOscillator();
        const noteGain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = f;
        noteGain.gain.value = 0.06 / (idx + 1);
        osc.connect(noteGain);
        noteGain.connect(bgGainNode);
        osc.start();
        bgOscillators.push(osc);
      });
    }

    // Schedule every dialogue line's AudioBuffer into analyser -> mixDestination
    const baseAudioStart = audioCtx.currentTime + 0.08;
    const scheduledSources = [];

    timeline.segments.forEach((seg) => {
      if (seg.audioBuffer) {
        const src = audioCtx.createBufferSource();
        src.buffer = seg.audioBuffer;
        src.connect(analyser);
        src.start(baseAudioStart + seg.startSec);
        scheduledSources.push(src);
      }
    });

    // Combine 30fps Canvas video track + mixed Web Audio track
    const canvasStream = renderCanvas.captureStream(30);
    const combinedTracks = [
      ...canvasStream.getVideoTracks(),
      ...mixDestination.stream.getAudioTracks()
    ];
    const combinedStream = new MediaStream(combinedTracks);

    // Choose best supported MIME type (.mp4 preferred, fallback .webm)
    const candidateTypes = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    const chosenMimeType = candidateTypes.find((t) => {
      try {
        return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t);
      } catch (_) {
        return false;
      }
    }) || '';

    const recorderOptions = chosenMimeType
      ? { mimeType: chosenMimeType, videoBitsPerSecond: 4500000 }
      : { videoBitsPerSecond: 4500000 };

    const chunks = [];
    const recorder = new MediaRecorder(combinedStream, recorderOptions);
    recorder.ondataavailable = (evt) => {
      if (evt.data && evt.data.size > 0) chunks.push(evt.data);
    };

    const recordingPromise = new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const finalMime = recorder.mimeType || chosenMimeType || 'video/webm';
        const blob = new Blob(chunks, { type: finalMime });
        resolve({ blob, mimeType: finalMime });
      };
      recorder.onerror = (err) => reject(err);
    });

    recorder.start(120);

    const activeVideoElement = videoClone || bgVideoEl;
    const startWallMs = performance.now();

    await new Promise((resolve) => {
      function renderTick() {
        const elapsedSec = Math.max(0, audioCtx.currentTime - baseAudioStart);
        const clampedSec = Math.min(totalDurationSec, elapsedSec);

        // Seamless loop or segment bounds on background video
        if (!useProceduralBg && activeVideoElement && activeVideoElement.duration) {
          if (activeVideoElement.ended || activeVideoElement.currentTime >= activeVideoElement.duration - 0.05) {
            activeVideoElement.currentTime = 0;
            activeVideoElement.play().catch(() => {});
          }
        }

        const loudness = sampleLoudnessFromAnalyser(analyser, analyserData);

        renderCompositeFrame({
          ctx,
          bgVideoEl: activeVideoElement,
          useProceduralBg,
          charAImg,
          charBImg,
          charNames,
          timeline,
          settings,
          currentTimeSec: clampedSec,
          liveLoudness: loudness
        });

        const ratio = Math.min(1, elapsedSec / totalDurationSec);
        const remainingSec = Math.max(0, totalDurationSec - elapsedSec);
        if (onProgress) {
          onProgress(ratio, remainingSec, renderCanvas);
        }

        if (elapsedSec < totalDurationSec + 0.1) {
          requestAnimationFrame(renderTick);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(renderTick);
    });

    // Stop recorder & cleanup audio nodes
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    const result = await recordingPromise;

    scheduledSources.forEach((s) => {
      try { s.stop(); } catch (_) {}
    });
    bgOscillators.forEach((o) => {
      try { o.stop(); } catch (_) {}
    });
    if (videoClone) {
      try {
        videoClone.pause();
        videoClone.src = '';
      } catch (_) {}
    }
    try {
      await audioCtx.close();
    } catch (_) {}

    return result;
  }

  window.RenderEngine = {
    FRAME_W,
    FRAME_H,
    GAP_SEC,
    buildTimeline,
    sampleLoudnessFromAnalyser,
    renderCompositeFrame,
    recordFullVideo
  };
})();
