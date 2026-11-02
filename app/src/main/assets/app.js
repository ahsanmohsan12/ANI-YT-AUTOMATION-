// app.js - Main Controller for ToonTalk Studio 9:16 Video Maker

(function () {
  const STORAGE_KEY = 'toontalk_studio_prefs_v1';
  const API_KEY_STORAGE = 'toontalk_local_gemini_key';
  const ELEVENLABS_KEY_STORAGE = 'ani_shorts_elevenlabs_key';
  const OPENAI_KEY_STORAGE = 'ani_shorts_openai_key';
  const KOKORO_KEY_STORAGE = 'ani_shorts_kokoro_key';
  const KOKORO_URL_STORAGE = 'ani_shorts_kokoro_url';
  const HF_KEY_STORAGE = 'ani_shorts_hf_key';

  // Cached kokoro-js ONNX instance
  let kokoroTtsInstance = null;
  let kokoroTtsLoadingPromise = null;

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

  function callNativeBridge(methodName, payloadObj, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (window.AndroidBridge && typeof window.AndroidBridge[methodName] === 'function') {
        const cbId = 'cb_' + (bridgeSeq++) + '_' + Date.now();
        const timer = setTimeout(() => {
          if (pendingCallbacks[cbId]) {
            delete pendingCallbacks[cbId];
            resolve({ ok: false, timedOut: true });
          }
        }, timeoutMs);
        pendingCallbacks[cbId] = {
          resolve: (payload) => {
            clearTimeout(timer);
            resolve(payload);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        };
        try {
          window.AndroidBridge[methodName](cbId, JSON.stringify(payloadObj || {}));
        } catch (err) {
          clearTimeout(timer);
          delete pendingCallbacks[cbId];
          reject(err);
        }
      } else {
        resolve({ ok: false, noBridge: true });
      }
    });
  }

  // Voice Catalogs for all providers
  const VOICE_CATALOGS = {
    audio8: [
      {
        group: '🎧 Edge0/Audio8-TTS-Realistic-0.6b (44.1kHz Ultra-Realistic Female)',
        voices: [
          { id: 'af_heart', label: 'Audio8 Heart — Warm Realistic Studio Female ⭐' },
          { id: 'af_bella', label: 'Audio8 Bella — Expressive Viral Creator Female ⭐' },
          { id: 'af_nova', label: 'Audio8 Nova — Snappy Shorts Narrator Female' },
          { id: 'af_nicole', label: 'Audio8 Nicole — Smooth Chill ASMR Female' },
          { id: 'af_sarah', label: 'Audio8 Sarah — Confident Clear Storyteller Female' },
          { id: 'af_sky', label: 'Audio8 Sky — Upbeat Energetic Young Female' },
          { id: 'af_kore', label: 'Audio8 Kore — Bright Anime & Gaming Female' },
          { id: 'bf_emma', label: 'Audio8 Emma — Refined British Studio Female' }
        ]
      },
      {
        group: '🎧 Edge0/Audio8-TTS-Realistic-0.6b (44.1kHz Ultra-Realistic Male)',
        voices: [
          { id: 'am_michael', label: 'Audio8 Michael — Natural YouTuber Creator Male ⭐' },
          { id: 'am_adam', label: 'Audio8 Adam — Deep Viral Documentary Male ⭐' },
          { id: 'am_fenrir', label: 'Audio8 Fenrir — High-Energy Hype & Gamer Male' },
          { id: 'am_puck', label: 'Audio8 Puck — Playful Witty Sidekick Male' },
          { id: 'am_echo', label: 'Audio8 Echo — Warm Smooth Podcaster Male' },
          { id: 'am_onyx', label: 'Audio8 Onyx — Ultra-Deep Movie Trailer Male' },
          { id: 'bm_george', label: 'Audio8 George — Classic British Narrator Male' },
          { id: 'bm_daniel', label: 'Audio8 Daniel — Deep UK Studio Male' }
        ]
      },
      {
        group: '🇮🇳 Edge0/Audio8-TTS-Realistic-0.6b (Hindi / Urdu / Hinglish)',
        voices: [
          { id: 'hf_alpha', label: 'Audio8 Alpha — Natural Hindi / Desi Female ⭐' },
          { id: 'hf_beta', label: 'Audio8 Beta — Expressive Desi Vlogger Female' },
          { id: 'hm_omega', label: 'Audio8 Omega — Deep Hindi / Urdu Creator Male ⭐' },
          { id: 'hm_psi', label: 'Audio8 Psi — Energetic Hinglish / Urdu Male' }
        ]
      }
    ],
    kokoro: [
      {
        group: '🇺🇸 Kokoro-82M American Female (hexgrad/kokoro)',
        voices: [
          { id: 'af_heart', label: 'af_heart — Heart (Flagship Grade-A Natural Female ⭐)' },
          { id: 'af_bella', label: 'af_bella — Bella (Warm Expressive Creator Female ⭐)' },
          { id: 'af_nicole', label: 'af_nicole — Nicole (Smooth ASMR & Chill Female)' },
          { id: 'af_sarah', label: 'af_sarah — Sarah (Confident Clear Storyteller Female)' },
          { id: 'af_sky', label: 'af_sky — Sky (Upbeat Energetic Young Female)' },
          { id: 'af_aoede', label: 'af_aoede — Aoede (Melodic Dynamic Female)' },
          { id: 'af_kore', label: 'af_kore — Kore (Bright Anime & Snappy Female)' },
          { id: 'af_nova', label: 'af_nova — Nova (Viral Shorts Narrator Female)' },
          { id: 'af_jessica', label: 'af_jessica — Jessica (Conversational Podcaster Female)' },
          { id: 'af_river', label: 'af_river — River (Calm Documentary Female)' }
        ]
      },
      {
        group: '🇺🇸 Kokoro-82M American Male (hexgrad/kokoro)',
        voices: [
          { id: 'am_adam', label: 'am_adam — Adam (Deep Viral Narrator Male ⭐)' },
          { id: 'am_michael', label: 'am_michael — Michael (Natural YouTuber Creator Male ⭐)' },
          { id: 'am_fenrir', label: 'am_fenrir — Fenrir (High-Energy Hype & Gamer Male)' },
          { id: 'am_puck', label: 'am_puck — Puck (Playful Witty Sidekick Male)' },
          { id: 'am_echo', label: 'am_echo — Echo (Warm Smooth Podcaster Male)' },
          { id: 'am_eric', label: 'am_eric — Eric (Clear Tech & Facts Male)' },
          { id: 'am_liam', label: 'am_liam — Liam (Fast Snappy Creator Male)' },
          { id: 'am_onyx', label: 'am_onyx — Onyx (Ultra-Deep Movie Trailer Male)' }
        ]
      },
      {
        group: '🇬🇧 Kokoro-82M British English',
        voices: [
          { id: 'bf_emma', label: 'bf_emma — Emma (Refined British Creator Female ⭐)' },
          { id: 'bf_isabella', label: 'bf_isabella — Isabella (Expressive British Story Female)' },
          { id: 'bf_alice', label: 'bf_alice — Alice (Polished UK Narrator Female)' },
          { id: 'bf_lily', label: 'bf_lily — Lily (Cheerful London Vlogger Female)' },
          { id: 'bm_george', label: 'bm_george — George (Classic British Documentary Male ⭐)' },
          { id: 'bm_lewis', label: 'bm_lewis — Lewis (Modern UK Podcaster Male)' },
          { id: 'bm_daniel', label: 'bm_daniel — Daniel (Deep British Studio Male)' },
          { id: 'bm_fable', label: 'bm_fable — Fable (Dramatic Storybook UK Male)' }
        ]
      },
      {
        group: '🇮🇳 Kokoro-82M Hindi & Desi',
        voices: [
          { id: 'hf_alpha', label: 'hf_alpha — Alpha (Natural Hindi / Desi Female ⭐)' },
          { id: 'hf_beta', label: 'hf_beta — Beta (Expressive Hindi Vlogger Female)' },
          { id: 'hm_omega', label: 'hm_omega — Omega (Deep Hindi / Desi Creator Male ⭐)' },
          { id: 'hm_psi', label: 'hm_psi — Psi (Energetic Hinglish / Hindi Male)' }
        ]
      }
    ],
    builtin: [
      {
        group: '🇺🇸 Natural American',
        voices: [
          { id: 'Alex', label: 'Alex (Casual Confident Podcaster Male)' },
          { id: 'Emma', label: 'Emma (Warm & Conversational Female)' },
          { id: 'Marcus', label: 'Marcus (Deep Studio Movie Trailer Male)' },
          { id: 'Chloe', label: 'Chloe (Snappy High-Energy Female)' },
          { id: 'Leo', label: 'Leo (Chill Gamer Teen Male)' },
          { id: 'Maya', label: 'Maya (Empathetic Storyteller Female)' },
          { id: 'Sam', label: 'Sam (Neutral Documentary Male)' },
          { id: 'Sophia', label: 'Sophia (Polished News Anchor Female)' },
          { id: 'Jack', label: 'Jack (Raspy Action Hero Male)' },
          { id: 'Ethan', label: 'Ethan (Friendly Tech Reviewer Male)' }
        ]
      },
      {
        group: '🇬🇧 British & Aussie Charisma',
        voices: [
          { id: 'Oliver', label: 'Oliver (Refined British Gentleman Male)' },
          { id: 'Lily', label: 'Lily (Cheerful British Creator Female)' },
          { id: 'Arthur', label: 'Arthur (Vintage BBC Documentary Male)' },
          { id: 'Mia', label: 'Mia (Lively Aussie Creator Female)' },
          { id: 'Liam', label: 'Liam (Upbeat London Streamer Male)' }
        ]
      },
      {
        group: '🇮🇳 Desi (Hindi / Urdu / Hinglish)',
        voices: [
          { id: 'Arjun', label: 'Arjun (Desi Tech Guy / Hinglish Male)' },
          { id: 'Priya', label: 'Priya (Natural Indian English / Hindi Female)' },
          { id: 'Kabir', label: 'Kabir (Deep Bollywood Narrator Male)' },
          { id: 'Ananya', label: 'Ananya (Vibrant Desi Vlogger Female)' },
          { id: 'Zayd', label: 'Zayd (Smooth Roman Urdu / Urdu Male)' },
          { id: 'Ayesha', label: 'Ayesha (Expressive Urdu / Hindi Female)' }
        ]
      },
      {
        group: '🤖 Gemini AI & Game Personas',
        voices: [
          { id: 'Puck', label: 'Puck (Confident & Punchy Hero)' },
          { id: 'Charon', label: 'Charon (Deep & Grumpy Boss)' },
          { id: 'Zephyr', label: 'Zephyr (Silly Playful Sidekick)' },
          { id: 'Fenrir', label: 'Fenrir (Fast Dramatic Hype)' },
          { id: 'Kore', label: 'Kore (Bright Kawaii Anime)' },
          { id: 'Aoede', label: 'Aoede (Sarcastic Melodic Diva)' },
          { id: 'Leda', label: 'Leda (Calm Melodic Mystic)' },
          { id: 'Orpheus', label: 'Orpheus (Cinematic Epic Narrator)' }
        ]
      }
    ],
    elevenlabs: [
      {
        group: '⚡ ElevenLabs Ultra-Realistic AI Voices',
        voices: [
          { id: 'Adam', label: 'Adam (Narrative Deep Studio Male)' },
          { id: 'Rachel', label: 'Rachel (Calm Warm Professional Female)' },
          { id: 'Antoni', label: 'Antoni (Punchy Energetic Male)' },
          { id: 'Josh', label: 'Josh (Young Upbeat Gamer Male)' },
          { id: 'Bella', label: 'Bella (Soft Expressive Dynamic Female)' },
          { id: 'Arnold', label: 'Arnold (Powerful Action Trailer Male)' },
          { id: 'Sam', label: 'Sam (Confident Charismatic Male)' },
          { id: 'Elli', label: 'Elli (Expressive Young Female)' },
          { id: 'Domi', label: 'Domi (Strong Emphatic Confident Female)' },
          { id: 'Charlie', label: 'Charlie (Casual Australian Creator Male)' },
          { id: 'George', label: 'George (Warm British Storyteller Male)' },
          { id: 'Liam', label: 'Liam (Upbeat London Streamer Male)' },
          { id: 'Charlotte', label: 'Charlotte (Charming British Female)' },
          { id: 'Alice', label: 'Alice (Clear Confident Female)' },
          { id: 'Matilda', label: 'Matilda (Warm Storybook Female)' },
          { id: 'Will', label: 'Will (Friendly Optimistic Male)' },
          { id: 'Jessica', label: 'Jessica (Bright Conversational Female)' },
          { id: 'Eric', label: 'Eric (Smooth Conversational Male)' },
          { id: 'Chris', label: 'Chris (Casual Podcaster Male)' },
          { id: 'Brian', label: 'Brian (Deep Authoritative Male)' },
          { id: 'Daniel', label: 'Daniel (Steady Announcer Male)' },
          { id: 'Lily', label: 'Lily (Warm Cheerful British Female)' },
          { id: 'Bill', label: 'Bill (Trustworthy Documentary Male)' }
        ]
      }
    ],
    openai: [
      {
        group: '🤖 OpenAI Studio TTS Models',
        voices: [
          { id: 'alloy', label: 'Alloy (Versatile & Balanced Neutral)' },
          { id: 'echo', label: 'Echo (Warm & Well-rounded Male)' },
          { id: 'fable', label: 'Fable (Expressive British Narrator)' },
          { id: 'onyx', label: 'Onyx (Deep Authoritative & Dramatic Male)' },
          { id: 'nova', label: 'Nova (Snappy Upbeat Conversational Female)' },
          { id: 'shimmer', label: 'Shimmer (Bright Resonant Emotional Female)' }
        ]
      }
    ]
  };

  // Default persisted settings
  const defaultSettings = {
    charAName: 'A',
    charBName: 'B',
    idea: 'octopus',
    scriptType: 'Funny Facts',
    customStyle: '',
    language: 'English',
    lengthSec: 30,
    voiceProvider: 'audio8',
    voiceA: 'am_michael',
    voiceB: 'af_heart',
    customVoiceIdA: '',
    customVoiceIdB: '',
    speedA: 1.05,
    speedB: 1.05,
    pitchA: 1.0,
    pitchB: 1.0,
    bgFit: 'fill',
    bgZoom: 120,
    bgPanX: 0,
    bgPanY: 0,
    bgTrimMode: 'zero',
    bgVolume: 10,
    silentMode: 'hide',
    charSway: true,
    charSize: 100,
    charVerticalPos: 50,
    charEdgeDist: 4,
    captionsEnabled: true,
    captionTemplate: 'ae_hormozi',
    captionFont: 'Luckiest Guy',
    captionSize: 74,
    captionPosition: 'bottom',
    wordsPerScreen: 3,
    highlightColor: '#3ddc6a',
    outlineThickness: 10,
    showSpeakerTag: true
  };

  const VOICE_DUO_PRESETS = {
    natural: { voiceA: 'am_michael', voiceB: 'af_heart', speedA: 1.0, speedB: 1.0, pitchA: 1.0, pitchB: 1.0 },
    gamer: { voiceA: 'am_fenrir', voiceB: 'am_puck', speedA: 1.1, speedB: 1.15, pitchA: 1.05, pitchB: 1.1 },
    trailer: { voiceA: 'am_onyx', voiceB: 'am_adam', speedA: 0.92, speedB: 0.96, pitchA: 0.88, pitchB: 0.92 },
    story: { voiceA: 'bm_george', voiceB: 'bf_emma', speedA: 0.96, speedB: 1.0, pitchA: 1.0, pitchB: 1.04 },
    desi: { voiceA: 'hm_omega', voiceB: 'hf_alpha', speedA: 1.05, speedB: 1.05, pitchA: 1.0, pitchB: 1.08 },
    bollywood: { voiceA: 'hm_psi', voiceB: 'hf_beta', speedA: 0.98, speedB: 1.05, pitchA: 0.94, pitchB: 1.08 },
    urdu: { voiceA: 'hm_omega', voiceB: 'hf_alpha', speedA: 1.0, speedB: 1.04, pitchA: 1.0, pitchB: 1.05 },
    bbcdoc: { voiceA: 'bm_daniel', voiceB: 'bf_alice', speedA: 0.94, speedB: 0.98, pitchA: 0.90, pitchB: 1.02 },
    action: { voiceA: 'am_adam', voiceB: 'af_bella', speedA: 1.05, speedB: 1.02, pitchA: 0.95, pitchB: 1.05 },
    anime: { voiceA: 'af_kore', voiceB: 'af_sky', speedA: 1.1, speedB: 1.18, pitchA: 1.12, pitchB: 1.2 }
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

  function getElevenLabsApiKey() {
    try {
      return localStorage.getItem(ELEVENLABS_KEY_STORAGE) || '';
    } catch (_) {
      return '';
    }
  }

  function setElevenLabsApiKey(key) {
    try {
      localStorage.setItem(ELEVENLABS_KEY_STORAGE, (key || '').trim());
    } catch (_) {}
  }

  function getOpenAiApiKey() {
    try {
      return localStorage.getItem(OPENAI_KEY_STORAGE) || '';
    } catch (_) {
      return '';
    }
  }

  function setOpenAiApiKey(key) {
    try {
      localStorage.setItem(OPENAI_KEY_STORAGE, (key || '').trim());
    } catch (_) {}
  }

  function getKokoroApiKey() {
    try {
      return localStorage.getItem(KOKORO_KEY_STORAGE) || '';
    } catch (_) {
      return '';
    }
  }

  function setKokoroApiKey(key) {
    try {
      localStorage.setItem(KOKORO_KEY_STORAGE, (key || '').trim());
    } catch (_) {}
  }

  function getKokoroApiUrl() {
    try {
      return localStorage.getItem(KOKORO_URL_STORAGE) || '';
    } catch (_) {
      return '';
    }
  }

  function setKokoroApiUrl(url) {
    try {
      localStorage.setItem(KOKORO_URL_STORAGE, (url || '').trim());
    } catch (_) {}
  }

  function getHfApiKey() {
    try {
      return localStorage.getItem(HF_KEY_STORAGE) || '';
    } catch (_) {
      return '';
    }
  }

  function setHfApiKey(key) {
    try {
      localStorage.setItem(HF_KEY_STORAGE, (key || '').trim());
    } catch (_) {}
  }

  function populateVoiceSelects(provider) {
    const selA = document.getElementById('select-voice-a');
    const selB = document.getElementById('select-voice-b');
    if (!selA || !selB) return;

    const catalog = VOICE_CATALOGS[provider] || VOICE_CATALOGS.audio8 || VOICE_CATALOGS.kokoro;
    let html = '';
    const validVoiceIds = new Set();

    catalog.forEach((cat) => {
      html += `<optgroup label="${cat.group}">`;
      cat.voices.forEach((v) => {
        validVoiceIds.add(v.id);
        html += `<option value="${v.id}">${v.label}</option>`;
      });
      html += `</optgroup>`;
    });

    if (provider === 'elevenlabs') {
      html += `<optgroup label="✨ Custom Voice ID">
        <option value="custom">Custom Voice ID (Use Box Below)</option>
      </optgroup>`;
      validVoiceIds.add('custom');
    }

    selA.innerHTML = html;
    selB.innerHTML = html;

    // Pick reasonable defaults if the active voice is not in this provider
    if (!validVoiceIds.has(settings.voiceA)) {
      if (provider === 'audio8' || provider === 'kokoro') settings.voiceA = 'am_michael';
      else if (provider === 'elevenlabs') settings.voiceA = 'Adam';
      else if (provider === 'openai') settings.voiceA = 'echo';
      else settings.voiceA = 'Alex';
    }
    if (!validVoiceIds.has(settings.voiceB)) {
      if (provider === 'audio8' || provider === 'kokoro') settings.voiceB = 'af_heart';
      else if (provider === 'elevenlabs') settings.voiceB = 'Rachel';
      else if (provider === 'openai') settings.voiceB = 'nova';
      else settings.voiceB = 'Emma';
    }

    selA.value = settings.voiceA;
    selB.value = settings.voiceB;

    updateProviderKeyBanner(provider);
  }

  function updateProviderKeyBanner(provider) {
    const banner = document.getElementById('provider-key-banner');
    const label = document.getElementById('provider-key-banner-label');
    const input = document.getElementById('input-inline-provider-key');
    const status = document.getElementById('provider-key-status');
    const customBox = document.getElementById('elevenlabs-custom-ids-box');
    const kokoroBanner = document.getElementById('kokoro-engine-banner');
    const audio8Banner = document.getElementById('audio8-engine-banner');

    if (audio8Banner) {
      if (provider === 'audio8') {
        audio8Banner.classList.remove('hidden');
        const hfInp = document.getElementById('input-inline-hf-key');
        const a8Status = document.getElementById('audio8-engine-status');
        const hfKey = getHfApiKey();
        if (hfInp) hfInp.value = hfKey;
        if (a8Status) {
          a8Status.textContent = hfKey
            ? '🎧 Edge0/Audio8-TTS-Realistic-0.6b Active (HF Token Connected • 44.1kHz DualAR TTS)'
            : '🎧 Edge0/Audio8-TTS-Realistic-0.6b Active (Paste Hugging Face hf_... Token or set HUGGINGFACE_API_KEY in AI Studio Secrets)';
        }
      } else {
        audio8Banner.classList.add('hidden');
      }
    }

    if (kokoroBanner) {
      if (provider === 'kokoro') {
        kokoroBanner.classList.remove('hidden');
        const kKeyInp = document.getElementById('input-inline-kokoro-key');
        const kUrlInp = document.getElementById('input-inline-kokoro-url');
        const kStatus = document.getElementById('kokoro-engine-status');
        const kKey = getKokoroApiKey();
        const kUrl = getKokoroApiUrl();
        if (kKeyInp) kKeyInp.value = kKey;
        if (kUrlInp) kUrlInp.value = kUrl;
        if (kStatus) {
          if (kUrl || kKey) {
            kStatus.textContent = '🦊 hexgrad/Kokoro-82M Connected (Cloud API + On-Device ONNX)';
          } else if (kokoroTtsInstance) {
            kStatus.textContent = '🦊 hexgrad/Kokoro-82M Active (kokoro-js ONNX Loaded & Ready!)';
          } else {
            kStatus.textContent = '🦊 hexgrad/Kokoro-82M Ready (Free On-Device Neural ONNX + Optional API)';
          }
        }
      } else {
        kokoroBanner.classList.add('hidden');
      }
    }

    if (!banner) return;

    if (provider === 'builtin' || provider === 'kokoro' || provider === 'audio8') {
      banner.classList.add('hidden');
      if (customBox) customBox.classList.add('hidden');
      return;
    }

    banner.classList.remove('hidden');
    if (provider === 'elevenlabs') {
      if (customBox) {
        customBox.classList.remove('hidden');
        const customInpA = document.getElementById('input-custom-voice-id-a');
        const customInpB = document.getElementById('input-custom-voice-id-b');
        if (customInpA) customInpA.value = settings.customVoiceIdA || '';
        if (customInpB) customInpB.value = settings.customVoiceIdB || '';
      }
      label.textContent = '🔑 ElevenLabs API Key:';
      input.placeholder = 'Paste xi-api-key...';
      const key = getElevenLabsApiKey();
      input.value = key;
      status.textContent = key ? '✅ ElevenLabs API Key Active (Ultra-Realistic AI Voice Actors)' : '⚠️ ElevenLabs Key required for these voices. Paste key above & tap Save.';
      status.style.color = key ? '#007a33' : '#b25900';
    } else if (provider === 'openai') {
      if (customBox) customBox.classList.add('hidden');
      label.textContent = '🔑 OpenAI API Key:';
      input.placeholder = 'Paste sk-... key...';
      const key = getOpenAiApiKey();
      input.value = key;
      status.textContent = key ? '✅ OpenAI API Key Active (TTS-1 High Quality Voice Models)' : '⚠️ OpenAI Key required for these voices. Paste key above & tap Save.';
      status.style.color = key ? '#007a33' : '#b25900';
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

    // Voice Engine Provider & Selects
    const provider = settings.voiceProvider || 'audio8';
    document.querySelectorAll('.voice-provider-pill').forEach((btn) => {
      const match = btn.getAttribute('data-provider') === provider;
      btn.classList.toggle('btn-yellow', match);
      btn.classList.toggle('btn-white', !match);
    });
    populateVoiceSelects(provider);

    document.getElementById('select-voice-a').value = settings.voiceA;
    document.getElementById('select-voice-b').value = settings.voiceB;

    const spdASlider = document.getElementById('slider-speed-a');
    if (spdASlider) {
      spdASlider.value = settings.speedA || 1.0;
      document.getElementById('val-speed-a').textContent = (settings.speedA || 1.0).toFixed(2) + 'x';
    }
    const spdBSlider = document.getElementById('slider-speed-b');
    if (spdBSlider) {
      spdBSlider.value = settings.speedB || 1.0;
      document.getElementById('val-speed-b').textContent = (settings.speedB || 1.0).toFixed(2) + 'x';
    }
    const ptcASlider = document.getElementById('slider-pitch-a');
    if (ptcASlider) {
      ptcASlider.value = settings.pitchA || 1.0;
      document.getElementById('val-pitch-a').textContent = (settings.pitchA || 1.0).toFixed(2) + 'x';
    }
    const ptcBSlider = document.getElementById('slider-pitch-b');
    if (ptcBSlider) {
      ptcBSlider.value = settings.pitchB || 1.0;
      document.getElementById('val-pitch-b').textContent = (settings.pitchB || 1.0).toFixed(2) + 'x';
    }

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
    const swayBtn = document.getElementById('btn-toggle-char-sway');
    if (swayBtn) {
      const swayOn = settings.charSway !== false;
      swayBtn.textContent = swayOn ? 'Character Sway: ON ✅' : 'Character Sway: OFF ❌';
      swayBtn.className = 'btn-cartoon btn-sm ' + (swayOn ? 'btn-green' : 'btn-pink');
    }
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

      let result = null;
      try {
        result = await callNativeBridge('generateScript', payload, 10000);
      } catch (_) {}

      if (!result || !result.ok || result.noBridge || result.timedOut || !Array.isArray(result.lines) || result.lines.length === 0) {
        // Instant viral YouTuber & social media creator fallback
        result = await generateScriptDirectBrowser(payload);
      }

      clearInterval(msgTimer);
      loadingBox.classList.add('hidden');
      editorCard.classList.remove('hidden');

      if (!result || !Array.isArray(result.lines) || result.lines.length === 0) {
        result = {
          lines: [
            { speaker: 'A', text: `Stop scrolling! Nobody tells you the wildest truth about ${payload.idea}!` },
            { speaker: 'B', text: `Wait really?! I thought ${payload.idea} was completely normal!` },
            { speaker: 'A', text: `Not even close! In viral mode, ${payload.idea} breaks every rule you know.` },
            { speaker: 'B', text: `Bro my brain just lagged harder than a 999 ping server!` },
            { speaker: 'A', text: `And the craziest part is what happens at the very end.` },
            { speaker: 'B', text: `Drop your guess in the comments right now if you knew this!` }
          ]
        };
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
      // Emergency graceful fallback to avoid blocking user
      scriptLines = [
        { id: 'line_1', speaker: 'A', text: `Stop scrolling! What you don't know about ${settings.idea} is insane!`, audioBuffer: null, durationSec: 2.8, status: 'idle' },
        { id: 'line_2', speaker: 'B', text: `Wait what?! I literally had no idea! Tell me right now!`, audioBuffer: null, durationSec: 2.6, status: 'idle' },
        { id: 'line_3', speaker: 'A', text: `It completely breaks the rules and scientists are still baffled.`, audioBuffer: null, durationSec: 2.7, status: 'idle' },
        { id: 'line_4', speaker: 'B', text: `Drop your reaction in the comments if you knew this!`, audioBuffer: null, durationSec: 2.5, status: 'idle' }
      ];
      renderScriptLinesEditor();
    }
  }

  function estimateDurationFromWords(text) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    return Number(Math.max(1.2, words * 0.30 + 0.35).toFixed(2));
  }

  async function generateScriptDirectBrowser(payload) {
    const topic = (payload.idea || 'viral video').trim();
    const lower = topic.toLowerCase();
    const lang = payload.language || 'English';

    if (payload.apiKey) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(payload.apiKey)}`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `You are a viral YouTube Shorts and TikTok comedy creator. Write a snappy ${payload.lengthSec}s ${payload.scriptType} dialogue about "${topic}" in ${lang}. Alternate A and B strictly, max 16 words per line. Return JSON {"lines":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]}.`
                }]
              }],
              generationConfig: { responseMimeType: 'application/json' }
            })
          }
        );
        clearTimeout(timeoutId);
        if (resp.ok) {
          const data = await resp.json();
          const raw = data.candidates[0].content.parts[0].text;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.lines)) return { ok: true, lines: parsed.lines };
        }
      } catch (_) {}
    }

    // Professional YouTuber viral script matrix (instant & reliable)
    if (lang === 'Hindi') {
      if (lower.includes('octopus')) {
        return {
          ok: true,
          lines: [
            { speaker: 'A', text: 'अरे भाई रुको! क्या तुम्हें पता है ऑक्टोपस के तीन दिल और नीला खून होता है?!' },
            { speaker: 'B', text: 'क्या बात कर रहे हो?! तीन दिल और मुझे एक भी नहीं मिला!' },
            { speaker: 'A', text: 'इतना ही नहीं, उसके नौ दिमाग होते हैं—हर हाथ अपने आप सोचता है!' },
            { speaker: 'B', text: 'नौ दिमाग?! और मेरे दोस्त फिर भी लावा में कूद जाते हैं!' },
            { speaker: 'A', text: 'और खतरा देखकर वो अपना रंग और रूप दो सेकंड में बदल लेता है!' },
            { speaker: 'B', text: 'कमेंट्स में बताओ क्या ऑक्टोपस एलियन है या असली प्राणी?!' }
          ]
        };
      }
      return {
        ok: true,
        lines: [
          { speaker: 'A', text: `रुक जाओ! ${topic} के बारे में ये वायरल सच 99% लोगों को नहीं पता!` },
          { speaker: 'B', text: `अरे सच में?! मुझे तो लगा ${topic} बिल्कुल नॉर्मल चीज़ है!` },
          { speaker: 'A', text: `बिल्कुल नहीं! जब तुम इसके पीछे का साइंस जानोगे तो होश उड़ जाएंगे!` },
          { speaker: 'B', text: `भाई मेरा तो दिमाग ही हिल गया! जल्दी बताओ आगे क्या हुआ!` },
          { speaker: 'A', text: `और सबसे क्रेज़ी बात तो ये है कि ये हर रोज़ हमारे साथ होता है!` },
          { speaker: 'B', text: `अभी कमेंट्स में अपनी राय बताओ, क्या तुम्हें ये पहले से पता था?!` }
        ]
      };
    }

    if (lang === 'Roman Urdu') {
      if (lower.includes('octopus')) {
        return {
          ok: true,
          lines: [
            { speaker: 'A', text: 'Bhai ruko! Kya tumhein pata hai octopus ke teen dil aur neela khoon hota hai?!' },
            { speaker: 'B', text: 'Kya baat kar rahe ho yaar?! Teen dil aur mere paas ek bhi nahi bacha!' },
            { speaker: 'A', text: 'Sirf yeh nahi, uske 9 dimaag hote hain—har haath alag sochta hai!' },
            { speaker: 'B', text: '9 dimaag?! Aur mere squad mates phir bhi seedha lava mein jump karte hain!' },
            { speaker: 'A', text: 'Aur khatra dekhte hi apna rang aur texture 2 second mein badal leta hai!' },
            { speaker: 'B', text: 'Abhi comments mein batao kya octopus alien hai ya jaanwar?!' }
          ]
        };
      }
      return {
        ok: true,
        lines: [
          { speaker: 'A', text: `Stop scrolling! ${topic} ke baare mein yeh viral baat kisi ne nahi batayi!` },
          { speaker: 'B', text: `Wait kya sach mein?! Main toh ${topic} ko aam si baat samajhta tha!` },
          { speaker: 'A', text: `Bilkul nahi! ${topic} ke peechay ki haqeeqat sun kar hosh udd jayenge!` },
          { speaker: 'B', text: `Bhai mera toh dimaag hi hang ho gaya! Jaldi batao aage kya hai!` },
          { speaker: 'A', text: `Aur sabse crazy part yeh hai ke yeh har roz hamare saamne hota hai!` },
          { speaker: 'B', text: `Abhi comments mein batao agar tumhein yeh pehle se pata tha!` }
        ]
      };
    }

    // English viral social creator templates
    if (lower.includes('octopus')) {
      return {
        ok: true,
        lines: [
          { speaker: 'A', text: 'Stop scrolling! An octopus literally has THREE hearts and BLUE blood!' },
          { speaker: 'B', text: 'Wait what?! Three hearts and I still cannot find one valentine!' },
          { speaker: 'A', text: 'Even crazier: they have NINE brains! One in each arm to think independently!' },
          { speaker: 'B', text: 'Nine brains?! Yet my teammates still jump straight into lava!' },
          { speaker: 'A', text: 'They can also camouflage and vanish in under two seconds flat!' },
          { speaker: 'B', text: 'Are octopuses aliens living in our ocean? Debate in the comments right now!' }
        ]
      };
    }

    if (lower.includes('minecraft')) {
      return {
        ok: true,
        lines: [
          { speaker: 'A', text: 'Do NOT build your Minecraft house out of wood, and here is why!' },
          { speaker: 'B', text: 'Bro what?! My entire mansion is birch wood and aesthetic vibes!' },
          { speaker: 'A', text: 'All it takes is ONE lightning strike or a stealth Creeper whispering behind you!' },
          { speaker: 'B', text: 'Wait, is that why my basement suddenly became a smoking crater?!' },
          { speaker: 'A', text: 'Yes! Always build with stone bricks and keep a water bucket hotkeyed!' },
          { speaker: 'B', text: 'Drop your worst Minecraft death in the comments right now!' }
        ]
      };
    }

    if (lower.includes('student') || lower.includes('school')) {
      return {
        ok: true,
        lines: [
          { speaker: 'A', text: 'Setting an alarm for 6 AM is scientifically proven to cause emotional damage!' },
          { speaker: 'B', text: 'Bro facts! My soul is still sleeping while my body is walking to class!' },
          { speaker: 'A', text: 'And the teacher always calls on you the second you make eye contact!' },
          { speaker: 'B', text: 'My brain starts buffering like a 2005 dial-up router!' },
          { speaker: 'A', text: 'Yet tonight at 3 AM you will still be scrolling short videos in the dark!' },
          { speaker: 'B', text: 'If you do this every single school night, leave a comment right now!' }
        ]
      };
    }

    return {
      ok: true,
      lines: [
        { speaker: 'A', text: `Stop scrolling! Nobody tells you the wildest truth about ${topic}!` },
        { speaker: 'B', text: `Wait really?! I thought ${topic} was totally normal!` },
        { speaker: 'A', text: `Not even close! In ${payload.scriptType} mode, ${topic} breaks every rule you know.` },
        { speaker: 'B', text: `Bro my brain just lagged harder than a 999 ping server! What happened?!` },
        { speaker: 'A', text: `If you test ${topic} in real life, the result is completely insane.` },
        { speaker: 'B', text: `Drop your honest reaction in the comments right now if you knew this!` }
      ]
    };
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
  async function synthesizeWithKokoroJs(audioCtx, text, voiceName, speed = 1.0) {
    try {
      const kStatus = document.getElementById('kokoro-engine-status');
      if (!kokoroTtsInstance) {
        if (!kokoroTtsLoadingPromise) {
          kokoroTtsLoadingPromise = (async () => {
            if (kStatus) {
              kStatus.textContent = '⏳ Loading hexgrad/Kokoro-82M ONNX neural model (kokoro-js)...';
            }
            const mod = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm');
            const KokoroTTS = mod.KokoroTTS;
            const instance = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
              dtype: 'q8',
              device: 'wasm'
            });
            kokoroTtsInstance = instance;
            if (kStatus) {
              kStatus.textContent = '🦊 hexgrad/Kokoro-82M Active (kokoro-js ONNX Loaded & Ready!)';
            }
            return instance;
          })();
        }
        await Promise.race([
          kokoroTtsLoadingPromise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('Kokoro ONNX load timeout')), 14000))
        ]);
      }

      if (kokoroTtsInstance) {
        const cleanVoice = (voiceName && voiceName.includes('_')) ? voiceName : 'af_heart';
        const rawAudio = await kokoroTtsInstance.generate(text, {
          voice: cleanVoice,
          speed: Math.max(0.5, Math.min(2.0, speed || 1.0))
        });
        if (rawAudio && rawAudio.audio && rawAudio.audio.length > 0) {
          const sr = rawAudio.sampling_rate || 24000;
          const samples = rawAudio.audio;
          const buf = audioCtx.createBuffer(1, samples.length, sr);
          buf.getChannelData(0).set(samples);
          return buf;
        }
      }
    } catch (err) {
      console.warn('kokoro-js local ONNX fallback to native bridge:', err);
      kokoroTtsLoadingPromise = null;
    }
    return null;
  }

  async function synthesizeBufferForText(text, voiceName, pitch = 1.0, speed = 1.0, speaker = 'A') {
    const audioCtx = getSharedAudioCtx();
    const provider = settings.voiceProvider || 'audio8';
    const customVoiceId = (speaker === 'B') ? (settings.customVoiceIdB || '') : (settings.customVoiceIdA || '');
    const elevenLabsApiKey = getElevenLabsApiKey();
    const openAiApiKey = getOpenAiApiKey();
    const kokoroApiKey = getKokoroApiKey();
    const kokoroApiUrl = getKokoroApiUrl();
    const hfApiKey = getHfApiKey();

    // If provider is kokoro and no external API key/URL is set, try on-device kokoro-js ONNX first if already loaded
    if (provider === 'kokoro' && !kokoroApiKey && !kokoroApiUrl && kokoroTtsInstance) {
      const onnxBuf = await synthesizeWithKokoroJs(audioCtx, text, voiceName, speed);
      if (onnxBuf) return onnxBuf;
    }

    const res = await callNativeBridge('synthesizeVoice', {
      text,
      voiceName,
      provider,
      customVoiceId,
      language: settings.language,
      pitch,
      speed,
      apiKey: getLocalApiKey(),
      hfApiKey,
      elevenLabsApiKey,
      openAiApiKey,
      kokoroApiKey,
      kokoroApiUrl
    }, 25000);

    // If user selected kokoro or audio8 and native bridge used AndroidTTS/FormantSynth, also kick off background load of kokoro-js ONNX
    if ((provider === 'kokoro' || provider === 'audio8') && (!res || (res.providerUsed !== 'Kokoro-82M' && res.providerUsed !== 'Audio8-TTS-Realistic-0.6b')) && !kokoroTtsInstance && !kokoroTtsLoadingPromise) {
      synthesizeWithKokoroJs(audioCtx, text, voiceName, speed).catch(() => {});
    }

    if (res && res.ok && res.audioBase64) {
      try {
        const binaryString = atob(res.audioBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const decoded = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
        return decoded;
      } catch (decodeErr) {
        console.warn('Audio decode fallback triggered:', decodeErr);
      }
    }

    // Direct Web Audio / client fetch fallback if running outside Android Bridge
    if (provider === 'audio8' || provider === 'kokoro') {
      const onnxBuf = await synthesizeWithKokoroJs(audioCtx, text, voiceName, speed);
      if (onnxBuf) return onnxBuf;
    } else if (provider === 'elevenlabs' && elevenLabsApiKey) {
      try {
        const vIdMap = {
          Adam: 'pNInz6obpgDQGcFmaJgB', Rachel: '21m00Tcm4TlvDq8ikWAM', Antoni: 'ErXwobaYiN019PkySvjV',
          Josh: 'TxGEqnHWrfWFTfGW9XjX', Bella: 'EXAVITQu4vr4xnSDxMaL', Arnold: 'VR6AewLTigWG4xSOukaG',
          Sam: 'yoZ06aMxZJJ28mfd3POQ', Elli: 'MF3mGyEYCl7XYWbV9V6O', Domi: 'AZnzlk1XvdvUeBnXmlld',
          Charlie: 'IKne3meq5aSn9X80BHx2', George: 'JBFqnCBsd6RMkjVDRZzb', Liam: 'TX3LPaxmHKxFdv7VOQHJ',
          Charlotte: 'XB0fDUnXU5powFXDhCwa', Alice: 'Xb7hH8MSUJpSbSDYk0k2', Matilda: 'XrExE9yKIg1WjnnlVkGX',
          Will: 'bIHbv24MWmeRgasZH58o', Jessica: 'cgSgspJ2msm6clMCkdW9', Eric: 'cjVigY5qzO86Huf0OWal',
          Chris: 'iP95p4xoKVk53GoZ742B', Brian: 'nPczCjzI2devNBz1zQrb', Daniel: 'onwK4e9ZLuTAKqWW03F9',
          Lily: 'pFZP5JQG7iQjIQuC4Bku', Bill: 'pqHfZKP75CvOlQylNhV4'
        };
        const targetVoiceId = customVoiceId.trim() || vIdMap[voiceName] || 'pNInz6obpgDQGcFmaJgB';
        const resp = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + targetVoiceId, {
          method: 'POST',
          headers: {
            'xi-api-key': elevenLabsApiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        });
        if (resp.ok) {
          const arrBuf = await resp.arrayBuffer();
          return await audioCtx.decodeAudioData(arrBuf);
        }
      } catch (e) {
        console.warn('Browser ElevenLabs fetch fallback exception', e);
      }
    } else if (provider === 'openai' && openAiApiKey) {
      try {
        const resp = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + openAiApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice: voiceName.toLowerCase(),
            speed: speed
          })
        });
        if (resp.ok) {
          const arrBuf = await resp.arrayBuffer();
          return await audioCtx.decodeAudioData(arrBuf);
        }
      } catch (e) {
        console.warn('Browser OpenAI fetch fallback exception', e);
      }
    }

    // Direct Web Audio expressive vocal AudioBuffer synthesis fallback
    return createBrowserExpressiveAudioBuffer(audioCtx, text, voiceName, pitch, speed);
  }

  function createBrowserExpressiveAudioBuffer(audioCtx, text, voiceName, pitch = 1.0, speed = 1.0) {
    const words = (text || 'Hello').trim().split(/\s+/).filter(Boolean);
    const wordCount = Math.max(1, words.length);
    const secPerWord = Math.max(0.20, (0.28 / Math.max(0.6, speed)));
    const duration = Math.min(10.0, Math.max(1.2, wordCount * secPerWord + 0.25));
    const sampleRate = audioCtx.sampleRate || 24000;
    const totalSamples = Math.floor(duration * sampleRate);
    const buffer = audioCtx.createBuffer(1, totalSamples, sampleRate);
    const channel = buffer.getChannelData(0);

    const freqMap = {
      am_onyx: 104, Marcus: 104,
      bm_daniel: 108, Arthur: 108,
      am_adam: 114, Charon: 114,
      hm_omega: 118, Kabir: 118,
      bm_george: 122, Jack: 122,
      Orpheus: 125,
      bm_fable: 128, Oliver: 128,
      am_echo: 132, Sam: 132,
      am_fenrir: 135, Fenrir: 135,
      am_eric: 138, Alex: 138,
      am_michael: 142, Ethan: 142,
      hm_psi: 148, Arjun: 148,
      Zayd: 152,
      am_liam: 156, bm_lewis: 156, Liam: 156,
      Leo: 162,
      am_puck: 166, Puck: 166,
      af_nicole: 196, Leda: 196,
      af_river: 204, Sophia: 204,
      bf_alice: 210, bf_lily: 210, Lily: 210,
      af_aoede: 214, Aoede: 214,
      af_heart: 222, bf_emma: 222, Emma: 222,
      af_sarah: 228, Maya: 228,
      hf_alpha: 232, Priya: 232,
      af_bella: 236, bf_isabella: 236, hf_beta: 236, Ananya: 236,
      af_jessica: 238, Ayesha: 238,
      af_nova: 242, Mia: 242,
      af_kore: 246, Kore: 246,
      af_sky: 256, Chloe: 256,
      Zephyr: 268
    };

    const baseFreq = (freqMap[voiceName] || 165) * Math.max(0.7, Math.min(1.4, pitch));
    const isQuestion = text.trim().endsWith('?');

    // Human vocal tract formants (F1, F2, F3) for vowels
    const formants = [
      [730, 1090, 2440], // /a/
      [530, 1840, 2480], // /e/
      [270, 2290, 3010], // /i/
      [570, 840, 2410],  // /o/
      [300, 870, 2240]   // /u/
    ];

    let phase = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const wPos = t / secPerWord;
      const wIdx = Math.floor(wPos);
      const frac = wPos - wIdx;

      if (wIdx >= wordCount) {
        channel[i] = 0;
        continue;
      }

      // Smooth syllabic envelope with gentle attack and release
      const syllableEnv = Math.max(0, Math.sin(Math.min(1, frac * 1.15) * Math.PI));

      // Natural sentence declination with question rise
      const sentenceProgress = Math.min(1, Math.max(0, t / duration));
      const declination = isQuestion
        ? (sentenceProgress > 0.75 ? 1.0 + (sentenceProgress - 0.75) * 0.45 : 1.02 - sentenceProgress * 0.05)
        : (1.04 - sentenceProgress * 0.10);

      // Natural micro-vibrato (5.3 Hz human vocal cord tremor) + dynamic stress
      const vibrato = 1 + 0.016 * Math.sin(2 * Math.PI * 5.3 * t);
      const emphasis = 1 + 0.08 * Math.sin(wIdx * 1.7 + 0.2);
      const f0 = baseFreq * declination * vibrato * emphasis;

      phase += (2 * Math.PI * f0) / sampleRate;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

      // Realistic asymmetric glottal airflow pulse
      const glottal = phase < Math.PI * 1.3
        ? 0.5 * (1 - Math.cos(phase / 1.3))
        : Math.exp(-(phase - Math.PI * 1.3) * 3.5);

      // Syllable vowel selection based on word
      const vowelIdx = Math.abs((words[wIdx] || '').charCodeAt(0) || 0) % formants.length;
      const [f1, f2, f3] = formants[vowelIdx];

      // Formant filtering harmonics
      const h1 = Math.sin(phase * (f1 / f0)) * 0.45;
      const h2 = Math.sin(phase * (f2 / f0)) * 0.26;
      const h3 = Math.sin(phase * (f3 / f0)) * 0.14;
      const voicedWave = glottal * (h1 + h2 + h3);

      // Breath noise at start of each word
      const breath = frac < 0.12 ? (Math.random() - 0.5) * 0.20 * (1 - frac / 0.12) : 0;

      channel[i] = (voicedWave + breath) * syllableEnv * 0.42;
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

    const isA = line.speaker === 'A';
    const voiceName = isA ? settings.voiceA : settings.voiceB;
    const pitch = isA ? (settings.pitchA || 1.0) : (settings.pitchB || 1.0);
    const speed = isA ? (settings.speedA || 1.0) : (settings.speedB || 1.0);

    try {
      const buf = await synthesizeBufferForText(line.text, voiceName, pitch, speed, line.speaker);
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

      const ext = (lastRenderedMimeType || '').includes('mp4') ? 'mp4' : 'webm';
      const defaultFileName = `ToonTalk_${Date.now()}.${ext}`;

      const outputVideo = document.getElementById('rendered-output-video');
      outputVideo.src = lastRenderedUrl;
      outputVideo.load();

      // Configure direct download button anchor immediately
      const dlBtn = document.getElementById('btn-download-video');
      if (dlBtn) {
        dlBtn.href = lastRenderedUrl;
        dlBtn.download = defaultFileName;
      }

      progressSection.classList.add('hidden');
      outputSection.classList.remove('hidden');
      createBtn.disabled = false;

      window.StarterAssets.playCelebrationSound();
      window.StarterAssets.launchConfetti();

      // Automatically save to Android Gallery (Movies/ToonTalk) in background
      saveBlobToAndroidGallery(blob, lastRenderedMimeType, true).catch(() => {});
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
    if (!blob) return false;
    const ext = (mimeType || '').toLowerCase().includes('mp4') ? 'mp4' : 'webm';
    const fileName = `AniShorts_${Date.now()}.${ext}`;

    const badge = document.getElementById('gallery-save-status');
    if (!isAutoSave && badge) {
      badge.textContent = '⏳ Saving video to Gallery (Movies/AniShorts)...';
      badge.classList.remove('hidden');
    }

    try {
      if (window.AndroidBridge) {
        const base64Data = await blobToBase64(blob);
        const CHUNK_SIZE = 256 * 1024;
        const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
        const transferId = 'tx_' + Date.now();

        let finalRes = null;
        if (typeof window.AndroidBridge.saveVideoChunk === 'function' && totalChunks > 1) {
          for (let i = 0; i < totalChunks; i++) {
            const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            finalRes = await callNativeBridge('saveVideoChunk', {
              transferId,
              chunkIndex: i,
              totalChunks,
              chunkBase64: chunk,
              mimeType,
              isAutoSave
            }, 30000);
          }
        } else if (typeof window.AndroidBridge.saveVideoToGallery === 'function') {
          finalRes = await callNativeBridge('saveVideoToGallery', {
            base64Data,
            mimeType,
            isAutoSave
          }, 30000);
        }

        if (finalRes && finalRes.ok) {
          if (badge) {
            badge.textContent = `✅ Saved to Android Gallery (${finalRes.savedPath || 'Movies/AniShorts'})`;
            badge.classList.remove('hidden');
          }
          return true;
        }
      }
    } catch (err) {
      console.warn('Bridge save video error', err);
    }

    // Direct browser fallback download
    if (!isAutoSave && lastRenderedUrl) {
      const a = document.createElement('a');
      a.href = lastRenderedUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 150);

      if (badge) {
        badge.textContent = `✅ Download Started: ${fileName}`;
        badge.classList.remove('hidden');
      }
      return true;
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
      }, 20000);
      if (res && res.noBridge && navigator.share) {
        const ext = lastRenderedMimeType.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([lastRenderedBlob], `AniShorts.${ext}`, { type: lastRenderedMimeType });
        await navigator.share({
          title: 'ANI SHORTS 9:16 Video',
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
    function openSettingsModal() {
      window.StarterAssets.playPopSound();
      document.getElementById('input-local-api-key').value = getLocalApiKey();
      const hfKey = document.getElementById('input-hf-key');
      if (hfKey) hfKey.value = getHfApiKey();
      const kKey = document.getElementById('input-kokoro-key');
      if (kKey) kKey.value = getKokoroApiKey();
      const kUrl = document.getElementById('input-kokoro-url');
      if (kUrl) kUrl.value = getKokoroApiUrl();
      const elKey = document.getElementById('input-elevenlabs-key');
      if (elKey) elKey.value = getElevenLabsApiKey();
      const oaiKey = document.getElementById('input-openai-key');
      if (oaiKey) oaiKey.value = getOpenAiApiKey();
      document.getElementById('settings-modal').classList.remove('hidden');
    }

    document.getElementById('btn-open-settings').addEventListener('click', openSettingsModal);
    const quickKeyBtn = document.getElementById('btn-quick-voice-api-key');
    if (quickKeyBtn) quickKeyBtn.addEventListener('click', openSettingsModal);

    document.getElementById('btn-close-settings').addEventListener('click', () => {
      window.StarterAssets.playPopSound();
      document.getElementById('settings-modal').classList.add('hidden');
    });

    document.getElementById('btn-save-settings').addEventListener('click', () => {
      window.StarterAssets.playPopSound(1.15);
      const geminiVal = (document.getElementById('input-local-api-key').value || '').trim();
      const hfInp = document.getElementById('input-hf-key');
      const hfVal = hfInp ? hfInp.value.trim() : '';
      const kKeyInp = document.getElementById('input-kokoro-key');
      const kKeyVal = kKeyInp ? kKeyInp.value.trim() : '';
      const kUrlInp = document.getElementById('input-kokoro-url');
      const kUrlVal = kUrlInp ? kUrlInp.value.trim() : '';
      const elInp = document.getElementById('input-elevenlabs-key');
      const elVal = elInp ? elInp.value.trim() : '';
      const oaiInp = document.getElementById('input-openai-key');
      const oaiVal = oaiInp ? oaiInp.value.trim() : '';

      try {
        localStorage.setItem(API_KEY_STORAGE, geminiVal);
        setHfApiKey(hfVal);
        setKokoroApiKey(kKeyVal);
        setKokoroApiUrl(kUrlVal);
        setElevenLabsApiKey(elVal);
        setOpenAiApiKey(oaiVal);
      } catch (_) {}

      callNativeBridge('saveApiKeys', {
        geminiApiKey: geminiVal,
        hfApiKey: hfVal,
        kokoroApiKey: kKeyVal,
        kokoroApiUrl: kUrlVal,
        elevenLabsApiKey: elVal,
        openAiApiKey: oaiVal
      }).catch(() => {});

      updateProviderKeyBanner(settings.voiceProvider || 'audio8');
      document.getElementById('settings-modal').classList.add('hidden');
    });

    document.getElementById('btn-clear-settings').addEventListener('click', () => {
      window.StarterAssets.playPopSound(0.9);
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(API_KEY_STORAGE);
        localStorage.removeItem(HF_KEY_STORAGE);
        localStorage.removeItem(KOKORO_KEY_STORAGE);
        localStorage.removeItem(KOKORO_URL_STORAGE);
        localStorage.removeItem(ELEVENLABS_KEY_STORAGE);
        localStorage.removeItem(OPENAI_KEY_STORAGE);
      } catch (_) {}

      callNativeBridge('saveApiKeys', {
        geminiApiKey: '',
        hfApiKey: '',
        kokoroApiKey: '',
        kokoroApiUrl: '',
        elevenLabsApiKey: '',
        openAiApiKey: ''
      }).catch(() => {});

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
      if (file.size > 1024 * 1024 * 1024) {
        showFriendlyError('Video file exceeds 1GB limit. Please pick a video under 1GB!');
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

    // STEP 4: Voices, Duo Presets & Mood Expressions
    document.querySelectorAll('.voice-provider-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.15);
        const provider = btn.getAttribute('data-provider') || 'kokoro';
        settings.voiceProvider = provider;
        document.querySelectorAll('.voice-provider-pill').forEach((b) => {
          const match = b.getAttribute('data-provider') === provider;
          b.classList.toggle('btn-yellow', match);
          b.classList.toggle('btn-white', !match);
        });
        populateVoiceSelects(provider);
        saveSettings();
        scriptLines.forEach(l => l.audioBuffer = null);
        renderVoiceClipsList();
      });
    });

    const inlineHfSaveBtn = document.getElementById('btn-inline-save-hf');
    if (inlineHfSaveBtn) {
      inlineHfSaveBtn.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.2);
        const hfKey = (document.getElementById('input-inline-hf-key').value || '').trim();
        setHfApiKey(hfKey);
        callNativeBridge('saveApiKeys', { hfApiKey }).catch(() => {});
        updateProviderKeyBanner('audio8');
      });
    }

    const inlineKokoroSaveBtn = document.getElementById('btn-inline-save-kokoro');
    if (inlineKokoroSaveBtn) {
      inlineKokoroSaveBtn.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.2);
        const kKey = (document.getElementById('input-inline-kokoro-key').value || '').trim();
        const kUrl = (document.getElementById('input-inline-kokoro-url').value || '').trim();
        setKokoroApiKey(kKey);
        setKokoroApiUrl(kUrl);
        callNativeBridge('saveApiKeys', { kokoroApiKey: kKey, kokoroApiUrl: kUrl }).catch(() => {});
        updateProviderKeyBanner('kokoro');
      });
    }

    const inlineSaveBtn = document.getElementById('btn-inline-save-provider-key');
    if (inlineSaveBtn) {
      inlineSaveBtn.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.2);
        const val = (document.getElementById('input-inline-provider-key').value || '').trim();
        const provider = settings.voiceProvider || 'kokoro';
        if (provider === 'elevenlabs') {
          setElevenLabsApiKey(val);
          callNativeBridge('saveApiKeys', { elevenLabsApiKey: val }).catch(() => {});
        } else if (provider === 'openai') {
          setOpenAiApiKey(val);
          callNativeBridge('saveApiKeys', { openAiApiKey: val }).catch(() => {});
        }
        updateProviderKeyBanner(provider);
      });
    }

    const customIdInpA = document.getElementById('input-custom-voice-id-a');
    if (customIdInpA) {
      customIdInpA.addEventListener('input', (e) => {
        settings.customVoiceIdA = e.target.value.trim();
        saveSettings();
        scriptLines.forEach(l => { if (l.speaker === 'A') l.audioBuffer = null; });
      });
    }

    const customIdInpB = document.getElementById('input-custom-voice-id-b');
    if (customIdInpB) {
      customIdInpB.addEventListener('input', (e) => {
        settings.customVoiceIdB = e.target.value.trim();
        saveSettings();
        scriptLines.forEach(l => { if (l.speaker === 'B') l.audioBuffer = null; });
      });
    }

    document.querySelectorAll('.voice-duo-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.2);
        const duoKey = chip.getAttribute('data-duo');
        const preset = VOICE_DUO_PRESETS[duoKey];
        if (!preset) return;

        document.querySelectorAll('.voice-duo-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');

        Object.assign(settings, preset);
        saveSettings();
        applySettingsToDom();

        scriptLines.forEach(l => l.audioBuffer = null);
        renderVoiceClipsList();
        generateAllVoiceClips();
      });
    });

    document.querySelectorAll('.voice-mood-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        window.StarterAssets.playPopSound(1.15);
        document.querySelectorAll('.voice-mood-pill').forEach(p => {
          p.classList.remove('btn-yellow', 'selected');
          p.classList.add('btn-white');
        });
        pill.classList.remove('btn-white');
        pill.classList.add('btn-yellow', 'selected');

        const mood = pill.getAttribute('data-mood');
        const moodConfigs = {
          natural: { speed: 1.0, pitch: 1.0 },
          hype: { speed: 1.18, pitch: 1.08 },
          chill: { speed: 0.92, pitch: 0.95 },
          dramatic: { speed: 0.88, pitch: 0.88 }
        };
        const cfg = moodConfigs[mood] || moodConfigs.natural;
        settings.speedA = cfg.speed;
        settings.speedB = cfg.speed;
        settings.pitchA = cfg.pitch;
        settings.pitchB = cfg.pitch;
        saveSettings();
        applySettingsToDom();

        scriptLines.forEach(l => l.audioBuffer = null);
        renderVoiceClipsList();
        generateAllVoiceClips();
      });
    });

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

    // Speed & Pitch Sliders
    const spdASlider = document.getElementById('slider-speed-a');
    if (spdASlider) {
      spdASlider.addEventListener('input', (e) => {
        settings.speedA = Number(e.target.value);
        document.getElementById('val-speed-a').textContent = settings.speedA.toFixed(2) + 'x';
        saveSettings();
        scriptLines.forEach((l) => { if (l.speaker === 'A') l.audioBuffer = null; });
      });
    }

    const spdBSlider = document.getElementById('slider-speed-b');
    if (spdBSlider) {
      spdBSlider.addEventListener('input', (e) => {
        settings.speedB = Number(e.target.value);
        document.getElementById('val-speed-b').textContent = settings.speedB.toFixed(2) + 'x';
        saveSettings();
        scriptLines.forEach((l) => { if (l.speaker === 'B') l.audioBuffer = null; });
      });
    }

    const ptcASlider = document.getElementById('slider-pitch-a');
    if (ptcASlider) {
      ptcASlider.addEventListener('input', (e) => {
        settings.pitchA = Number(e.target.value);
        document.getElementById('val-pitch-a').textContent = settings.pitchA.toFixed(2) + 'x';
        saveSettings();
        scriptLines.forEach((l) => { if (l.speaker === 'A') l.audioBuffer = null; });
      });
    }

    const ptcBSlider = document.getElementById('slider-pitch-b');
    if (ptcBSlider) {
      ptcBSlider.addEventListener('input', (e) => {
        settings.pitchB = Number(e.target.value);
        document.getElementById('val-pitch-b').textContent = settings.pitchB.toFixed(2) + 'x';
        saveSettings();
        scriptLines.forEach((l) => { if (l.speaker === 'B') l.audioBuffer = null; });
      });
    }

    document.getElementById('btn-preview-voice-a').addEventListener('click', async () => {
      window.StarterAssets.playPopSound();
      const sampleText = `Hey! I am ${settings.charAName || 'A'}, speaking with the ${settings.voiceA} voice!`;
      const buf = await synthesizeBufferForText(sampleText, settings.voiceA, settings.pitchA || 1.0, settings.speedA || 1.0, 'A');
      playAudioBufferPreview(buf);
    });

    document.getElementById('btn-preview-voice-b').addEventListener('click', async () => {
      window.StarterAssets.playPopSound();
      const sampleText = `Whoa! And I am ${settings.charBName || 'B'}, reacting with the ${settings.voiceB} voice!`;
      const buf = await synthesizeBufferForText(sampleText, settings.voiceB, settings.pitchB || 1.0, settings.speedB || 1.0, 'B');
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

    const swayToggleBtn = document.getElementById('btn-toggle-char-sway');
    if (swayToggleBtn) {
      swayToggleBtn.addEventListener('click', () => {
        window.StarterAssets.playPopSound();
        settings.charSway = settings.charSway === false;
        saveSettings();
        applySettingsToDom();
      });
    }

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
        if (settings.captionTemplate === 'ae_hormozi') {
          settings.highlightColor = '#3ddc6a';
        } else if (settings.captionTemplate === 'ae_kinetic') {
          settings.highlightColor = '#ffd93b';
        } else if (settings.captionTemplate === 'ae_glow') {
          settings.highlightColor = '#00f5ff';
        } else if (settings.captionTemplate === 'ae_beast') {
          settings.highlightColor = '#ffd93b';
        } else if (settings.captionTemplate === 'ae_split') {
          settings.highlightColor = '#ffffff';
        } else if (settings.captionTemplate === 'ae_wave') {
          settings.highlightColor = '#ff7aa8';
        } else if (settings.captionTemplate === 'pop_bounce') {
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

    const playBtn = document.getElementById('btn-play-video');
    if (playBtn) {
      playBtn.addEventListener('click', async () => {
        window.StarterAssets.playPopSound(1.1);
        if (window.AndroidBridge && typeof window.AndroidBridge.openSavedVideo === 'function') {
          const res = await callNativeBridge('openSavedVideo', {});
          if (!res || !res.ok) {
            const vid = document.getElementById('rendered-output-video');
            if (vid) {
              vid.scrollIntoView({ behavior: 'smooth' });
              vid.play().catch(() => {});
            }
          }
        } else {
          const vid = document.getElementById('rendered-output-video');
          if (vid) {
            vid.scrollIntoView({ behavior: 'smooth' });
            vid.play().catch(() => {});
          }
        }
      });
    }

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

    callNativeBridge('getStoredApiKeys', {}).then((res) => {
      if (res && res.ok) {
        if (res.geminiApiKey && !getLocalApiKey()) localStorage.setItem(API_KEY_STORAGE, res.geminiApiKey);
        if (res.hfApiKey && !getHfApiKey()) setHfApiKey(res.hfApiKey);
        if (res.kokoroApiKey && !getKokoroApiKey()) setKokoroApiKey(res.kokoroApiKey);
        if (res.kokoroApiUrl && !getKokoroApiUrl()) setKokoroApiUrl(res.kokoroApiUrl);
        if (res.elevenLabsApiKey && !getElevenLabsApiKey()) setElevenLabsApiKey(res.elevenLabsApiKey);
        if (res.openAiApiKey && !getOpenAiApiKey()) setOpenAiApiKey(res.openAiApiKey);
        updateProviderKeyBanner(settings.voiceProvider || 'audio8');
      }
    }).catch(() => {});
  });
})();
