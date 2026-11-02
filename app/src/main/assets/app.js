// app.js - Main Controller for ToonTalk Studio 9:16 Video Maker

(function () {
  const STORAGE_KEY = 'toontalk_studio_prefs_v1';
  const API_KEY_STORAGE = 'toontalk_local_gemini_key';

  // Native Bridge Promise Coordinator
  let bridgeSeq = 1;
  const pendingCallbacks = {};

  window.__onNativeBridgeCallback = function (callbackId, payload) {
    const entry = pendingCallbacks[callbackId];
    if (entry) {
      delete pendingCallbacks[callbackId];
      entry.resolve(payload);
    }
  };

  function callNativeBridge(methodName, payloadObj) {
    return new Promise((resolve, reject) => {
      if (window.AndroidBridge && typeof window.AndroidBridge[methodName] === 'function') {
        const cbId = 'cb_' + (bridgeSeq++) + '_' + Date.now();
        pendingCallbacks[cbId] = { resolve, reject };
        try {
          window.AndroidBridge[methodName](cbId, JSON.stringify(payloadObj || {}));
        } catch (err) {
          delete pendingCallbacks[cbId];
          reject(err);
        }
      } else {
        resolve({ ok: false, noBridge: true });
      }
    });
  }

  // Default persisted settings
  const defaultSettings = {
    charAName: 'A',
    charBName: 'B',
    idea: 'octopus',
    scriptType: 'Funny Facts',
    customStyle: '',
    language: 'English',
    lengthSec: 30,
    voiceA: 'Puck',
    voiceB: 'Zephyr',
    bgFit: 'fill',
    bgZoom: 120,
    bgPanX: 0,
    bgPanY: 0,
    bgTrimMode: 'zero',
    bgVolume: 10,
    silentMode: 'hide',
    charSize: 100,
    charVerticalPos: 50,
    charEdgeDist: 4,
    captionsEnabled: true,
    captionTemplate: 'classic_yellow',
    captionFont: 'Fredoka',
    captionSize: 74,
    captionPosition: 'bottom',
    wordsPerScreen: 3,
    highlightColor: '#ffd93b',
    outlineThickness: 10,
    showSpeakerTag: true
  };

  let settings = loadSettings();
  let currentStep = 1;
  let maxCompletedStep = 1;
  let lastRetryAction = null;

  // Assets state
  let useProceduralBg = true;
  let userBgObjectUrl = null;
  const workingBgVideo = document.getElementById('working-bg-video');
  const userBgPreviewVideo = document.getElementById('user-bg-preview-video');
  const starterBgPreviewCanvas = document.getElementById('starter-bg-preview-canvas');

  const charAImage = new Image();
  const charBImage = new Image();

  // Script & Voice AudioBuffers state
  let scriptLines = [
    {
      id: 'line_1',
      speaker: 'A',
      text: 'Did you know an octopus actually has three hearts and blue blood?',
      audioBuffer: null,
      durationSec: 2.8,
      status: 'idle'
    },
    {
      id: 'line_2',
      speaker: 'B',
      text: 'Wait what?! Three hearts and I still cannot find one valentine!',
      audioBuffer: null,
      durationSec: 2.7,
      status: 'idle'
    },
    {
      id: 'line_3',
      speaker: 'A',
      text: 'Even better, they have nine brains—one in each arm to think independently!',
      audioBuffer: null,
      durationSec: 3.1,
      status: 'idle'
    },
    {
      id: 'line_4',
      speaker: 'B',
      text: 'Nine brains?! Yet my teammates still jump straight into lava! Which arm is smartest?',
      audioBuffer: null,
      durationSec: 3.2,
      status: 'idle'
    }
  ];

  // Shared Web Audio Context for decoding & previewing voice clips
  let sharedAudioCtx = null;
  let activePreviewSource = null;

  // Live Studio Preview state
  let isLivePreviewPlaying = false;
  let livePreviewStartSec = 0;
  let livePreviewAnalyser = null;
  let livePreviewAnalyserData = null;
  let livePreviewScheduledNodes = [];

  // Last rendered video output
  let lastRenderedBlob = null;
  let lastRenderedMimeType = 'video/webm';
  let lastRenderedUrl = null;

  function getSharedAudioCtx() {
    if (!sharedAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return Object.assign({}, defaultSettings, JSON.parse(raw));
      }
    } catch (_) {}
    return Object.assign({}, defaultSettings);
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
  }

  function getLocalApiKey() {
    try {
      return localStorage.getItem(API_KEY_STORAGE) || '';
    } catch (_) {
      return '';
    }
  }

  function showFriendlyError(message, retryFn) {
    const banner = document.getElementById('global-error-banner');
    const textEl = document.getElementById('global-error-text');
    const retryBtn = document.getElementById('btn-error-retry');
    textEl.textContent = message;
    lastRetryAction = typeof retryFn === 'function' ? retryFn : null;
    retryBtn.style.display = lastRetryAction ? 'inline-flex' : 'none';
    banner.classList.remove('hidden');
  }

  function hideFriendlyError() {
    const banner = document.getElementById('global-error-banner');
    banner.classList.add('hidden');
    lastRetryAction = null;
  }

  // Initialize starter assets (Character A & B transparent PNGs + Starter Parkour Video)
  function initStarterAssets() {
    const charADataUrl = window.StarterAssets.createStarterCharacterDataUrl('A');
    const charBDataUrl = window.StarterAssets.createStarterCharacterDataUrl('B');
    charAImage.src = charADataUrl;
    charBImage.src = charBDataUrl;
    document.getElementById('preview-char-a').src = charADataUrl;
    document.getElementById('preview-char-b').src = charBDataUrl;

    // Animate small Step 1 starter preview canvas
    const pCtx = starterBgPreviewCanvas.getContext('2d');
    function tickStarterPreview(now) {
      if (currentStep === 1 && useProceduralBg) {
        window.StarterAssets.drawProceduralParkourFrame(
          pCtx,
          starterBgPreviewCanvas.width,
          starterBgPreviewCanvas.height,
          now / 1000
        );
      }
      requestAnimationFrame(tickStarterPreview);
    }
    requestAnimationFrame(tickStarterPreview);
  }

  // Navigate between the 5 Wizard Steps
  function goToStep(stepNum) {
    window.StarterAssets.playPopSound(1.05);
    hideFriendlyError();
    stopLiveStudioPreviewPlayback();

    currentStep = Math.max(1, Math.min(5, stepNum));
    if (currentStep > maxCompletedStep) {
      maxCompletedStep = currentStep;
    }

    const stepTitles = {
      1: 'Step 1 of 5: Upload Assets',
      2: 'Step 2 of 5: Idea & Script Type',
      3: 'Step 3 of 5: Edit Dialogue Script',
      4: 'Step 4 of 5: Voices & Audio Clips',
      5: 'Step 5 of 5: Framing, Captions & Render'
    };
    document.getElementById('wizard-step-title').textContent = stepTitles[currentStep];

    document.querySelectorAll('.step-pill').forEach((pill) => {
      const s = Number(pill.getAttribute('data-step'));
      pill.classList.toggle('completed', s <= maxCompletedStep);
      pill.classList.toggle('active', s <= currentStep);
      pill.classList.toggle('current', s === currentStep);
    });

    for (let i = 1; i <= 5; i++) {
      const panel = document.getElementById('step-panel-' + i);
      if (panel) {
        panel.classList.toggle('hidden', i !== currentStep);
      }
    }

    if (currentStep === 3) {
      renderScriptLinesEditor();
    } else if (currentStep === 4) {
      document.getElementById('voice-label-char-a').textContent = `${settings.charAName || 'A'} Voice (Left)`;
      document.getElementById('voice-label-char-b').textContent = `${settings.charBName || 'B'} Voice (Right)`;
      renderVoiceClipsList();
      // Auto-synthesize any lines that don't have an AudioBuffer yet
      const missingBuffers = scriptLines.some((l) => !l.audioBuffer);
      if (missingBuffers) {
        generateAllVoiceClips();
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Sync persisted settings into UI inputs
  function applySettingsToDom() {
    document.getElementById('input-char-a-name').value = settings.charAName || 'A';
    document.getElementById('input-char-b-name').value = settings.charBName || 'B';
    document.getElementById('input-idea').value = settings.idea || 'octopus';
    document.getElementById('input-custom-style').value = settings.customStyle || '';

    // Script type cards
    document.querySelectorAll('#script-type-grid .script-type-card').forEach((card) => {
      const isMatch = card.getAttribute('data-type') === settings.scriptType;
      card.classList.toggle('selected', isMatch);
    });
    document.getElementById('custom-style-wrap').classList.toggle('hidden', settings.scriptType !== 'Custom');

    // Language pills
    document.querySelectorAll('#language-pills .pill-choice').forEach((btn) => {
      btn.classList.toggle('selected', btn.getAttribute('data-lang') === settings.language);
    });

    // Length pills
    document.querySelectorAll('#length-pills .pill-choice').forEach((btn) => {
      btn.classList.toggle('selected', Number(btn.getAttribute('data-len')) === Number(settings.lengthSec));
    });

    // Voices
    document.getElementById('select-voice-a').value = settings.voiceA || 'Puck';
    document.getElementById('select-voice-b').value = settings.voiceB || 'Zephyr';

    // Framing
    document.querySelectorAll('#bg-fit-pills .pill-choice').forEach((btn) => {
      btn.classList.toggle('selected', btn.getAttribute('data-fit') === settings.bgFit);
    });
    document.getElementById('custom-framing-sliders').classList.toggle('hidden', settings.bgFit !== 'custom');

    document.getElementById('slider-bg-zoom').value = settings.bgZoom;
    document.getElementById('val-bg-zoom').textContent = settings.bgZoom + '%';
    document.getElementById('slider-bg-pan-x').value = settings.bgPanX;
    document.getElementById('val-bg-pan-x').textContent = settings.bgPanX + '%';
    document.getElementById('slider-bg-pan-y').value = settings.bgPanY;
    document.getElementById('val-bg-pan-y').textContent = settings.bgPanY + '%';

    document.querySelectorAll('#bg-trim-pills .pill-choice').forEach((btn) => {
      btn.classList.toggle('selected', btn.getAttribute('data-trim') === settings.bgTrimMode);
    });

    document.getElementById('slider-bg-volume').value = settings.bgVolume;
    document.getElementById('val-bg-volume').textContent = settings.bgVolume + '%';

    // Characters
    document.querySelectorAll('#silent-mode-pills .pill-choice').forEach((btn) => {
      btn.classList.toggle('selected', btn.getAttribute('data-silent') === settings.silentMode);
    });
    document.getElementById('slider-char-size').value = settings.charSize;
    document.getElementById('val-char-size').textContent = settings.charSize + '%';
    document.getElementById('slider-char-vert').value = settings.charVerticalPos;
    document.getElementById('val-char-vert').textContent = settings.charVerticalPos + '%';
    document.getElementById('slider-char-edge').value = settings.charEdgeDist;
    document.getElementById('val-char-edge').textContent = settings.charEdgeDist + '%';

    // Captions
    const capBtn = document.getElementById('btn-toggle-captions');
    capBtn.textContent = settings.captionsEnabled ? 'Captions: ON ✅' : 'Captions: OFF ❌';
    capBtn.className = 'btn-cartoon btn-sm ' + (settings.captionsEnabled ? 'btn-green' : 'btn-pink');
    document.getElementById('captions-controls-body').classList.toggle('hidden', !settings.captionsEnabled);

    document.querySelectorAll('#caption-template-grid .caption-tpl-card').forEach((card) => {
      card.classList.toggle('selected', card.getAttribute('data-tpl') === settings.captionTemplate);
    });

    document.getElementById('select-caption-font').value = settings.captionFont || 'Fredoka';
    document.getElementById('slider-caption-size').value = settings.captionSize;
    document.getElementById('val-caption-size').textContent = settings.captionSize + 'px';

    document.querySelectorAll('#caption-pos-pills .pill-choice').forEach((btn) => {
      btn.classList.toggle('selected', btn.getAttribute('data-pos') === settings.captionPosition);
    });

    document.querySelectorAll('#words-per-screen-pills .pill-choice').forEach((btn) => {
      btn.classList.toggle('selected', Number(btn.getAttribute('data-wps')) === Number(settings.wordsPerScreen));
    });

    document.getElementById('input-highlight-color').value = settings.highlightColor || '#ffd93b';
    document.getElementById('slider-outline-thickness').value = settings.outlineThickness;
    document.getElementById('val-outline-thickness').textContent = settings.outlineThickness + 'px';

    const spkBtn = document.getElementById('btn-toggle-speaker-tag');
    spkBtn.textContent = settings.showSpeakerTag ? 'Speaker Tag: ON ✅' : 'Speaker Tag: OFF ❌';
    spkBtn.className = 'btn-cartoon btn-sm ' + (settings.showSpeakerTag ? 'btn-yellow' : 'btn-white');
  }

  // =========================================================
  // STEP 3: SCRIPT GENERATION & EDITING
  // =========================================================
  const funnyLoadingMessages = [
    'Teaching Character B how to roast Character A...',
    'Brewing viral hooks and comment-bait punchlines...',
    'Counting octopus hearts and Minecraft blocks...',
    'Making sure every line is under 20 punchy words...'
  ];

  async function triggerScriptGeneration() {
    const idea = (document.getElementById('input-idea').value || '').trim();
    if (!idea) {
      showFriendlyError('Please type a short idea first (like "octopus" or "life of a student")!');
      return;
    }

    settings.idea = idea;
    settings.charAName = (document.getElementById('input-char-a-name').value || 'A').trim() || 'A';
    settings.charBName = (document.getElementById('input-char-b-name').value || 'B').trim() || 'B';
    settings.customStyle = (document.getElementById('input-custom-style').value || '').trim();

    // Auto-select Devanagari/Urdu-friendly Baloo 2 font when Hindi or Roman Urdu is selected
    if (settings.language === 'Hindi') {
      settings.captionFont = 'Baloo 2';
      document.getElementById('select-caption-font').value = 'Baloo 2';
    }
    saveSettings();

    goToStep(3);

    const loadingBox = document.getElementById('script-loading-box');
    const editorCard = document.getElementById('script-editor-card');
    const loadingMsg = document.getElementById('script-loading-msg');
    loadingBox.classList.remove('hidden');
    editorCard.classList.add('hidden');

    let msgIdx = 0;
    const msgTimer = setInterval(() => {
      msgIdx = (msgIdx + 1) % funnyLoadingMessages.length;
      loadingMsg.textContent = funnyLoadingMessages[msgIdx];
    }, 1800);

    try {
      const payload = {
        idea: settings.idea,
        scriptType: settings.scriptType,
        customStyle: settings.customStyle,
        language: settings.language,
        lengthSec: settings.lengthSec,
        charAName: settings.charAName,
        charBName: settings.charBName,
        apiKey: getLocalApiKey()
      };

      let result = await callNativeBridge('generateScript', payload);

      if (result && result.noBridge) {
        // Standalone browser / Capacitor fallback
        result = await generateScriptDirectBrowser(payload);
      }

      clearInterval(msgTimer);
      loadingBox.classList.add('hidden');
      editorCard.classList.remove('hidden');

      if (!result || !result.ok || !Array.isArray(result.lines) || result.lines.length === 0) {
        showFriendlyError(
          (result && result.error) || 'Could not generate script from Gemini API. Tap Retry to try again.',
          () => triggerScriptGeneration()
        );
        renderScriptLinesEditor();
        return;
      }

      scriptLines = result.lines.map((item, idx) => ({
        id: 'line_' + Date.now() + '_' + idx,
        speaker: idx % 2 === 0 ? 'A' : 'B',
        text: item.text || '',
        audioBuffer: null,
        durationSec: estimateDurationFromWords(item.text || ''),
        status: 'idle'
      }));

      renderScriptLinesEditor();
    } catch (err) {
      clearInterval(msgTimer);
      loadingBox.classList.add('hidden');
      editorCard.classList.remove('hidden');
      showFriendlyError(
        'Script generation failed: ' + (err.message || 'Network error'),
        () => triggerScriptGeneration()
      );
      renderScriptLinesEditor();
    }
  }

  function estimateDurationFromWords(text) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    return Number(Math.max(1.2, words * 0.30 + 0.35).toFixed(2));
  }

  async function generateScriptDirectBrowser(payload) {
    const apiKey = payload.apiKey;
    if (!apiKey) {
      // Craft an intelligent topic-specific script when running in standalone web preview without key
      const topic = payload.idea;
      return {
        ok: true,
        lines: [
          { speaker: 'A', text: `Stop scrolling! Nobody tells you the wildest truth about ${topic}!` },
          { speaker: 'B', text: `Wait really?! I thought ${topic} was totally normal!` },
          { speaker: 'A', text: `Not even close! In ${payload.scriptType} mode, ${topic} breaks every rule you know.` },
          { speaker: 'B', text: `Bro my brain just lagged harder than a 999 ping server!` },
          { speaker: 'A', text: `And the craziest part is what happens at the very end.` },
          { speaker: 'B', text: `Drop your guess in the comments right now if you knew this!` }
        ]
      };
    }

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Write a viral ${payload.lengthSec}s ${payload.scriptType} dialogue about "${payload.idea}" in ${payload.language}. Return JSON {"lines":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]} alternating A and B, max 20 words per line.`
            }]
          }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );
    if (!resp.ok) {
      throw new Error('Gemini API error ' + resp.status);
    }
    const data = await resp.json();
    const rawJson = data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(rawJson);
    return { ok: true, lines: parsed.lines || parsed };
  }

  function renderScriptLinesEditor() {
    const container = document.getElementById('script-lines-container');
    container.innerHTML = '';

    scriptLines.forEach((line, index) => {
      const isA = line.speaker === 'A';
      const speakerName = isA ? (settings.charAName || 'A') : (settings.charBName || 'B');
      const wordCount = (line.text || '').trim().split(/\s+/).filter(Boolean).length;

      const card = document.createElement('div');
      card.className = 'script-line-card ' + (isA ? 'speaker-a' : 'speaker-b');

      const roleBadgeText = index === 0
        ? '🪝 HOOK'
        : (index === scriptLines.length - 1 ? '🎯 PUNCHLINE / Q' : `Line #${index + 1}`);

      card.innerHTML = `
        <div class="line-card-top">
          <button type="button" class="speaker-pill ${isA ? 'speaker-a' : 'speaker-b'}" data-action="toggle-speaker" data-idx="${index}">
            ${isA ? '⬅️' : '➡️'} ${speakerName} (${line.speaker})
          </button>
          <span class="badge-tag">${roleBadgeText}</span>
          <span class="word-counter ${wordCount > 20 ? 'over-limit' : ''}" id="word-count-${index}">
            ${wordCount}/20 words
          </span>
        </div>
        <textarea class="cartoon-textarea" data-idx="${index}" rows="2">${line.text}</textarea>
        <div class="btn-row">
          <button type="button" class="btn-cartoon btn-white btn-sm" data-action="rewrite-line" data-idx="${index}">
            🎲 Rewrite Line
          </button>
          <button type="button" class="btn-cartoon btn-pink btn-sm" data-action="delete-line" data-idx="${index}" ${scriptLines.length <= 2 ? 'disabled' : ''}>
            🗑️ Remove
          </button>
        </div>
      `;
      container.appendChild(card);
    });

    // Attach textarea and button listeners
    container.querySelectorAll('textarea').forEach((ta) => {
      ta.addEventListener('input', (e) => {
        const idx = Number(e.target.getAttribute('data-idx'));
        scriptLines[idx].text = e.target.value;
        scriptLines[idx].audioBuffer = null; // mark audio buffer dirty when edited
        scriptLines[idx].durationSec = estimateDurationFromWords(e.target.value);
        const wc = (e.target.value || '').trim().split(/\s+/).filter(Boolean).length;
        const wcEl = document.getElementById('word-count-' + idx);
        if (wcEl) {
          wcEl.textContent = `${wc}/20 words`;
          wcEl.classList.toggle('over-limit', wc > 20);
        }
      });
    });

    container.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        window.StarterAssets.playPopSound(1.1);
        const action = btn.getAttribute('data-action');
        const idx = Number(btn.getAttribute('data-idx'));
        if (action === 'toggle-speaker') {
          scriptLines[idx].speaker = scriptLines[idx].speaker === 'A' ? 'B' : 'A';
          scriptLines[idx].audioBuffer = null;
          renderScriptLinesEditor();
        } else if (action === 'delete-line' && scriptLines.length > 2) {
          scriptLines.splice(idx, 1);
          renderScriptLinesEditor();
        } else if (action === 'rewrite-line') {
          btn.disabled = true;
          btn.textContent = '⏳ Rewriting...';
          await rewriteSingleScriptLine(idx);
          renderScriptLinesEditor();
        }
      });
    });
  }

  async function rewriteSingleScriptLine(index) {
    const target = scriptLines[index];
    if (!target) return;
    try {
      const payload = {
        idea: settings.idea,
        scriptType: settings.scriptType,
        language: settings.language,
        speaker: target.speaker,
        currentText: target.text,
        prevText: index > 0 ? scriptLines[index - 1].text : '',
        nextText: index < scriptLines.length - 1 ? scriptLines[index + 1].text : '',
        isFirst: index === 0,
        isLast: index === scriptLines.length - 1,
        apiKey: getLocalApiKey()
      };
      const res = await callNativeBridge('regenerateLine', payload);
      if (res && res.ok && res.text) {
        target.text = res.text;
        target.audioBuffer = null;
        target.durationSec = estimateDurationFromWords(res.text);
      } else if (res && res.noBridge) {
        target.text = target.speaker === 'A'
          ? `Wait until you hear this wild fact about ${settings.idea}!`
          : `No way! That literally sounds impossible!`;
        target.audioBuffer = null;
      } else if (res && res.error) {
        showFriendlyError(res.error, () => rewriteSingleScriptLine(index));
      }
    } catch (err) {
      showFriendlyError('Could not rewrite line: ' + err.message);
    }
  }

  // =========================================================
  // STEP 4: VOICES & AUDIOBUFFER SYNTHESIS
  // =========================================================
  async function synthesizeBufferForText(text, voiceName) {
    const audioCtx = getSharedAudioCtx();
    const res = await callNativeBridge('synthesizeVoice', {
      text,
      voiceName,
      language: settings.language,
      apiKey: getLocalApiKey()
    });

    if (res && res.ok && res.audioBase64) {
      const binaryString = atob(res.audioBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const decoded = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
      return decoded;
    }

    // Direct Web Audio expressive vocal AudioBuffer synthesis fallback if outside Android bridge
    return createBrowserExpressiveAudioBuffer(audioCtx, text, voiceName);
  }

  function createBrowserExpressiveAudioBuffer(audioCtx, text, voiceName) {
    const words = (text || 'Hello').trim().split(/\s+/).filter(Boolean);
    const wordCount = Math.max(1, words.length);
    const secPerWord = 0.28;
    const duration = Math.min(8.5, Math.max(1.1, wordCount * secPerWord + 0.22));
    const sampleRate = audioCtx.sampleRate || 24000;
    const totalSamples = Math.floor(duration * sampleRate);
    const buffer = audioCtx.createBuffer(1, totalSamples, sampleRate);
    const channel = buffer.getChannelData(0);

    const freqMap = {
      Charon: 118,
      Fenrir: 138,
      Puck: 168,
      Aoede: 215,
      Kore: 242,
      Zephyr: 276
    };
    const baseFreq = freqMap[voiceName] || 175;
    let p1 = 0, p2 = 0, p3 = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const wPos = t / secPerWord;
      const wIdx = Math.floor(wPos);
      const frac = wPos - wIdx;
      const env = wIdx < wordCount ? Math.max(0, Math.sin(Math.min(1, frac * 1.15) * Math.PI)) : 0;
      const f0 = baseFreq * (1 + 0.1 * Math.sin(wIdx * 1.9) + 0.05 * Math.sin(frac * Math.PI * 2));
      p1 += (2 * Math.PI * f0) / sampleRate;
      p2 += (4 * Math.PI * f0) / sampleRate;
      p3 += (6 * Math.PI * f0) / sampleRate;
      channel[i] = (0.6 * Math.sin(p1) + 0.28 * Math.sin(p2) + 0.12 * Math.sin(p3)) * env * 0.45;
    }
    return buffer;
  }

  function playAudioBufferPreview(audioBuffer) {
    if (!audioBuffer) return;
    try {
      const ctx = getSharedAudioCtx();
      if (activePreviewSource) {
        try { activePreviewSource.stop(); } catch (_) {}
      }
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      src.start();
      activePreviewSource = src;
    } catch (_) {}
  }

  async function generateSingleLineVoice(index) {
    const line = scriptLines[index];
    if (!line) return;
    line.status = 'loading';
    renderVoiceClipsList();

    const voiceName = line.speaker === 'A' ? settings.voiceA : settings.voiceB;
    try {
      const buf = await synthesizeBufferForText(line.text, voiceName);
      line.audioBuffer = buf;
      line.durationSec = Number(buf.duration.toFixed(2));
      line.status = 'ready';
    } catch (err) {
      line.status = 'error';
      showFriendlyError('Voice clip synthesis failed: ' + err.message, () => generateSingleLineVoice(index));
    }
    renderVoiceClipsList();
  }

  async function generateAllVoiceClips() {
    const loadingBox = document.getElementById('voices-loading-box');
    const loadingMsg = document.getElementById('voices-loading-msg');
    loadingBox.classList.remove('hidden');

    for (let i = 0; i < scriptLines.length; i++) {
      loadingMsg.textContent = `Generating voice clip ${i + 1} of ${scriptLines.length}...`;
      await generateSingleLineVoice(i);
    }

    loadingBox.classList.add('hidden');
    renderVoiceClipsList();
  }

  function renderVoiceClipsList() {
    const container = document.getElementById('voice-clips-list');
    container.innerHTML = '';

    const timeline = window.RenderEngine.buildTimeline(scriptLines);
    document.getElementById('total-audio-duration-badge').textContent =
      `Total Length: ${timeline.totalDurationSec.toFixed(2)}s (incl. 0.15s gaps)`;

    scriptLines.forEach((line, idx) => {
      const isA = line.speaker === 'A';
      const speakerName = isA ? (settings.charAName || 'A') : (settings.charBName || 'B');
      const voiceUsed = isA ? settings.voiceA : settings.voiceB;
      const row = document.createElement('div');
      row.className = 'voice-clip-row';

      const statusText = line.status === 'loading'
        ? '⏳ Generating...'
        : (line.audioBuffer ? `✅ ${line.durationSec.toFixed(2)}s (${voiceUsed})` : `⚪ Est. ${line.durationSec.toFixed(1)}s`);

      row.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span class="badge-tag" style="background:${isA ? 'var(--orange)' : 'var(--purple)'};">
              ${speakerName}
            </span>
            <span style="font-size:12px;font-weight:800;">${statusText}</span>
          </div>
          <div class="voice-clip-text">${line.text}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn-cartoon btn-yellow btn-sm" data-voice-play="${idx}" ${!line.audioBuffer ? 'disabled' : ''} title="Play Clip">
            ▶️
          </button>
          <button type="button" class="btn-cartoon btn-white btn-sm" data-voice-regen="${idx}" title="Regenerate Clip">
            🔄
          </button>
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('button[data-voice-play]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-voice-play'));
        if (scriptLines[idx] && scriptLines[idx].audioBuffer) {
          playAudioBufferPreview(scriptLines[idx].audioBuffer);
        }
      });
    });

    container.querySelectorAll('button[data-voice-regen]').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.1);
        const idx = Number(btn.getAttribute('data-voice-regen'));
        generateSingleLineVoice(idx);
      });
    });
  }

  // =========================================================
  // STEP 5: LIVE 9:16 PREVIEW & FULL VIDEO RENDERER
  // =========================================================
  function stopLiveStudioPreviewPlayback() {
    isLivePreviewPlaying = false;
    const toggleBtn = document.getElementById('btn-toggle-live-preview');
    if (toggleBtn) toggleBtn.textContent = '▶️ Play Preview';
    livePreviewScheduledNodes.forEach((n) => {
      try { n.stop(); } catch (_) {}
    });
    livePreviewScheduledNodes = [];
    livePreviewAnalyser = null;
    livePreviewAnalyserData = null;
  }

  function startLiveStudioPreviewPlayback() {
    stopLiveStudioPreviewPlayback();
    const audioCtx = getSharedAudioCtx();
    const timeline = window.RenderEngine.buildTimeline(scriptLines);

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    const dataArr = new Uint8Array(analyser.frequencyBinCount);
    analyser.connect(audioCtx.destination);

    const startTime = audioCtx.currentTime + 0.05;
    timeline.segments.forEach((seg) => {
      if (seg.audioBuffer) {
        const src = audioCtx.createBufferSource();
        src.buffer = seg.audioBuffer;
        src.connect(analyser);
        src.start(startTime + seg.startSec);
        livePreviewScheduledNodes.push(src);
      }
    });

    livePreviewStartSec = startTime;
    livePreviewAnalyser = analyser;
    livePreviewAnalyserData = dataArr;
    isLivePreviewPlaying = true;
    document.getElementById('btn-toggle-live-preview').textContent = '⏸️ Stop Preview';
  }

  function startStudioPreviewLoop() {
    const previewCanvas = document.getElementById('live-preview-canvas');
    const ctx = previewCanvas.getContext('2d');

    function previewLoop(nowMs) {
      if (currentStep === 5) {
        const timeline = window.RenderEngine.buildTimeline(scriptLines);
        let previewTimeSec = 0;
        let loudness = 0;

        if (isLivePreviewPlaying && sharedAudioCtx) {
          previewTimeSec = Math.max(0, sharedAudioCtx.currentTime - livePreviewStartSec);
          if (previewTimeSec >= timeline.totalDurationSec) {
            stopLiveStudioPreviewPlayback();
          } else {
            loudness = window.RenderEngine.sampleLoudnessFromAnalyser(
              livePreviewAnalyser,
              livePreviewAnalyserData
            );
          }
        } else {
          // Gentle continuous loop across timeline so user sees character slide-in, bounce & captions live
          previewTimeSec = (nowMs / 1000) % Math.max(1.5, timeline.totalDurationSec);
          loudness = (Math.sin(nowMs / 95) + 1) * 0.35;
        }

        window.RenderEngine.renderCompositeFrame({
          ctx,
          bgVideoEl: workingBgVideo,
          useProceduralBg,
          charAImg: charAImage,
          charBImg: charBImage,
          charNames: {
            charAName: settings.charAName,
            charBName: settings.charBName
          },
          timeline,
          settings,
          currentTimeSec: previewTimeSec,
          liveLoudness: loudness
        });
      }
      requestAnimationFrame(previewLoop);
    }
    requestAnimationFrame(previewLoop);
  }

  async function handleCreateFullVideo() {
    window.StarterAssets.playPopSound(1.2);
    stopLiveStudioPreviewPlayback();
    hideFriendlyError();

    // Ensure all lines have synthesized AudioBuffers before recording
    const missing = scriptLines.some((l) => !l.audioBuffer);
    if (missing) {
      await generateAllVoiceClips();
    }

    const createBtn = document.getElementById('btn-create-video');
    const progressSection = document.getElementById('render-progress-section');
    const outputSection = document.getElementById('render-output-section');
    const progressFill = document.getElementById('render-progress-fill');
    const progressLabel = document.getElementById('render-progress-label');
    const mascotEl = document.getElementById('render-mascot');
    const livePreviewCanvas = document.getElementById('live-preview-canvas');
    const livePreviewCtx = livePreviewCanvas.getContext('2d');

    createBtn.disabled = true;
    progressSection.classList.remove('hidden');
    outputSection.classList.add('hidden');
    document.getElementById('gallery-save-status').classList.add('hidden');

    try {
      const { blob, mimeType } = await window.RenderEngine.recordFullVideo({
        bgVideoEl: workingBgVideo,
        useProceduralBg,
        charAImg: charAImage,
        charBImg: charBImage,
        charNames: {
          charAName: settings.charAName,
          charBName: settings.charBName
        },
        lines: scriptLines,
        settings,
        onProgress: (ratio, remainingSec, sourceCanvas) => {
          const pct = Math.round(ratio * 100);
          progressFill.style.width = pct + '%';
          mascotEl.style.left = Math.max(4, Math.min(96, pct)) + '%';
          progressLabel.textContent = `${pct}% • Est. ${Math.ceil(remainingSec)}s left`;
          // Mirror active render onto the live preview canvas
          livePreviewCtx.drawImage(sourceCanvas, 0, 0);
        }
      });

      lastRenderedBlob = blob;
      lastRenderedMimeType = mimeType || 'video/webm';
      if (lastRenderedUrl) {
        URL.revokeObjectURL(lastRenderedUrl);
      }
      lastRenderedUrl = URL.createObjectURL(blob);

      const outputVideo = document.getElementById('rendered-output-video');
      outputVideo.src = lastRenderedUrl;
      outputVideo.load();

      progressSection.classList.add('hidden');
      outputSection.classList.remove('hidden');
      createBtn.disabled = false;

      window.StarterAssets.playCelebrationSound();
      window.StarterAssets.launchConfetti();

      // Automatically save to Android Gallery (Movies/ToonTalk) when running in Android APK
      await saveBlobToAndroidGallery(blob, lastRenderedMimeType, true);
    } catch (err) {
      createBtn.disabled = false;
      progressSection.classList.add('hidden');
      showFriendlyError(
        'Video rendering failed: ' + (err.message || 'MediaRecorder error'),
        () => handleCreateFullVideo()
      );
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result || '';
        const base64 = res.includes(',') ? res.split(',')[1] : res;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function saveBlobToAndroidGallery(blob, mimeType, isAutoSave = false) {
    if (!blob) return;
    try {
      const base64Data = await blobToBase64(blob);
      const res = await callNativeBridge('saveVideoToGallery', {
        base64Data,
        mimeType
      });
      if (res && res.ok) {
        const badge = document.getElementById('gallery-save-status');
        badge.textContent = `✅ Saved to Gallery (${res.savedPath || 'Movies/ToonTalk'})`;
        badge.classList.remove('hidden');
        return true;
      }
    } catch (_) {}
    if (!isAutoSave) {
      // Trigger browser file download fallback (.mp4 if supported, otherwise .webm)
      const ext = (mimeType || '').toLowerCase().includes('mp4') ? 'mp4' : 'webm';
      const a = document.createElement('a');
      a.href = lastRenderedUrl;
      a.download = `ToonTalk_${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    return false;
  }

  async function shareRenderedVideo() {
    if (!lastRenderedBlob) return;
    window.StarterAssets.playPopSound(1.1);
    try {
      const base64Data = await blobToBase64(lastRenderedBlob);
      const res = await callNativeBridge('shareVideo', {
        base64Data,
        mimeType: lastRenderedMimeType
      });
      if (res && res.noBridge && navigator.share) {
        const ext = lastRenderedMimeType.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([lastRenderedBlob], `ToonTalk.${ext}`, { type: lastRenderedMimeType });
        await navigator.share({
          title: 'ToonTalk 9:16 Video',
          files: [file]
        });
      }
    } catch (_) {}
  }

  // =========================================================
  // WIRE DOM EVENTS
  // =========================================================
  function bindEvents() {
    // Top step pills
    document.querySelectorAll('.step-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const target = Number(pill.getAttribute('data-step'));
        goToStep(target);
      });
    });

    // Global error banner buttons
    document.getElementById('btn-error-retry').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      const fn = lastRetryAction;
      hideFriendlyError();
      if (fn) fn();
    });
    document.getElementById('btn-error-dismiss').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      hideFriendlyError();
    });

    // Settings Modal
    document.getElementById('btn-open-settings').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      document.getElementById('input-local-api-key').value = getLocalApiKey();
      document.getElementById('settings-modal').classList.remove('hidden');
    });
    document.getElementById('btn-close-settings').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      document.getElementById('settings-modal').classList.add('hidden');
    });
    document.getElementById('btn-save-settings').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.15);
      const val = (document.getElementById('input-local-api-key').value || '').trim();
      try {
        localStorage.setItem(API_KEY_STORAGE, val);
      } catch (_) {}
      document.getElementById('settings-modal').classList.add('hidden');
    });
    document.getElementById('btn-clear-settings').addEventListener('click', () => {
      window.StarterAssets.playPopSound(0.9);
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(API_KEY_STORAGE);
      } catch (_) {}
      settings = Object.assign({}, defaultSettings);
      applySettingsToDom();
      document.getElementById('settings-modal').classList.add('hidden');
    });

    // STEP 1: Upload Background Video & Character PNGs
    document.getElementById('input-bg-video').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('video/')) {
        showFriendlyError('Unsupported video format! Please pick an MP4, WebM, or MOV video.');
        return;
      }
      if (file.size > 180 * 1024 * 1024) {
        showFriendlyError('Video file is too large (over 180MB). Please pick a shorter clip!');
        return;
      }

      if (userBgObjectUrl) URL.revokeObjectURL(userBgObjectUrl);
      userBgObjectUrl = URL.createObjectURL(file);
      useProceduralBg = false;

      workingBgVideo.src = userBgObjectUrl;
      workingBgVideo.load();
      workingBgVideo.play().catch(() => {});

      userBgPreviewVideo.src = userBgObjectUrl;
      userBgPreviewVideo.classList.remove('hidden');
      starterBgPreviewCanvas.classList.add('hidden');
      userBgPreviewVideo.play().catch(() => {});

      document.getElementById('bg-source-badge').textContent = `Custom Video: ${file.name.slice(0, 22)}`;
      window.StarterAssets.playPopSound(1.15);
    });

    document.getElementById('btn-reset-starter-bg').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      useProceduralBg = true;
      userBgPreviewVideo.classList.add('hidden');
      starterBgPreviewCanvas.classList.remove('hidden');
      document.getElementById('bg-source-badge').textContent = 'Starter Parkour Loop Active';
    });

    document.getElementById('btn-use-starter-pack').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.2);
      useProceduralBg = true;
      userBgPreviewVideo.classList.add('hidden');
      starterBgPreviewCanvas.classList.remove('hidden');
      initStarterAssets();
      document.getElementById('bg-source-badge').textContent = 'Starter Pack Ready ✨';
    });

    function handleCharacterPngUpload(fileInputId, targetImg, previewImgId, label) {
      document.getElementById(fileInputId).addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          showFriendlyError(`Unsupported image format for ${label}. Please upload a PNG or WebP image.`);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          targetImg.src = reader.result;
          document.getElementById(previewImgId).src = reader.result;
          window.StarterAssets.playPopSound(1.15);
        };
        reader.readAsDataURL(file);
      });
    }

    handleCharacterPngUpload('input-char-a-file', charAImage, 'preview-char-a', 'Character A');
    handleCharacterPngUpload('input-char-b-file', charBImage, 'preview-char-b', 'Character B');

    document.getElementById('input-char-a-name').addEventListener('input', (e) => {
      settings.charAName = e.target.value.trim() || 'A';
      saveSettings();
    });
    document.getElementById('input-char-b-name').addEventListener('input', (e) => {
      settings.charBName = e.target.value.trim() || 'B';
      saveSettings();
    });

    document.getElementById('btn-step1-next').addEventListener('click', () => {
      goToStep(2);
    });

    // STEP 2: Idea, Script Type, Language, Length
    document.querySelectorAll('.idea-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.1);
        const ideaVal = chip.getAttribute('data-idea');
        document.getElementById('input-idea').value = ideaVal;
        settings.idea = ideaVal;
        saveSettings();
      });
    });

    document.querySelectorAll('#script-type-grid .script-type-card').forEach((card) => {
      card.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.12);
        const chosenType = card.getAttribute('data-type');
        settings.scriptType = chosenType;
        saveSettings();
        document.querySelectorAll('#script-type-grid .script-type-card').forEach((c) => {
          c.classList.remove('selected');
        });
        // Trigger wobble animation cleanly
        void card.offsetWidth;
        card.classList.add('selected');
        document.getElementById('custom-style-wrap').classList.toggle('hidden', chosenType !== 'Custom');
      });
    });

    document.querySelectorAll('#language-pills .pill-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.language = btn.getAttribute('data-lang');
        saveSettings();
        applySettingsToDom();
      });
    });

    document.querySelectorAll('#length-pills .pill-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.lengthSec = Number(btn.getAttribute('data-len'));
        saveSettings();
        applySettingsToDom();
      });
    });

    document.getElementById('btn-step2-back').addEventListener('click', () => goToStep(1));
    document.getElementById('btn-generate-script').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.15);
      triggerScriptGeneration();
    });

    // STEP 3: Script Editor actions
    document.getElementById('btn-add-script-line').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.1);
      const nextSpeaker = scriptLines.length % 2 === 0 ? 'A' : 'B';
      scriptLines.push({
        id: 'line_' + Date.now(),
        speaker: nextSpeaker,
        text: nextSpeaker === 'A' ? 'And here is one more crazy fact!' : 'Wait, tell me right now!',
        audioBuffer: null,
        durationSec: 1.9,
        status: 'idle'
      });
      renderScriptLinesEditor();
    });

    document.getElementById('btn-regenerate-script').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.1);
      triggerScriptGeneration();
    });

    document.getElementById('btn-step3-next').addEventListener('click', () => {
      goToStep(4);
    });

    // STEP 4: Voices
    document.getElementById('select-voice-a').addEventListener('change', (e) => {
      settings.voiceA = e.target.value;
      saveSettings();
      scriptLines.forEach((l) => {
        if (l.speaker === 'A') l.audioBuffer = null;
      });
      renderVoiceClipsList();
    });

    document.getElementById('select-voice-b').addEventListener('change', (e) => {
      settings.voiceB = e.target.value;
      saveSettings();
      scriptLines.forEach((l) => {
        if (l.speaker === 'B') l.audioBuffer = null;
      });
      renderVoiceClipsList();
    });

    document.getElementById('btn-preview-voice-a').addEventListener('click', async () => {
      window.StarterAssets.playPopSound();
      const sampleText = `Hey! I am ${settings.charAName || 'A'}, using the ${settings.voiceA} voice!`;
      const buf = await synthesizeBufferForText(sampleText, settings.voiceA);
      playAudioBufferPreview(buf);
    });

    document.getElementById('btn-preview-voice-b').addEventListener('click', async () => {
      window.StarterAssets.playPopSound();
      const sampleText = `Whoa! And I am ${settings.charBName || 'B'} with the ${settings.voiceB} voice!`;
      const buf = await synthesizeBufferForText(sampleText, settings.voiceB);
      playAudioBufferPreview(buf);
    });

    document.getElementById('btn-generate-all-voices').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.15);
      generateAllVoiceClips();
    });

    document.getElementById('btn-step4-back').addEventListener('click', () => goToStep(3));
    document.getElementById('btn-step4-next').addEventListener('click', () => goToStep(5));

    // STEP 5: Studio Sub-Tabs & Controls
    document.querySelectorAll('.studio-tab-btn').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        const targetTab = tabBtn.getAttribute('data-tab');
        document.querySelectorAll('.studio-tab-btn').forEach((b) => {
          const active = b.getAttribute('data-tab') === targetTab;
          b.classList.toggle('btn-yellow', active);
          b.classList.toggle('btn-white', !active);
        });
        ['framing', 'characters', 'captions'].forEach((t) => {
          document.getElementById('studio-subpanel-' + t).classList.toggle('hidden', t !== targetTab);
        });
      });
    });

    document.getElementById('btn-toggle-live-preview').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      if (isLivePreviewPlaying) {
        stopLiveStudioPreviewPlayback();
      } else {
        startLiveStudioPreviewPlayback();
      }
    });

    // Framing controls
    document.querySelectorAll('#bg-fit-pills .pill-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.bgFit = btn.getAttribute('data-fit');
        saveSettings();
        applySettingsToDom();
      });
    });

    function bindRangeSlider(sliderId, valLabelId, settingKey, suffix) {
      const el = document.getElementById(sliderId);
      el.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        settings[settingKey] = v;
        document.getElementById(valLabelId).textContent = v + suffix;
        saveSettings();
      });
    }

    bindRangeSlider('slider-bg-zoom', 'val-bg-zoom', 'bgZoom', '%');
    bindRangeSlider('slider-bg-pan-x', 'val-bg-pan-x', 'bgPanX', '%');
    bindRangeSlider('slider-bg-pan-y', 'val-bg-pan-y', 'bgPanY', '%');
    bindRangeSlider('slider-bg-volume', 'val-bg-volume', 'bgVolume', '%');
    bindRangeSlider('slider-char-size', 'val-char-size', 'charSize', '%');
    bindRangeSlider('slider-char-vert', 'val-char-vert', 'charVerticalPos', '%');
    bindRangeSlider('slider-char-edge', 'val-char-edge', 'charEdgeDist', '%');
    bindRangeSlider('slider-caption-size', 'val-caption-size', 'captionSize', 'px');
    bindRangeSlider('slider-outline-thickness', 'val-outline-thickness', 'outlineThickness', 'px');

    document.querySelectorAll('#bg-trim-pills .pill-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.bgTrimMode = btn.getAttribute('data-trim');
        saveSettings();
        applySettingsToDom();
      });
    });

    document.querySelectorAll('#silent-mode-pills .pill-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.silentMode = btn.getAttribute('data-silent');
        saveSettings();
        applySettingsToDom();
      });
    });

    // Captions controls
    document.getElementById('btn-toggle-captions').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      settings.captionsEnabled = !settings.captionsEnabled;
      saveSettings();
      applySettingsToDom();
    });

    document.querySelectorAll('#caption-template-grid .caption-tpl-card').forEach((card) => {
      card.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.1);
        settings.captionTemplate = card.getAttribute('data-tpl');
        if (settings.captionTemplate === 'pop_bounce') {
          settings.highlightColor = '#3ddc6a';
        } else if (settings.captionTemplate === 'classic_yellow') {
          settings.highlightColor = '#ffd93b';
        }
        saveSettings();
        applySettingsToDom();
      });
    });

    document.getElementById('select-caption-font').addEventListener('change', (e) => {
      settings.captionFont = e.target.value;
      saveSettings();
    });

    document.querySelectorAll('#caption-pos-pills .pill-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.captionPosition = btn.getAttribute('data-pos');
        saveSettings();
        applySettingsToDom();
      });
    });

    document.querySelectorAll('#words-per-screen-pills .pill-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.wordsPerScreen = Number(btn.getAttribute('data-wps'));
        saveSettings();
        applySettingsToDom();
      });
    });

    document.querySelectorAll('.color-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.highlightColor = sw.getAttribute('data-color');
        saveSettings();
        applySettingsToDom();
      });
    });

    document.getElementById('input-highlight-color').addEventListener('input', (e) => {
      settings.highlightColor = e.target.value;
      saveSettings();
    });

    document.getElementById('btn-toggle-speaker-tag').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      settings.showSpeakerTag = !settings.showSpeakerTag;
      saveSettings();
      applySettingsToDom();
    });

    // Render & Output buttons
    document.getElementById('btn-create-video').addEventListener('click', () => {
      handleCreateFullVideo();
    });

    document.getElementById('btn-download-video').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.15);
      saveBlobToAndroidGallery(lastRenderedBlob, lastRenderedMimeType, false);
    });

    document.getElementById('btn-share-video').addEventListener('click', () => {
      shareRenderedVideo();
    });

    document.getElementById('btn-make-another').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.15);
      document.getElementById('render-output-section').classList.add('hidden');
      goToStep(2);
    });
  }

  // Boot application
  document.addEventListener('DOMContentLoaded', () => {
    applySettingsToDom();
    initStarterAssets();
    bindEvents();
    startStudioPreviewLoop();
  });
})();
