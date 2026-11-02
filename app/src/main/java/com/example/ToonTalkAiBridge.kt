package com.example

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.FileProvider
import com.google.firebase.Firebase
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.Schema
import com.google.firebase.ai.type.generationConfig
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "ToonTalkAiBridge"

class ToonTalkAiBridge(
  private val context: Context,
  private val scope: CoroutineScope,
  private val webViewProvider: () -> WebView?
) {

  private val okHttpClient by lazy {
    OkHttpClient.Builder()
      .connectTimeout(10, TimeUnit.SECONDS)
      .readTimeout(12, TimeUnit.SECONDS)
      .writeTimeout(10, TimeUnit.SECONDS)
      .build()
  }

  private val ttsHttpClient by lazy {
    OkHttpClient.Builder()
      .connectTimeout(4, TimeUnit.SECONDS)
      .readTimeout(5, TimeUnit.SECONDS)
      .writeTimeout(4, TimeUnit.SECONDS)
      .build()
  }

  private val scriptSchema by lazy {
    Schema.obj(
      properties = mapOf(
        "lines" to Schema.array(
          items = Schema.obj(
            properties = mapOf(
              "speaker" to Schema.enumeration(
                values = listOf("A", "B"),
                description = "Speaker identifier, strictly alternating A and B"
              ),
              "text" to Schema.string(
                description = "Dialogue line text, max 20 words, punchy and simple"
              )
            )
          ),
          description = "Alternating dialogue lines between Character A and Character B"
        )
      )
    )
  }

  private val singleLineSchema by lazy {
    Schema.obj(
      properties = mapOf(
        "text" to Schema.string(
          description = "Rewritten single dialogue line, maximum 20 words"
        )
      )
    )
  }

  private val scriptModel by lazy {
    Firebase.ai.generativeModel(
      modelName = "gemini-3.8-flash",
      generationConfig = generationConfig {
        responseMimeType = "application/json"
        responseSchema = scriptSchema
      }
    )
  }

  private val singleLineModel by lazy {
    Firebase.ai.generativeModel(
      modelName = "gemini-3.8-flash",
      generationConfig = generationConfig {
        responseMimeType = "application/json"
        responseSchema = singleLineSchema
      }
    )
  }

  @Volatile
  private var ttsEngine: TextToSpeech? = null
  @Volatile
  private var ttsReady = false
  private val ttsInitLatch = CountDownLatch(1)
  private val ttsMutex = kotlinx.coroutines.sync.Mutex()
  private val pendingUtterances = java.util.concurrent.ConcurrentHashMap<String, CountDownLatch>()
  private val activeChunkTransfers = java.util.concurrent.ConcurrentHashMap<String, File>()

  init {
    try {
      ttsEngine = TextToSpeech(context.applicationContext) { status ->
        ttsReady = (status == TextToSpeech.SUCCESS)
        if (ttsReady) {
          try {
            ttsEngine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
              override fun onStart(utteranceId: String?) {}
              override fun onDone(utteranceId: String?) {
                utteranceId?.let { pendingUtterances.remove(it)?.countDown() }
              }
              @Deprecated("Deprecated in Java")
              override fun onError(utteranceId: String?) {
                utteranceId?.let { pendingUtterances.remove(it)?.countDown() }
              }
              override fun onError(utteranceId: String?, errorCode: Int) {
                Log.w(TAG, "TTS utterance error on $utteranceId: $errorCode")
                utteranceId?.let { pendingUtterances.remove(it)?.countDown() }
              }
            })
          } catch (e: Exception) {
            Log.w(TAG, "Error setting TTS utterance listener", e)
          }
        }
        ttsInitLatch.countDown()
      }
    } catch (e: Exception) {
      Log.w(TAG, "System TTS init unavailable, fallback vocal synth active", e)
      ttsInitLatch.countDown()
    }
  }

  fun shutdown() {
    try {
      ttsEngine?.stop()
      ttsEngine?.shutdown()
    } catch (_: Exception) {}
  }

  private fun sendCallbackToJs(callbackId: String, resultJson: JSONObject) {
    val escapedJson = JSONObject.quote(resultJson.toString())
    scope.launch(Dispatchers.Main) {
      webViewProvider()?.evaluateJavascript(
        "window.__onNativeBridgeCallback && window.__onNativeBridgeCallback('$callbackId', JSON.parse($escapedJson));",
        null
      )
    }
  }

  @JavascriptInterface
  fun generateScript(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val idea = req.optString("idea", "octopus").trim().ifEmpty { "octopus" }
        val scriptType = req.optString("scriptType", "Funny Facts")
        val customStyle = req.optString("customStyle", "")
        val language = req.optString("language", "English")
        val lengthSec = req.optInt("lengthSec", 30)
        val charAName = req.optString("charAName", "A").trim().ifEmpty { "A" }
        val charBName = req.optString("charBName", "B").trim().ifEmpty { "B" }
        val prefs = context.getSharedPreferences("toontalk_native_prefs", Context.MODE_PRIVATE)
        val payloadKey = req.optString("apiKey", "").trim()
        if (payloadKey.isNotEmpty()) {
          prefs.edit().putString("custom_gemini_api_key", payloadKey).apply()
        }
        val customApiKey = payloadKey.ifEmpty {
          prefs.getString("custom_gemini_api_key", "")?.trim().orEmpty()
        }

        val targetLineCount = when {
          lengthSec <= 15 -> 4
          lengthSec <= 30 -> 6
          lengthSec <= 45 -> 8
          else -> 10
        }

        val effectiveStyle = if (scriptType.equals("Custom", ignoreCase = true) && customStyle.isNotBlank()) {
          "Custom viral creator style: $customStyle"
        } else {
          scriptType
        }

        val languageInstruction = when (language) {
          "Roman Urdu" -> "Write all dialogue in natural, funny, viral Roman Urdu (Urdu written in Latin alphabet, e.g. 'Bhai stop scrolling! Tu soch bhi nahi sakta...')."
          "Hindi" -> "Write all dialogue in natural conversational Hindi (Devanagari script, e.g. 'अरे भाई रुको! क्या तुम्हें ये वायरल सच पता है...')."
          else -> "Write all dialogue in viral, funny, high-retention English like top YouTube shorts creators."
        }

        val prompt = """
          You are a professional YouTube Shorts and TikTok viral content mastermind (producing 10M+ view retention videos like Ryan Trahan, Beluga, and animated comedy channels).
          Create a high-energy, entertaining short-form video script (${lengthSec}s target, around $targetLineCount lines) between two characters:
          - Speaker "A" ($charAName): Confident, high-energy YouTube creator, drops crazy facts, roasts, or insane stories.
          - Speaker "B" ($charBName): Funny, chaotic, skeptical sidekick with dramatic reactions and hilarious comebacks.

          Topic / Idea: "$idea"
          Script Tone: "$effectiveStyle"
          Language Rule: $languageInstruction

          Viral YouTube Creator Rules (CRITICAL):
          1. Line 1 MUST be an explosive 1.5-second pattern interrupt hook that prevents skipping.
          2. Speakers MUST strictly alternate starting with "A", then "B", then "A", etc.
          3. Keep each line under 16 punchy words with maximum comedic comedic timing and zero fluff.
          4. Include funny character banter, relatable exaggerations, and playful arguments.
          5. The final line MUST be a hilarious punchline or an irresistible comment-bait debate.
        """.trimIndent()

        val linesArray: JSONArray = try {
          if (customApiKey.isNotEmpty()) {
            withTimeout(10_000L) {
              generateScriptWithCustomKey(customApiKey, prompt)
            }
          } else {
            val response = withTimeout(8_000L) {
              scriptModel.generateContent(prompt)
            }
            val rawText = response.text ?: throw IllegalStateException("Model returned empty response.")
            val parsed = JSONObject(rawText)
            parsed.getJSONArray("lines")
          }
        } catch (e: Exception) {
          Log.w(TAG, "Model request timed out or unprovisioned; activating Viral Social Media Creator Engine fallback", e)
          generateViralSocialScript(idea, scriptType, language, lengthSec, charAName, charBName)
        }

        val normalizedLines = JSONArray()
        for (i in 0 until linesArray.length()) {
          val item = linesArray.getJSONObject(i)
          val speaker = if (i % 2 == 0) "A" else "B"
          val rawLine = item.optString("text", "").trim()
          if (rawLine.isNotEmpty()) {
            val words = rawLine.split(Regex("\\s+"))
            val cappedText = if (words.size > 20) words.take(20).joinToString(" ") else rawLine
            normalizedLines.put(
              JSONObject()
                .put("speaker", speaker)
                .put("text", cappedText)
            )
          }
        }

        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", true)
            .put("lines", normalizedLines)
        )
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Log.e(TAG, "Unexpected error in generateScript, using viral fallback", e)
        val idea = JSONObject(payloadJson).optString("idea", "viral video")
        val lines = generateViralSocialScript(idea, "Funny Facts", "English", 30, "A", "B")
        sendCallbackToJs(
          callbackId,
          JSONObject().put("ok", true).put("lines", lines)
        )
      }
    }
  }

  @JavascriptInterface
  fun regenerateLine(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val idea = req.optString("idea", "viral video")
        val scriptType = req.optString("scriptType", "Funny Facts")
        val language = req.optString("language", "English")
        val speaker = req.optString("speaker", "A")
        val currentText = req.optString("currentText", "")
        val prevText = req.optString("prevText", "")
        val nextText = req.optString("nextText", "")
        val isFirst = req.optBoolean("isFirst", false)
        val isLast = req.optBoolean("isLast", false)
        val customApiKey = req.optString("apiKey", "").trim()

        val persona = if (speaker == "A") {
          "Speaker A (the confident, high-energy YouTube creator)"
        } else {
          "Speaker B (the funny, skeptical, dramatic reacting sidekick)"
        }

        val roleHint = when {
          isFirst -> "This is the FIRST line: create an explosive, 1.5s viral hook that stops scrolling!"
          isLast -> "This is the LAST line: create a hilarious punchline or an irresistible comment-bait question!"
          else -> "Make it rapid-fire comedic banter reacting to the previous line."
        }

        val prompt = """
          Rewrite this single dialogue line for a viral YouTube Shorts/TikTok comedy clip about "$idea" in $language.
          Character: $persona
          Previous line: "$prevText"
          Current line to replace: "$currentText"
          Next line: "$nextText"
          Direction: $roleHint
          Strict: Maximum 16 words, funny, punchy, creator tone.
        """.trimIndent()

        val newText = try {
          if (customApiKey.isNotEmpty()) {
            withTimeout(6_000L) {
              regenerateSingleLineWithCustomKey(customApiKey, prompt)
            }
          } else {
            val response = withTimeout(5_000L) {
              singleLineModel.generateContent(prompt)
            }
            val rawText = response.text ?: throw IllegalStateException("Empty response from model.")
            JSONObject(rawText).optString("text", currentText)
          }
        } catch (e: Exception) {
          Log.w(TAG, "Line rewrite model timed out, using viral rewriter", e)
          rewriteViralLineLocally(speaker, idea, isFirst, isLast, currentText, language)
        }

        val words = newText.trim().split(Regex("\\s+"))
        val capped = if (words.size > 20) words.take(20).joinToString(" ") else newText.trim()

        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", true)
            .put("text", capped)
        )
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Log.e(TAG, "Line regeneration failed, using fallback", e)
        sendCallbackToJs(
          callbackId,
          JSONObject().put("ok", true).put("text", "Wait, wait! You literally will not believe what happened next!")
        )
      }
    }
  }

  private fun getDefaultHfToken(): String {
    return runCatching {
      val token = BuildConfig.HUGGINGFACE_API_KEY.trim()
      if (token.isNotEmpty() && token != "YOUR_HUGGINGFACE_API_KEY_HERE" && !token.contains("DEFAULT")) {
        token
      } else {
        ""
      }
    }.getOrDefault("")
  }

  @JavascriptInterface
  fun saveApiKeys(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val prefs = context.getSharedPreferences("toontalk_native_prefs", Context.MODE_PRIVATE).edit()
        if (req.has("geminiApiKey")) {
          prefs.putString("custom_gemini_api_key", req.getString("geminiApiKey").trim())
        }
        if (req.has("hfApiKey")) {
          prefs.putString("hf_api_key", req.getString("hfApiKey").trim())
        }
        if (req.has("elevenLabsApiKey")) {
          prefs.putString("elevenlabs_api_key", req.getString("elevenLabsApiKey").trim())
        }
        if (req.has("openAiApiKey")) {
          prefs.putString("openai_api_key", req.getString("openAiApiKey").trim())
        }
        if (req.has("kokoroApiKey")) {
          prefs.putString("kokoro_api_key", req.getString("kokoroApiKey").trim())
        }
        if (req.has("kokoroApiUrl")) {
          prefs.putString("kokoro_api_url", req.getString("kokoroApiUrl").trim())
        }
        prefs.apply()
        sendCallbackToJs(callbackId, JSONObject().put("ok", true))
      } catch (e: Exception) {
        sendCallbackToJs(callbackId, JSONObject().put("ok", false).put("error", e.localizedMessage ?: "Failed to save keys."))
      }
    }
  }

  @JavascriptInterface
  fun getStoredApiKeys(callbackId: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val prefs = context.getSharedPreferences("toontalk_native_prefs", Context.MODE_PRIVATE)
        val geminiKey = prefs.getString("custom_gemini_api_key", "").orEmpty()
        val hfKey = prefs.getString("hf_api_key", "").orEmpty().ifEmpty { getDefaultHfToken() }
        val elevenLabsKey = prefs.getString("elevenlabs_api_key", "").orEmpty()
        val openAiKey = prefs.getString("openai_api_key", "").orEmpty()
        val kokoroKey = prefs.getString("kokoro_api_key", "").orEmpty().ifEmpty { hfKey }
        val kokoroUrl = prefs.getString("kokoro_api_url", "").orEmpty()
        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", true)
            .put("geminiApiKey", geminiKey)
            .put("hfApiKey", hfKey)
            .put("hasBuildConfigHfKey", getDefaultHfToken().isNotEmpty())
            .put("elevenLabsApiKey", elevenLabsKey)
            .put("openAiApiKey", openAiKey)
            .put("kokoroApiKey", kokoroKey)
            .put("kokoroApiUrl", kokoroUrl)
        )
      } catch (e: Exception) {
        sendCallbackToJs(callbackId, JSONObject().put("ok", false))
      }
    }
  }

  @JavascriptInterface
  fun synthesizeVoice(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val text = req.optString("text", "Hello there!").trim()
        val voiceName = req.optString("voiceName", "af_heart")
        val provider = req.optString("provider", "audio8").lowercase(Locale.ROOT)
        val language = req.optString("language", "English")
        val pitch = req.optDouble("pitch", 1.0).toFloat().coerceIn(0.6f, 1.6f)
        val speed = req.optDouble("speed", 1.0).toFloat().coerceIn(0.7f, 1.5f)

        val prefs = context.getSharedPreferences("toontalk_native_prefs", Context.MODE_PRIVATE)
        val hfKeyPayload = req.optString("hfApiKey", "").trim()
        if (hfKeyPayload.isNotEmpty()) {
          prefs.edit().putString("hf_api_key", hfKeyPayload).apply()
        }
        val elevenLabsKeyPayload = req.optString("elevenLabsApiKey", "").trim()
        if (elevenLabsKeyPayload.isNotEmpty()) {
          prefs.edit().putString("elevenlabs_api_key", elevenLabsKeyPayload).apply()
        }
        val openAiKeyPayload = req.optString("openAiApiKey", "").trim()
        if (openAiKeyPayload.isNotEmpty()) {
          prefs.edit().putString("openai_api_key", openAiKeyPayload).apply()
        }
        val kokoroKeyPayload = req.optString("kokoroApiKey", "").trim()
        if (kokoroKeyPayload.isNotEmpty()) {
          prefs.edit().putString("kokoro_api_key", kokoroKeyPayload).apply()
        }
        val kokoroUrlPayload = req.optString("kokoroApiUrl", "").trim()
        if (kokoroUrlPayload.isNotEmpty()) {
          prefs.edit().putString("kokoro_api_url", kokoroUrlPayload).apply()
        }

        val hfApiKey = hfKeyPayload.ifEmpty {
          prefs.getString("hf_api_key", "")?.trim().orEmpty()
        }.ifEmpty {
          getDefaultHfToken()
        }
        val elevenLabsApiKey = elevenLabsKeyPayload.ifEmpty {
          prefs.getString("elevenlabs_api_key", "")?.trim().orEmpty()
        }
        val openAiApiKey = openAiKeyPayload.ifEmpty {
          prefs.getString("openai_api_key", "")?.trim().orEmpty()
        }
        val kokoroApiKey = kokoroKeyPayload.ifEmpty {
          prefs.getString("kokoro_api_key", "")?.trim().orEmpty()
        }.ifEmpty {
          hfApiKey
        }
        val kokoroApiUrl = kokoroUrlPayload.ifEmpty {
          prefs.getString("kokoro_api_url", "")?.trim().orEmpty()
        }
        val payloadKey = req.optString("apiKey", "").trim()
        val customApiKey = payloadKey.ifEmpty {
          prefs.getString("custom_gemini_api_key", "")?.trim().orEmpty()
        }

        var audioBytes: ByteArray? = null
        var audioMimeType = "audio/wav"
        var providerUsed = "Builtin"

        // Bound remote cloud TTS attempts to max 8.5s total so native synthesis never times out
        kotlinx.coroutines.withTimeoutOrNull(8_500L) {
          // 0A. Edge0/Audio8-TTS-Realistic-0.6b via Hugging Face Inference & Space API
          if (provider == "audio8") {
            val (bytes, mime) = tryAudio8RealisticTts(hfApiKey, text, voiceName, language, speed)
            if (bytes != null && bytes.isNotEmpty()) {
              audioBytes = bytes
              audioMimeType = mime
              providerUsed = "Audio8-TTS-Realistic-0.6b"
            } else if (kokoroApiKey.isNotEmpty() || kokoroApiUrl.isNotEmpty()) {
              val (kBytes, kMime) = tryKokoroTts(kokoroApiKey, kokoroApiUrl, text, voiceName, speed)
              if (kBytes != null && kBytes.isNotEmpty()) {
                audioBytes = kBytes
                audioMimeType = kMime
                providerUsed = "Kokoro-82M"
              }
            }
          }

          // 0B. hexgrad/Kokoro-82M Voice Models
          if (audioBytes == null && provider == "kokoro") {
            val (bytes, mime) = tryKokoroTts(kokoroApiKey, kokoroApiUrl, text, voiceName, speed)
            if (bytes != null && bytes.isNotEmpty()) {
              audioBytes = bytes
              audioMimeType = mime
              providerUsed = "Kokoro-82M"
            }
          }

          // 1. ElevenLabs Ultra-Realistic Voices
          if (audioBytes == null && provider == "elevenlabs" && elevenLabsApiKey.isNotEmpty()) {
            val customVoiceId = req.optString("customVoiceId", "")
            val (bytes, mime) = tryElevenLabsTts(elevenLabsApiKey, text, voiceName, customVoiceId)
            if (bytes != null && bytes.isNotEmpty()) {
              audioBytes = bytes
              audioMimeType = mime
              providerUsed = "ElevenLabs"
            }
          }

          // 2. OpenAI TTS Models
          if (audioBytes == null && provider == "openai" && openAiApiKey.isNotEmpty()) {
            val (bytes, mime) = tryOpenAiTts(openAiApiKey, text, voiceName, speed)
            if (bytes != null && bytes.isNotEmpty()) {
              audioBytes = bytes
              audioMimeType = mime
              providerUsed = "OpenAI"
            }
          }

          // 3. Gemini REST TTS (if custom Gemini API key provided)
          if (audioBytes == null && customApiKey.isNotEmpty()) {
            val geminiBytes = tryGeminiRestTts(customApiKey, text, voiceName)
            if (geminiBytes != null && geminiBytes.isNotEmpty()) {
              audioBytes = geminiBytes
              audioMimeType = "audio/wav"
              providerUsed = "Gemini"
            }
          }
        }

        // 4. Android native TextToSpeech engine
        if ((audioBytes?.size ?: 0) < 512) {
          val nativeBytes = tryAndroidNativeTts(text, voiceName, language, pitch, speed)
          if (nativeBytes != null && nativeBytes.isNotEmpty()) {
            audioBytes = nativeBytes
            audioMimeType = "audio/wav"
            providerUsed = "AndroidTTS"
          }
        }

        // 5. High-fidelity resonant formant vocal synthesizer fallback
        if ((audioBytes?.size ?: 0) < 512) {
          audioBytes = generateExpressiveVocalWav(text, voiceName, pitch, speed)
          audioMimeType = "audio/wav"
          providerUsed = "FormantSynth"
        }

        val base64Audio = Base64.encodeToString(audioBytes, Base64.NO_WRAP)
        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", true)
            .put("audioBase64", base64Audio)
            .put("mimeType", audioMimeType)
            .put("providerUsed", providerUsed)
        )
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Log.e(TAG, "Voice synthesis error", e)
        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", false)
            .put("error", e.localizedMessage ?: "Voice generation failed.")
        )
      }
    }
  }

  private fun persistVideoBytesToGalleryAndDownloads(
    allBytes: ByteArray,
    fileName: String,
    ext: String,
    isAutoSave: Boolean
  ): String {
    val mime = if (ext == "mp4") "video/mp4" else "video/webm"

    // 1. Always save in app exports cache for instant Play Video & Share (zero-permission guaranteed)
    val exportsDir = File(context.cacheDir, "exports").apply { mkdirs() }
    val localFile = File(exportsDir, fileName)
    localFile.writeBytes(allBytes)

    // 2. Also save in app-specific external Movies directory if available
    runCatching {
      context.getExternalFilesDir(Environment.DIRECTORY_MOVIES)?.let { extMovies ->
        extMovies.mkdirs()
        File(extMovies, fileName).writeBytes(allBytes)
      }
    }

    var savedLocationLabel = "Movies/AniShorts/$fileName"
    val resolver = context.contentResolver

    // 3. Save into public Android Gallery (Movies/AniShorts)
    runCatching {
      val contentValues = ContentValues().apply {
        put(MediaStore.Video.Media.DISPLAY_NAME, fileName)
        put(MediaStore.Video.Media.MIME_TYPE, mime)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/AniShorts")
          put(MediaStore.Video.Media.IS_PENDING, 1)
        }
      }
      val videoUri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, contentValues)
      if (videoUri != null) {
        resolver.openOutputStream(videoUri)?.use { out ->
          out.write(allBytes)
          out.flush()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val updateValues = ContentValues().apply {
            put(MediaStore.Video.Media.IS_PENDING, 0)
          }
          resolver.update(videoUri, updateValues, null, null)
        }
      }
    }.onFailure { e ->
      Log.w(TAG, "Public MediaStore.Video insert fallback: ${e.message}")
    }

    // 4. When user explicitly taps Save/Download, also save to public Downloads/AniShorts on Android 10+
    if (!isAutoSave && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      runCatching {
        val dlValues = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, fileName)
          put(MediaStore.Downloads.MIME_TYPE, mime)
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/AniShorts")
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val dlUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, dlValues)
        if (dlUri != null) {
          resolver.openOutputStream(dlUri)?.use { out ->
            out.write(allBytes)
            out.flush()
          }
          val updateValues = ContentValues().apply {
            put(MediaStore.Downloads.IS_PENDING, 0)
          }
          resolver.update(dlUri, updateValues, null, null)
          savedLocationLabel = "Movies/AniShorts & Downloads/AniShorts/$fileName"
        }
      }
    }

    // 5. Scan file into MediaStore so Gallery refreshes immediately
    runCatching {
      android.media.MediaScannerConnection.scanFile(
        context,
        arrayOf(localFile.absolutePath),
        arrayOf(mime),
        null
      )
    }

    if (!isAutoSave) {
      scope.launch(Dispatchers.Main) {
        runCatching {
          android.widget.Toast.makeText(
            context,
            "✅ Saved to Gallery: $savedLocationLabel",
            android.widget.Toast.LENGTH_LONG
          ).show()
        }
      }
    }

    return savedLocationLabel
  }

  @JavascriptInterface
  fun saveVideoChunk(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val transferId = req.optString("transferId", "chunk_stream")
        val chunkIndex = req.getInt("chunkIndex")
        val totalChunks = req.getInt("totalChunks")
        val chunkBase64 = req.getString("chunkBase64")
        val mimeType = req.optString("mimeType", "video/mp4")
        val isAutoSave = req.optBoolean("isAutoSave", false)
        val ext = if (mimeType.contains("mp4", ignoreCase = true)) "mp4" else "webm"

        val tempFile = activeChunkTransfers.getOrPut(transferId) {
          File(context.cacheDir, "transfer_${System.currentTimeMillis()}_$transferId.part")
        }

        val chunkBytes = Base64.decode(chunkBase64, Base64.DEFAULT)
        tempFile.appendBytes(chunkBytes)

        if (chunkIndex == totalChunks - 1) {
          activeChunkTransfers.remove(transferId)
          val fileName = "AniShorts_${System.currentTimeMillis()}.$ext"
          val allBytes = tempFile.readBytes()
          tempFile.delete()

          val savedPath = persistVideoBytesToGalleryAndDownloads(allBytes, fileName, ext, isAutoSave)

          sendCallbackToJs(
            callbackId,
            JSONObject()
              .put("ok", true)
              .put("fileName", fileName)
              .put("savedPath", savedPath)
          )
        } else {
          sendCallbackToJs(
            callbackId,
            JSONObject()
              .put("ok", true)
              .put("progress", chunkIndex + 1)
              .put("total", totalChunks)
          )
        }
      } catch (e: Exception) {
        Log.e(TAG, "Chunk saving error", e)
        sendCallbackToJs(
          callbackId,
          JSONObject().put("ok", false).put("error", e.localizedMessage ?: "Failed to save video chunk.")
        )
      }
    }
  }

  @JavascriptInterface
  fun openSavedVideo(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.Main) {
      try {
        val req = JSONObject(payloadJson)
        val fileName = req.optString("fileName", "")
        val exportsDir = File(context.cacheDir, "exports")
        val targetFile = if (fileName.isNotEmpty()) {
          File(exportsDir, fileName)
        } else {
          exportsDir.listFiles()?.filter { it.extension in listOf("mp4", "webm") }?.maxByOrNull { it.lastModified() }
        }

        if (targetFile != null && targetFile.exists()) {
          val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", targetFile)
          val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, if (targetFile.extension == "mp4") "video/mp4" else "video/webm")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(intent)
          sendCallbackToJs(callbackId, JSONObject().put("ok", true))
        } else {
          sendCallbackToJs(callbackId, JSONObject().put("ok", false).put("error", "Video file not found in exports."))
        }
      } catch (e: Exception) {
        Log.e(TAG, "Failed to open video in player", e)
        sendCallbackToJs(callbackId, JSONObject().put("ok", false).put("error", e.localizedMessage ?: "Cannot open video."))
      }
    }
  }

  @JavascriptInterface
  fun saveVideoToGallery(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val base64Data = req.getString("base64Data")
        val mimeType = req.optString("mimeType", "video/mp4")
        val isAutoSave = req.optBoolean("isAutoSave", false)
        val ext = if (mimeType.contains("mp4", ignoreCase = true)) "mp4" else "webm"
        val fileName = "AniShorts_${System.currentTimeMillis()}.$ext"
        val bytes = Base64.decode(base64Data, Base64.DEFAULT)

        val savedPath = persistVideoBytesToGalleryAndDownloads(bytes, fileName, ext, isAutoSave)

        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", true)
            .put("fileName", fileName)
            .put("savedPath", savedPath)
        )
      } catch (e: Exception) {
        Log.e(TAG, "Failed to save video to Gallery", e)
        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", false)
            .put("error", e.localizedMessage ?: "Could not save video to Gallery.")
        )
      }
    }
  }

  @JavascriptInterface
  fun shareVideo(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val base64Data = req.getString("base64Data")
        val mimeType = req.optString("mimeType", "video/mp4")
        val ext = if (mimeType.contains("mp4", ignoreCase = true)) "mp4" else "webm"
        val fileName = "AniShorts_Share_${System.currentTimeMillis()}.$ext"
        val bytes = Base64.decode(base64Data, Base64.DEFAULT)

        val exportsDir = File(context.cacheDir, "exports").apply { mkdirs() }
        val shareFile = File(exportsDir, fileName)
        shareFile.writeBytes(bytes)

        val contentUri = FileProvider.getUriForFile(
          context,
          "${context.packageName}.fileprovider",
          shareFile
        )

        withContext(Dispatchers.Main) {
          val shareIntent = Intent(Intent.ACTION_SEND).apply {
            type = if (ext == "mp4") "video/mp4" else "video/webm"
            putExtra(Intent.EXTRA_STREAM, contentUri)
            putExtra(Intent.EXTRA_TEXT, "Made with ANI SHORTS 🎬✨")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
          val chooser = Intent.createChooser(shareIntent, "Share 9:16 Video").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(chooser)
        }

        sendCallbackToJs(callbackId, JSONObject().put("ok", true))
      } catch (e: Exception) {
        Log.e(TAG, "Failed to share video", e)
        sendCallbackToJs(
          callbackId,
          JSONObject().put("ok", false).put("error", e.localizedMessage ?: "Share failed.")
        )
      }
    }
  }

  private fun generateScriptWithCustomKey(apiKey: String, prompt: String): JSONArray {
    val bodyJson = JSONObject().apply {
      put(
        "contents",
        JSONArray().put(
          JSONObject().put("parts", JSONArray().put(JSONObject().put("text", prompt)))
        )
      )
      put(
        "generationConfig",
        JSONObject().apply {
          put("responseMimeType", "application/json")
          put(
            "responseSchema",
            JSONObject().apply {
              put("type", "OBJECT")
              put(
                "properties",
                JSONObject().put(
                  "lines",
                  JSONObject().apply {
                    put("type", "ARRAY")
                    put(
                      "items",
                      JSONObject().apply {
                        put("type", "OBJECT")
                        put(
                          "properties",
                          JSONObject()
                            .put("speaker", JSONObject().put("type", "STRING"))
                            .put("text", JSONObject().put("type", "STRING"))
                        )
                        put("required", JSONArray().put("speaker").put("text"))
                      }
                    )
                  }
                )
              )
              put("required", JSONArray().put("lines"))
            }
          )
        }
      )
    }

    val url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$apiKey"
    val request = Request.Builder()
      .url(url)
      .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
      .build()

    okHttpClient.newCall(request).execute().use { response ->
      val respBody = response.body?.string().orEmpty()
      if (!response.isSuccessful) {
        throw IllegalStateException("Gemini API error (${response.code}): $respBody")
      }
      val root = JSONObject(respBody)
      val text = root.getJSONArray("candidates")
        .getJSONObject(0)
        .getJSONObject("content")
        .getJSONArray("parts")
        .getJSONObject(0)
        .getString("text")
      return JSONObject(text).getJSONArray("lines")
    }
  }

  private fun regenerateSingleLineWithCustomKey(apiKey: String, prompt: String): String {
    val bodyJson = JSONObject().apply {
      put(
        "contents",
        JSONArray().put(
          JSONObject().put("parts", JSONArray().put(JSONObject().put("text", prompt)))
        )
      )
      put(
        "generationConfig",
        JSONObject().apply {
          put("responseMimeType", "application/json")
        }
      )
    }

    val url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$apiKey"
    val request = Request.Builder()
      .url(url)
      .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
      .build()

    okHttpClient.newCall(request).execute().use { response ->
      val respBody = response.body?.string().orEmpty()
      if (!response.isSuccessful) {
        throw IllegalStateException("Gemini API error (${response.code})")
      }
      val root = JSONObject(respBody)
      val text = root.getJSONArray("candidates")
        .getJSONObject(0)
        .getJSONObject("content")
        .getJSONArray("parts")
        .getJSONObject(0)
        .getString("text")
      return runCatching { JSONObject(text).optString("text", text) }.getOrDefault(text)
    }
  }

  private fun tryGeminiRestTts(apiKey: String, text: String, voiceName: String): ByteArray? {
    val modelsToTry = listOf("gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview")
    for (model in modelsToTry) {
      try {
        val bodyJson = JSONObject().apply {
          put(
            "contents",
            JSONArray().put(
              JSONObject().put(
                "parts",
                JSONArray().put(JSONObject().put("text", text))
              )
            )
          )
          put(
            "generationConfig",
            JSONObject().apply {
              put("responseModalities", JSONArray().put("AUDIO"))
              put(
                "speechConfig",
                JSONObject().put(
                  "voiceConfig",
                  JSONObject().put(
                    "prebuiltVoiceConfig",
                    JSONObject().put("voiceName", voiceName)
                  )
                )
              )
            }
          )
        }

        val url = "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$apiKey"
        val request = Request.Builder()
          .url(url)
          .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
          .build()

        okHttpClient.newCall(request).execute().use { response ->
          if (response.isSuccessful) {
            val respStr = response.body?.string().orEmpty()
            val root = JSONObject(respStr)
            val inlineData = root.getJSONArray("candidates")
              .getJSONObject(0)
              .getJSONObject("content")
              .getJSONArray("parts")
              .getJSONObject(0)
              .getJSONObject("inlineData")
            val b64 = inlineData.getString("data")
            val mime = inlineData.optString("mimeType", "audio/pcm")
            val rawBytes = Base64.decode(b64, Base64.DEFAULT)
            return if (mime.contains("wav", ignoreCase = true)) {
              rawBytes
            } else {
              wrapPcm24kMonoInWav(rawBytes, 24000)
            }
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "Gemini REST TTS ($model) attempt failed, falling back", e)
      }
    }
    return null
  }

  private fun tryElevenLabsTts(
    apiKey: String,
    text: String,
    voiceName: String,
    customVoiceId: String = ""
  ): Pair<ByteArray?, String> {
    try {
      val voiceIdMap = mapOf(
        "Adam" to "pNInz6obpgDQGcFmaJgB",
        "Rachel" to "21m00Tcm4TlvDq8ikWAM",
        "Antoni" to "ErXwobaYiN019PkySvjV",
        "Josh" to "TxGEqnHWrfWFTfGW9XjX",
        "Bella" to "EXAVITQu4vr4xnSDxMaL",
        "Arnold" to "VR6AewLTigWG4xSOukaG",
        "Sam" to "yoZ06aMxZJJ28mfd3POQ",
        "Elli" to "MF3mGyEYCl7XYWbV9V6O",
        "Domi" to "AZnzlk1XvdvUeBnXmlld",
        "Charlie" to "IKne3meq5aSn9X80BHx2",
        "George" to "JBFqnCBsd6RMkjVDRZzb",
        "Liam" to "TX3LPaxmHKxFdv7VOQHJ",
        "Charlotte" to "XB0fDUnXU5powFXDhCwa",
        "Alice" to "Xb7hH8MSUJpSbSDYk0k2",
        "Matilda" to "XrExE9yKIg1WjnnlVkGX",
        "Will" to "bIHbv24MWmeRgasZH58o",
        "Jessica" to "cgSgspJ2msm6clMCkdW9",
        "Eric" to "cjVigY5qzO86Huf0OWal",
        "Chris" to "iP95p4xoKVk53GoZ742B",
        "Brian" to "nPczCjzI2devNBz1zQrb",
        "Daniel" to "onwK4e9ZLuTAKqWW03F9",
        "Lily" to "pFZP5JQG7iQjIQuC4Bku",
        "Bill" to "pqHfZKP75CvOlQylNhV4"
      )

      val resolvedVoiceId = when {
        customVoiceId.trim().isNotEmpty() -> customVoiceId.trim()
        voiceIdMap.containsKey(voiceName) -> voiceIdMap[voiceName]!!
        voiceName.length >= 15 && !voiceName.contains(" ") -> voiceName
        else -> "pNInz6obpgDQGcFmaJgB"
      }

      val bodyJson = JSONObject().apply {
        put("text", text)
        put("model_id", "eleven_multilingual_v2")
        put(
          "voice_settings",
          JSONObject().apply {
            put("stability", 0.5)
            put("similarity_boost", 0.75)
          }
        )
      }

      val url = "https://api.elevenlabs.io/v1/text-to-speech/$resolvedVoiceId"
      val request = Request.Builder()
        .url(url)
        .addHeader("xi-api-key", apiKey)
        .addHeader("Accept", "audio/mpeg")
        .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
        .build()

      okHttpClient.newCall(request).execute().use { response ->
        if (response.isSuccessful) {
          val bytes = response.body?.bytes()
          if (bytes != null && bytes.isNotEmpty()) {
            return Pair(bytes, "audio/mpeg")
          }
        } else {
          val err = response.body?.string().orEmpty()
          Log.w(TAG, "ElevenLabs TTS error (${response.code}): $err")
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "ElevenLabs TTS request failed, falling back", e)
    }
    return Pair(null, "audio/wav")
  }

  private fun tryOpenAiTts(
    apiKey: String,
    text: String,
    voiceName: String,
    speed: Float
  ): Pair<ByteArray?, String> {
    try {
      val validVoices = setOf("alloy", "echo", "fable", "onyx", "nova", "shimmer")
      val selectedVoice = voiceName.lowercase(Locale.ROOT).trim()
      val voice = if (validVoices.contains(selectedVoice)) selectedVoice else "alloy"

      val bodyJson = JSONObject().apply {
        put("model", "tts-1")
        put("input", text)
        put("voice", voice)
        put("speed", speed.coerceIn(0.25f, 4.0f).toDouble())
        put("response_format", "mp3")
      }

      val url = "https://api.openai.com/v1/audio/speech"
      val request = Request.Builder()
        .url(url)
        .addHeader("Authorization", "Bearer $apiKey")
        .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
        .build()

      okHttpClient.newCall(request).execute().use { response ->
        if (response.isSuccessful) {
          val bytes = response.body?.bytes()
          if (bytes != null && bytes.isNotEmpty()) {
            return Pair(bytes, "audio/mpeg")
          }
        } else {
          val err = response.body?.string().orEmpty()
          Log.w(TAG, "OpenAI TTS error (${response.code}): $err")
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "OpenAI TTS request failed, falling back", e)
    }
    return Pair(null, "audio/wav")
  }

  private fun tryAudio8RealisticTts(
    hfApiKey: String,
    text: String,
    voiceName: String,
    language: String,
    speed: Float
  ): Pair<ByteArray?, String> {
    val cleanVoice = if (voiceName.contains("_")) voiceName.trim() else "af_heart"

    // 1. Try Hugging Face Inference Router & API for Edge0/Audio8-TTS-Realistic-0.6b
    if (hfApiKey.isNotEmpty()) {
      val hfModelEndpoints = listOf(
        "https://router.huggingface.co/hf-inference/models/Edge0/Audio8-TTS-Realistic-0.6b",
        "https://api-inference.huggingface.co/models/Edge0/Audio8-TTS-Realistic-0.6b"
      )
      for (hfUrl in hfModelEndpoints) {
        try {
          val hfBody = JSONObject().apply {
            put("inputs", text)
            put("parameters", JSONObject().apply {
              put("voice", cleanVoice)
              put("language", language)
              put("speed", speed.coerceIn(0.5f, 2.0f).toDouble())
            })
          }
          val request = Request.Builder()
            .url(hfUrl)
            .addHeader("Authorization", "Bearer $hfApiKey")
            .post(hfBody.toString().toRequestBody("application/json".toMediaType()))
            .build()

          ttsHttpClient.newCall(request).execute().use { response ->
            if (response.isSuccessful) {
              val contentType = response.header("Content-Type", "audio/wav") ?: "audio/wav"
              val bytes = response.body?.bytes()
              if (bytes != null && bytes.size > 256 && !contentType.contains("application/json")) {
                return Pair(
                  bytes,
                  when {
                    contentType.contains("mpeg") || contentType.contains("mp3") -> "audio/mpeg"
                    contentType.contains("flac") -> "audio/flac"
                    else -> "audio/wav"
                  }
                )
              }
            }
          }
        } catch (e: Exception) {
          Log.w(TAG, "HF Inference Edge0/Audio8-TTS-Realistic-0.6b ($hfUrl) attempt failed", e)
        }
      }
    }

    // 2. Try Edge0/Audio8-TTS-Realistic-0.6b Official Hugging Face Space Gradio API
    try {
      val spaceBase = "https://edge0-audio8-tts-realistic-0-6b.hf.space"
      val callPayload = JSONObject().apply {
        put("data", org.json.JSONArray().apply {
          put(text)
          put(JSONObject.NULL)
          put("")
          put(1024)
          put(0.8)
          put(0.8)
          put(1.1)
        })
      }
      val callReqBuilder = Request.Builder()
        .url("$spaceBase/gradio_api/call/generate")
        .post(callPayload.toString().toRequestBody("application/json".toMediaType()))
      if (hfApiKey.isNotEmpty()) {
        callReqBuilder.addHeader("Authorization", "Bearer $hfApiKey")
      }

      var eventId: String? = null
      ttsHttpClient.newCall(callReqBuilder.build()).execute().use { resp ->
        if (resp.isSuccessful) {
          val bodyStr = resp.body?.string().orEmpty()
          if (bodyStr.isNotEmpty()) {
            eventId = JSONObject(bodyStr).optString("event_id").takeIf { it.isNotEmpty() }
          }
        }
      }

      if (!eventId.isNullOrEmpty()) {
        val streamReqBuilder = Request.Builder()
          .url("$spaceBase/gradio_api/call/generate/$eventId")
          .get()
        if (hfApiKey.isNotEmpty()) {
          streamReqBuilder.addHeader("Authorization", "Bearer $hfApiKey")
        }

        var audioFileUrl: String? = null
        ttsHttpClient.newCall(streamReqBuilder.build()).execute().use { streamResp ->
          if (streamResp.isSuccessful) {
            val sseText = streamResp.body?.string().orEmpty()
            val lines = sseText.lines()
            for (line in lines) {
              if (line.startsWith("data:")) {
                val dataJson = line.removePrefix("data:").trim()
                if (dataJson.startsWith("[")) {
                  val arr = org.json.JSONArray(dataJson)
                  val firstObj = arr.optJSONObject(0)
                  if (firstObj != null) {
                    val directUrl = firstObj.optString("url")
                    val path = firstObj.optString("path")
                    audioFileUrl = when {
                      directUrl.startsWith("http") -> directUrl
                      path.isNotEmpty() -> "$spaceBase/gradio_api/file=$path"
                      else -> null
                    }
                  }
                }
              }
            }
          }
        }

        if (!audioFileUrl.isNullOrEmpty()) {
          val dlBuilder = Request.Builder().url(audioFileUrl!!).get()
          if (hfApiKey.isNotEmpty()) {
            dlBuilder.addHeader("Authorization", "Bearer $hfApiKey")
          }
          ttsHttpClient.newCall(dlBuilder.build()).execute().use { audioResp ->
            if (audioResp.isSuccessful) {
              val bytes = audioResp.body?.bytes()
              if (bytes != null && bytes.size > 256) {
                val ct = audioResp.header("Content-Type", "audio/wav") ?: "audio/wav"
                return Pair(bytes, if (ct.contains("mpeg") || ct.contains("mp3")) "audio/mpeg" else "audio/wav")
              }
            }
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Audio8 Gradio Space call failed, falling back to HF Kokoro/Neural engine", e)
    }

    // 3. Fallback to Hugging Face Kokoro-82M with the same HF token if Audio8 Space is sleeping
    if (hfApiKey.isNotEmpty()) {
      val (kokoroBytes, kokoroMime) = tryKokoroTts(hfApiKey, "", text, cleanVoice, speed)
      if (kokoroBytes != null && kokoroBytes.isNotEmpty()) {
        return Pair(kokoroBytes, kokoroMime)
      }
    }

    return Pair(null, "audio/wav")
  }

  private fun tryKokoroTts(
    apiKey: String,
    apiUrl: String,
    text: String,
    voiceName: String,
    speed: Float
  ): Pair<ByteArray?, String> {
    val cleanVoice = if (voiceName.contains("_")) voiceName.trim() else "af_heart"

    // 1. Custom Kokoro-FastAPI or OpenAI-compatible Kokoro Server (e.g. http://localhost:8880)
    if (apiUrl.isNotEmpty()) {
      try {
        val baseUrl = apiUrl.trimEnd('/')
        val endpoint = if (baseUrl.endsWith("/audio/speech")) baseUrl else "$baseUrl/v1/audio/speech"
        val bodyJson = JSONObject().apply {
          put("model", "kokoro")
          put("input", text)
          put("voice", cleanVoice)
          put("speed", speed.coerceIn(0.5f, 2.0f).toDouble())
          put("response_format", "mp3")
        }
        val reqBuilder = Request.Builder()
          .url(endpoint)
          .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
        if (apiKey.isNotEmpty()) {
          reqBuilder.addHeader("Authorization", "Bearer $apiKey")
        }
        ttsHttpClient.newCall(reqBuilder.build()).execute().use { response ->
          if (response.isSuccessful) {
            val bytes = response.body?.bytes()
            if (bytes != null && bytes.size > 256) {
              val contentType = response.header("Content-Type", "audio/mpeg") ?: "audio/mpeg"
              return Pair(bytes, if (contentType.contains("wav")) "audio/wav" else "audio/mpeg")
            }
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "Kokoro-FastAPI custom endpoint attempt failed, trying next", e)
      }
    }

    // 2. DeepInfra & HuggingFace Inference API for hexgrad/Kokoro-82M
    if (apiKey.isNotEmpty()) {
      // Try DeepInfra OpenAI-compatible Kokoro-82M endpoint first
      try {
        val bodyJson = JSONObject().apply {
          put("model", "hexgrad/Kokoro-82M")
          put("input", text)
          put("voice", cleanVoice)
          put("speed", speed.coerceIn(0.5f, 2.0f).toDouble())
          put("response_format", "mp3")
        }
        val req = Request.Builder()
          .url("https://api.deepinfra.com/v1/openai/audio/speech")
          .addHeader("Authorization", "Bearer $apiKey")
          .post(bodyJson.toString().toRequestBody("application/json".toMediaType()))
          .build()
        ttsHttpClient.newCall(req).execute().use { response ->
          if (response.isSuccessful) {
            val bytes = response.body?.bytes()
            if (bytes != null && bytes.size > 256) {
              return Pair(bytes, "audio/mpeg")
            }
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "DeepInfra Kokoro-82M attempt failed, trying HF Inference API", e)
      }

      // Try HuggingFace Inference API for hexgrad/Kokoro-82M
      try {
        val hfBody = JSONObject().apply {
          put("inputs", text)
          put("parameters", JSONObject().put("voice", cleanVoice))
        }
        val req = Request.Builder()
          .url("https://api-inference.huggingface.co/models/hexgrad/Kokoro-82M")
          .addHeader("Authorization", "Bearer $apiKey")
          .post(hfBody.toString().toRequestBody("application/json".toMediaType()))
          .build()
        ttsHttpClient.newCall(req).execute().use { response ->
          if (response.isSuccessful) {
            val bytes = response.body?.bytes()
            if (bytes != null && bytes.size > 256) {
              val cType = response.header("Content-Type", "audio/flac") ?: "audio/flac"
              return Pair(bytes, cType)
            }
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "HuggingFace Kokoro-82M attempt failed", e)
      }
    }

    return Pair(null, "audio/wav")
  }

  private fun tryAndroidNativeTts(
    text: String,
    voiceName: String,
    language: String,
    userPitch: Float,
    userSpeed: Float
  ): ByteArray? {
    try {
      ttsInitLatch.await(3, TimeUnit.SECONDS)
      val engine = ttsEngine ?: return null
      if (!ttsReady) return null

      val isFemale = voiceName.startsWith("af_") || voiceName.startsWith("bf_") || voiceName.startsWith("hf_") ||
        voiceName in setOf(
          "Emma", "Chloe", "Maya", "Lily", "Priya", "Sophia", "Mia", "Ananya", "Ayesha", "Kore", "Aoede", "Zephyr", "Leda"
        )

      val targetLocale = when {
        voiceName.startsWith("bf_") || voiceName.startsWith("bm_") || voiceName in setOf("Oliver", "Lily", "Arthur", "Liam") -> Locale.UK
        voiceName == "Mia" -> Locale("en", "AU")
        voiceName.startsWith("hf_") || voiceName.startsWith("hm_") || language == "Hindi" || voiceName in setOf("Arjun", "Priya", "Kabir", "Ananya") -> Locale("hi", "IN")
        language == "Roman Urdu" || voiceName in setOf("Zayd", "Ayesha") -> Locale("ur", "PK")
        else -> Locale.US
      }

      val (basePitch, baseRate) = when (voiceName) {
        // hexgrad/Kokoro-82M voices
        "af_heart" -> Pair(1.12f, 1.04f)
        "af_bella" -> Pair(1.16f, 1.06f)
        "af_nicole" -> Pair(1.06f, 0.96f)
        "af_sarah" -> Pair(1.10f, 1.04f)
        "af_sky" -> Pair(1.22f, 1.12f)
        "af_aoede" -> Pair(1.14f, 1.04f)
        "af_kore" -> Pair(1.24f, 1.10f)
        "af_nova" -> Pair(1.18f, 1.10f)
        "af_jessica" -> Pair(1.15f, 1.06f)
        "af_river" -> Pair(1.08f, 1.00f)
        "am_adam" -> Pair(0.84f, 0.98f)
        "am_michael" -> Pair(0.96f, 1.04f)
        "am_fenrir" -> Pair(0.88f, 1.16f)
        "am_puck" -> Pair(1.05f, 1.12f)
        "am_echo" -> Pair(0.94f, 1.02f)
        "am_eric" -> Pair(0.98f, 1.04f)
        "am_liam" -> Pair(1.02f, 1.08f)
        "am_onyx" -> Pair(0.78f, 0.95f)
        "bf_emma" -> Pair(1.12f, 1.02f)
        "bf_isabella" -> Pair(1.16f, 1.04f)
        "bf_alice" -> Pair(1.10f, 1.02f)
        "bf_lily" -> Pair(1.14f, 1.05f)
        "bm_george" -> Pair(0.90f, 0.98f)
        "bm_lewis" -> Pair(0.96f, 1.04f)
        "bm_daniel" -> Pair(0.86f, 0.96f)
        "bm_fable" -> Pair(0.94f, 1.02f)
        "hf_alpha" -> Pair(1.14f, 1.04f)
        "hf_beta" -> Pair(1.18f, 1.06f)
        "hm_omega" -> Pair(0.92f, 1.02f)
        "hm_psi" -> Pair(0.98f, 1.05f)
        // Built-in Studio voices
        "Marcus" -> Pair(0.74f, 0.94f)
        "Arthur" -> Pair(0.76f, 0.95f)
        "Charon" -> Pair(0.78f, 0.98f)
        "Kabir" -> Pair(0.80f, 0.96f)
        "Jack" -> Pair(0.82f, 1.04f)
        "Orpheus" -> Pair(0.86f, 1.02f)
        "Fenrir" -> Pair(0.88f, 1.20f)
        "Sam" -> Pair(0.92f, 1.00f)
        "Oliver" -> Pair(0.96f, 1.00f)
        "Ethan" -> Pair(0.98f, 1.05f)
        "Alex" -> Pair(1.00f, 1.05f)
        "Arjun" -> Pair(1.02f, 1.06f)
        "Liam" -> Pair(1.04f, 1.10f)
        "Zayd" -> Pair(1.02f, 1.04f)
        "Leo" -> Pair(1.06f, 1.20f)
        "Puck" -> Pair(1.06f, 1.12f)
        "Leda" -> Pair(1.02f, 0.96f)
        "Sophia" -> Pair(1.08f, 1.02f)
        "Lily" -> Pair(1.10f, 1.02f)
        "Emma" -> Pair(1.14f, 1.05f)
        "Aoede" -> Pair(1.14f, 1.04f)
        "Priya" -> Pair(1.14f, 1.04f)
        "Mia" -> Pair(1.16f, 1.08f)
        "Ananya" -> Pair(1.18f, 1.06f)
        "Ayesha" -> Pair(1.16f, 1.05f)
        "Kore" -> Pair(1.24f, 1.10f)
        "Chloe" -> Pair(1.26f, 1.16f)
        "Maya" -> Pair(1.30f, 1.12f)
        "Zephyr" -> Pair(1.36f, 1.16f)
        else -> Pair(1.00f, 1.05f)
      }

      val effectivePitch = (basePitch * userPitch).coerceIn(0.5f, 2.0f)
      val effectiveRate = (baseRate * userSpeed).coerceIn(0.5f, 2.5f)

      val utteranceId = UUID.randomUUID().toString()
      val outFile = File(context.cacheDir, "tts_$utteranceId.wav")
      val doneLatch = CountDownLatch(1)
      pendingUtterances[utteranceId] = doneLatch

      synchronized(engine) {
        engine.language = targetLocale
        val availableVoices = runCatching { engine.voices }.getOrNull().orEmpty()
        val matchingVoices = availableVoices.filter { v ->
          !v.isNetworkConnectionRequired &&
            !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) &&
            v.locale.language.equals(targetLocale.language, ignoreCase = true)
        }
        val genderFiltered = matchingVoices.filter { v ->
          val n = v.name.lowercase()
          if (isFemale) {
            n.contains("female") || n.contains("fem") || n.contains("iom") || n.contains("iol") || n.contains("cfa") || n.contains("hie")
          } else {
            n.contains("male") || n.contains("man") || n.contains("iob") || n.contains("tpf") || n.contains("cfl") || n.contains("cfh")
          }
        }
        val chosenVoice = genderFiltered.maxByOrNull { it.quality } ?: matchingVoices.maxByOrNull { it.quality }
        if (chosenVoice != null) {
          engine.voice = chosenVoice
        }

        engine.setPitch(effectivePitch)
        engine.setSpeechRate(effectiveRate)
        engine.synthesizeToFile(text, null, outFile, utteranceId)
      }

      doneLatch.await(10, TimeUnit.SECONDS)
      pendingUtterances.remove(utteranceId)

      if (outFile.exists() && outFile.length() > 512) {
        val bytes = outFile.readBytes()
        outFile.delete()
        return bytes
      }
      outFile.delete()
    } catch (e: Exception) {
      Log.w(TAG, "Android native TTS synthesis error, using resonant vocal synth", e)
    }
    return null
  }

  /**
   * High-fidelity multi-formant resonant acoustic model with asymmetric glottal excitation,
   * natural pitch inflection, micro-vibrato, and consonant plosives.
   */
  private fun generateExpressiveVocalWav(
    text: String,
    voiceName: String,
    userPitch: Float = 1.0f,
    userSpeed: Float = 1.0f
  ): ByteArray {
    val sampleRate = 24000
    val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val wordCount = words.size.coerceAtLeast(1)

    val baseFreq = when (voiceName) {
      "am_onyx", "Marcus" -> 105.0
      "bm_daniel", "Arthur" -> 108.0
      "am_adam", "Charon" -> 115.0
      "hm_omega", "Kabir" -> 118.0
      "bm_george", "Jack" -> 122.0
      "Orpheus" -> 124.0
      "bm_fable", "Oliver" -> 128.0
      "am_echo", "Sam" -> 132.0
      "am_fenrir", "Fenrir" -> 135.0
      "am_michael", "Ethan" -> 140.0
      "am_eric", "Alex" -> 146.0
      "hm_psi", "Arjun" -> 150.0
      "am_liam", "bm_lewis", "Liam" -> 155.0
      "Zayd" -> 152.0
      "Leo" -> 162.0
      "am_puck", "Puck" -> 168.0
      "af_nicole", "Leda" -> 195.0
      "af_river", "Sophia" -> 202.0
      "bf_alice", "bf_lily", "Lily" -> 208.0
      "af_aoede", "Aoede" -> 215.0
      "af_heart", "bf_emma", "Emma" -> 222.0
      "af_sarah", "Maya" -> 228.0
      "hf_alpha", "Priya" -> 232.0
      "af_bella", "bf_isabella", "hf_beta", "Ananya" -> 238.0
      "af_jessica", "Ayesha" -> 240.0
      "af_nova", "Mia" -> 242.0
      "af_kore", "Kore" -> 248.0
      "af_sky", "Chloe" -> 258.0
      "Zephyr" -> 272.0
      else -> 175.0
    } * userPitch.toDouble()

    // Real vowel formant center frequencies (F1, F2, F3) for /a/, /e/, /i/, /o/, /u/
    val formants = listOf(
      Triple(730.0, 1090.0, 2440.0), // /a/
      Triple(530.0, 1840.0, 2480.0), // /e/
      Triple(270.0, 2290.0, 3010.0), // /i/
      Triple(570.0, 840.0, 2410.0),  // /o/
      Triple(300.0, 870.0, 2240.0)   // /u/
    )

    val secondsPerWord = (0.28 / userSpeed.toDouble()).coerceIn(0.18, 0.45)
    val totalDurationSec = (wordCount * secondsPerWord + 0.25).coerceIn(1.0, 12.0)
    val totalSamples = (totalDurationSec * sampleRate).toInt()
    val pcmBytes = ByteArray(totalSamples * 2)
    val buffer = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN)

    var phase = 0.0

    for (i in 0 until totalSamples) {
      val t = i.toDouble() / sampleRate
      val wordPos = t / secondsPerWord
      val wordIndex = wordPos.toInt()
      val fracInWord = wordPos - wordIndex

      if (wordIndex >= wordCount) {
        buffer.putShort(0)
        continue
      }

      // Smooth syllabic envelope with gentle attack and decay
      val syllableEnv = sin(min(1.0, fracInWord * 1.12) * PI).coerceAtLeast(0.0)

      // Sentence declination: voice naturally falls slightly over the course of a sentence
      val sentenceProgress = (t / totalDurationSec).coerceIn(0.0, 1.0)
      val declination = 1.04 - 0.08 * sentenceProgress

      // Micro-vibrato (5.3 Hz) + expressive word emphasis
      val wordHash = if (wordIndex < words.size) words[wordIndex].hashCode() else 0
      val vibrato = 1.0 + 0.018 * sin(2.0 * PI * 5.3 * t)
      val emphasis = 1.0 + 0.10 * sin(wordIndex * 1.6 + (wordHash % 7) * 0.25)
      val currentF0 = baseFreq * declination * vibrato * emphasis

      phase += 2.0 * PI * currentF0 / sampleRate
      if (phase > 2.0 * PI) phase -= 2.0 * PI

      // Asymmetric glottal pulse (smooth rise, sharp closure)
      val glottal = if (phase < PI * 1.3) {
        0.5 * (1.0 - kotlin.math.cos(phase / 1.3))
      } else {
        kotlin.math.exp(-(phase - PI * 1.3) * 3.2)
      }

      // Resonate formants matching the syllable's vowel
      val vowelIdx = (wordIndex + (wordHash % 5)) % formants.size
      val (f1, f2, f3) = formants[vowelIdx]

      val h1 = sin(phase * (f1 / currentF0)) * 0.48
      val h2 = sin(phase * (f2 / currentF0)) * 0.28
      val h3 = sin(phase * (f3 / currentF0)) * 0.14
      val rawWave = glottal * (h1 + h2 + h3)

      // Consonant fricative breath noise at the start of each word
      val noise = if (fracInWord < 0.12) {
        (kotlin.random.Random.nextDouble() - 0.5) * 0.22 * (1.0 - fracInWord / 0.12)
      } else {
        0.0
      }

      val sampleVal = ((rawWave + noise) * syllableEnv * 16000.0).toInt().coerceIn(-32767, 32767).toShort()
      buffer.putShort(sampleVal)
    }

    return wrapPcm24kMonoInWav(pcmBytes, sampleRate)
  }

  private fun wrapPcm24kMonoInWav(pcmData: ByteArray, sampleRate: Int): ByteArray {
    val channels = 1
    val bitsPerSample = 16
    val byteRate = sampleRate * channels * bitsPerSample / 8
    val blockAlign = (channels * bitsPerSample / 8).toShort()
    val subchunk2Size = pcmData.size
    val chunkSize = 36 + subchunk2Size

    val out = ByteArrayOutputStream(44 + pcmData.size)
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray(Charsets.US_ASCII))
    header.putInt(chunkSize)
    header.put("WAVE".toByteArray(Charsets.US_ASCII))
    header.put("fmt ".toByteArray(Charsets.US_ASCII))
    header.putInt(16) // PCM chunk size
    header.putShort(1) // AudioFormat = 1 (PCM)
    header.putShort(channels.toShort())
    header.putInt(sampleRate)
    header.putInt(byteRate)
    header.putShort(blockAlign)
    header.putShort(bitsPerSample.toShort())
    header.put("data".toByteArray(Charsets.US_ASCII))
    header.putInt(subchunk2Size)

    out.write(header.array())
    out.write(pcmData)
    return out.toByteArray()
  }

  /**
   * Professional YouTuber & Viral Social Media Creator Engine.
   * Generates high-retention, funny, snappy scripts with zero latency and zero timeouts.
   */
  private fun generateViralSocialScript(
    idea: String,
    scriptType: String,
    language: String,
    lengthSec: Int,
    charAName: String,
    charBName: String
  ): JSONArray {
    val cleanIdea = idea.trim().ifEmpty { "crazy viral secrets" }
    val lower = cleanIdea.lowercase()

    val rawLines = when (language) {
      "Hindi" -> when {
        lower.contains("octopus") -> listOf(
          Pair("A", "अरे भाई रुको! क्या तुम्हें पता है ऑक्टोपस के तीन दिल और नीला खून होता है?!"),
          Pair("B", "क्या बात कर रहे हो?! तीन दिल और मुझे एक भी नहीं मिला!"),
          Pair("A", "इतना ही नहीं, उसके नौ दिमाग होते हैं—हर हाथ अपने आप सोचता है!"),
          Pair("B", "नौ दिमाग?! और मेरे दोस्त फिर भी लावा में कूद जाते हैं!"),
          Pair("A", "और खतरा देखकर वो अपना रंग और रूप दो सेकंड में बदल लेता है!"),
          Pair("B", "कमेंट्स में बताओ क्या ऑक्टोपस एलियन है या असली प्राणी?!")
        )
        lower.contains("student") || lower.contains("school") -> listOf(
          Pair("A", "सुबह 6 बजे का अलार्म बजना दुनिया का सबसे बड़ा जुर्म है!"),
          Pair("B", "भाई सच में, आंखें खुली नहीं और टेस्ट पेपर सामने आ जाता है!"),
          Pair("A", "और टीचर सिर्फ उसी से सवाल पूछती है जो नीचे देख रहा हो!"),
          Pair("B", "मेरा दिमाग तो 999 पिंग पर लैग करने लगता है!"),
          Pair("A", "फिर भी हम रात 2 बजे रील स्क्रॉल करना कभी बंद नहीं करते!"),
          Pair("B", "कमेंट्स में बताओ तुम्हारा सबसे खतरनाक क्लासरूम मोमेंट कौन सा था?!")
        )
        else -> listOf(
          Pair("A", "रुक जाओ! $cleanIdea के बारे में ये वायरल सच 99% लोगों को नहीं पता!"),
          Pair("B", "अरे सच में?! मुझे तो लगा $cleanIdea बिल्कुल नॉर्मल चीज़ है!"),
          Pair("A", "बिल्कुल नहीं! जब तुम इसके पीछे का साइंस जानोगे तो होश उड़ जाएंगे!"),
          Pair("B", "भाई मेरा तो दिमाग ही हिल गया! जल्दी बताओ आगे क्या हुआ!"),
          Pair("A", "और सबसे क्रेज़ी बात तो ये है कि ये हर रोज़ हमारे साथ होता है!"),
          Pair("B", "अभी कमेंट्स में अपनी राय बताओ, क्या तुम्हें ये पहले से पता था?!")
        )
      }
      "Roman Urdu" -> when {
        lower.contains("octopus") -> listOf(
          Pair("A", "Bhai ruko! Kya tumhein pata hai octopus ke teen dil aur neela khoon hota hai?!"),
          Pair("B", "Kya baat kar rahe ho yaar?! Teen dil aur mere paas ek bhi nahi bacha!"),
          Pair("A", "Sirf yeh nahi, uske 9 dimaag hote hain—har haath alag sochta hai!"),
          Pair("B", "9 dimaag?! Aur mere squad mates phir bhi seedha lava mein jump karte hain!"),
          Pair("A", "Aur khatra dekhte hi apna rang aur texture 2 second mein badal leta hai!"),
          Pair("B", "Abhi comments mein batao kya octopus alien hai ya jaanwar?!")
        )
        lower.contains("student") || lower.contains("school") -> listOf(
          Pair("A", "Subah 6 baje ka alarm bajna sabse bara scam hai!"),
          Pair("B", "Sachi yaar! Aankh khulti nahi aur homework ka darr shuru ho jata hai!"),
          Pair("A", "Aur teacher hamesha usi ko khara karti hai jo chupne ki koshish kare!"),
          Pair("B", "Mera dimaag toh us time 999 ping pe crash kar jata hai!"),
          Pair("A", "Magar raat ko 3 baje tak reels dekhna hum kabhi nahi chortey!"),
          Pair("B", "Comments mein batao tumhare saath yeh hua hai ya nahi?!")
        )
        else -> listOf(
          Pair("A", "Stop scrolling! $cleanIdea ke baare mein yeh viral baat kisi ne nahi batayi!"),
          Pair("B", "Wait kya sach mein?! Main toh $cleanIdea ko aam si baat samajhta tha!"),
          Pair("A", "Bilkul nahi! $cleanIdea ke peechay ki haqeeqat sun kar hosh udd jayenge!"),
          Pair("B", "Bhai mera toh dimaag hi hang ho gaya! Jaldi batao aage kya hai!"),
          Pair("A", "Aur sabse crazy part yeh hai ke yeh har roz hamare saamne hota hai!"),
          Pair("B", "Abhi comments mein batao agar tumhein yeh pehle se pata tha!")
        )
      }
      else -> when {
        lower.contains("octopus") -> listOf(
          Pair("A", "Stop scrolling! An octopus literally has THREE hearts and BLUE blood!"),
          Pair("B", "Wait what?! Three hearts and I still cannot find one valentine!"),
          Pair("A", "Even crazier: they have NINE brains! One in each arm to think independently!"),
          Pair("B", "Nine brains?! Yet my teammates still jump straight into lava!"),
          Pair("A", "They can also camouflage and vanish in under two seconds flat!"),
          Pair("B", "Are octopuses aliens living in our ocean? Debate in the comments right now!")
        )
        lower.contains("minecraft") -> listOf(
          Pair("A", "Do NOT build your Minecraft house out of wood, and here is why!"),
          Pair("B", "Bro what?! My entire mansion is birch wood and vibe!"),
          Pair("A", "All it takes is ONE lightning strike or a stealth Creeper whispering behind you!"),
          Pair("B", "Wait, is that why my basement suddenly became a smoking crater?!"),
          Pair("A", "Yes! Always build with obsidian or keep a water bucket hotkeyed!"),
          Pair("B", "Drop your worst Minecraft death in the comments right now!")
        )
        lower.contains("student") || lower.contains("school") -> listOf(
          Pair("A", "Setting an alarm for 6 AM is scientifically proven to be emotional damage!"),
          Pair("B", "Bro facts! My soul is still sleeping while my body is walking to class!"),
          Pair("A", "And the teacher always calls on you the second you make eye contact!"),
          Pair("B", "My brain starts buffering like a 2005 dial-up router!"),
          Pair("A", "Yet tonight at 3 AM you will still be binge-watching short videos!"),
          Pair("B", "If you do this every single school night, leave a comment right now!")
        )
        lower.contains("gaming") || lower.contains("game") -> listOf(
          Pair("A", "Saying 'just ONE more game' at 11 PM is the biggest lie in human history!"),
          Pair("B", "Bro do not expose me! Next thing you know the birds are chirping outside!"),
          Pair("A", "And you only lost because your Wi-Fi lagged at 999 ping on the final boss!"),
          Pair("B", "I swear my controller stopped working! It was totally NOT my fault!"),
          Pair("A", "Sure, blame the Wi-Fi when you whiffed three point-blank shots!"),
          Pair("B", "Who is the friend that always blames lag? Tag them in the comments!")
        )
        else -> listOf(
          Pair("A", "Stop scrolling! What nobody tells you about $cleanIdea will genuinely melt your brain!"),
          Pair("B", "Wait really?! I thought $cleanIdea was completely normal!"),
          Pair("A", "Not even close! In $scriptType mode, $cleanIdea breaks every rule you thought existed."),
          Pair("B", "Bro, my brain just dropped to 2 FPS! What rule are you talking about?!"),
          Pair("A", "If you test $cleanIdea in real life, the result is completely wild and unexpected."),
          Pair("B", "Drop your honest reaction in the comments right now if you knew this!")
        )
      }
    }

    val targetCount = when {
      lengthSec <= 15 -> 4
      lengthSec <= 30 -> 6
      lengthSec <= 45 -> 8
      else -> rawLines.size
    }.coerceIn(4, rawLines.size)

    val selected = rawLines.take(targetCount)
    val arr = JSONArray()
    for (i in selected.indices) {
      val (spk, txt) = selected[i]
      arr.put(
        JSONObject()
          .put("speaker", spk)
          .put("text", txt)
      )
    }
    return arr
  }

  private fun rewriteViralLineLocally(
    speaker: String,
    idea: String,
    isFirst: Boolean,
    isLast: Boolean,
    currentText: String,
    language: String
  ): String {
    val topic = idea.trim().ifEmpty { "this" }
    return when (language) {
      "Hindi" -> when {
        isFirst -> "रुक जाओ भाई! $topic के बारे में ये सच सुनकर तुम्हारा दिमाग चकरा जाएगा!"
        isLast -> "कमेंट्स में बताओ क्या तुम्हें ये पहले से पता था या तुम्हारा भी दिमाग हिल गया?!"
        speaker == "A" -> "और सबसे बड़ी बात तो ये है कि $topic ने सबको हैरान कर दिया!"
        else -> "अरे भाई सच में?! मुझे तो बिल्कुल यकीन नहीं हो रहा!"
      }
      "Roman Urdu" -> when {
        isFirst -> "Bhai stop scrolling! $topic ke baare mein yeh baat kisi ne nahi batayi!"
        isLast -> "Abhi comments mein batao agar tumhein $topic ka yeh secret pata tha!"
        speaker == "A" -> "Aur sabse crazy baat yeh hai ke $topic ne sabko shock kar diya!"
        else -> "Bhai sach mein?! Mera toh dimaag hi hang ho gaya!"
      }
      else -> when {
        isFirst -> "Stop scrolling! What nobody tells you about $topic will blow your mind!"
        isLast -> "Drop your reaction in the comments right now if you knew this about $topic!"
        speaker == "A" -> "And the craziest part is what happens when you look closely at $topic!"
        else -> "Wait what?! Bro my brain just lagged harder than 999 ping!"
      }
    }
  }
}
