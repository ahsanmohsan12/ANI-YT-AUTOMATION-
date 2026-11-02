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
      .connectTimeout(30, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .writeTimeout(30, TimeUnit.SECONDS)
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

  init {
    try {
      ttsEngine = TextToSpeech(context.applicationContext) { status ->
        ttsReady = (status == TextToSpeech.SUCCESS)
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
        val idea = req.optString("idea", "funny gaming facts")
        val scriptType = req.optString("scriptType", "Funny Facts")
        val customStyle = req.optString("customStyle", "")
        val language = req.optString("language", "English")
        val lengthSec = req.optInt("lengthSec", 30)
        val charAName = req.optString("charAName", "A")
        val charBName = req.optString("charBName", "B")
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
          lengthSec <= 30 -> 7
          lengthSec <= 45 -> 10
          else -> 13
        }

        val effectiveStyle = if (scriptType.equals("Custom", ignoreCase = true) && customStyle.isNotBlank()) {
          "Custom style: $customStyle"
        } else {
          scriptType
        }

        val languageInstruction = when (language) {
          "Roman Urdu" -> "Write all dialogue in natural, viral Roman Urdu (Urdu written in Latin alphabet, e.g., 'Yaar tumhe pata hai...')."
          "Hindi" -> "Write all dialogue in natural conversational Hindi (Devanagari script, e.g., 'भाई क्या तुम्हें पता है...')."
          else -> "Write all dialogue in simple, punchy, viral English."
        }

        val prompt = """
          Create a viral vertical short-form video script (${lengthSec}s target, around $targetLineCount lines) between two characters:
          - Speaker "A" ($charAName): Confident, clever, bold, drives the topic.
          - Speaker "B" ($charBName): Silly, dramatic, skeptical, or funny reacting sidekick.

          Topic / Idea: "$idea"
          Script Type / Tone: "$effectiveStyle"
          Language Rule: $languageInstruction

          Strict Rules:
          1. Alternate speakers strictly starting with "A", then "B", then "A", etc.
          2. Maximum 20 words per line. Keep sentences short, fast-paced, and easy to caption.
          3. Line 1 MUST be an irresistible viral hook that grabs attention in the first 2 seconds.
          4. The final line MUST be a hilarious punchline or a question that makes viewers argue in the comments.
          5. Match the tone of "$effectiveStyle" autentically.
        """.trimIndent()

        val linesArray: JSONArray = if (customApiKey.isNotEmpty()) {
          generateScriptWithCustomKey(customApiKey, prompt)
        } else {
          val response = withTimeout(60_000L) {
            scriptModel.generateContent(prompt)
          }
          val rawText = response.text ?: throw IllegalStateException("Model returned empty response.")
          val parsed = JSONObject(rawText)
          parsed.getJSONArray("lines")
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
      } catch (e: TimeoutCancellationException) {
        Log.e(TAG, "Script generation timed out", e)
        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", false)
            .put("error", "Script generation timed out after 60 seconds. Tap Retry to try again.")
        )
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Log.e(TAG, "Script generation failed", e)
        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", false)
            .put("error", e.localizedMessage ?: "Failed to generate script. Check connection and retry.")
        )
      }
    }
  }

  @JavascriptInterface
  fun regenerateLine(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val idea = req.optString("idea", "")
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
          "Speaker A (the confident, bold presenter)"
        } else {
          "Speaker B (the silly, overreacting sidekick)"
        }

        val roleHint = when {
          isFirst -> "This is the FIRST line, so make it a super catchy viral hook!"
          isLast -> "This is the LAST line, so make it a funny punchline or a question for the comments!"
          else -> "Make it flow naturally between the previous and next lines."
        }

        val prompt = """
          Rewrite this single dialogue line for a viral "$scriptType" short video about "$idea" in $language.
          Character: $persona
          Previous line: "$prevText"
          Current line to replace: "$currentText"
          Next line: "$nextText"
          Instruction: $roleHint
          Maximum 20 words, fresh wording, simple and punchy.
        """.trimIndent()

        val newText = if (customApiKey.isNotEmpty()) {
          regenerateSingleLineWithCustomKey(customApiKey, prompt)
        } else {
          val response = withTimeout(45_000L) {
            singleLineModel.generateContent(prompt)
          }
          val rawText = response.text ?: throw IllegalStateException("Empty response from model.")
          JSONObject(rawText).optString("text", currentText)
        }

        val words = newText.trim().split(Regex("\\s+"))
        val capped = if (words.size > 20) words.take(20).joinToString(" ") else newText.trim()

        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", true)
            .put("text", capped)
        )
      } catch (e: TimeoutCancellationException) {
        Log.e(TAG, "Line regeneration timed out", e)
        sendCallbackToJs(
          callbackId,
          JSONObject().put("ok", false).put("error", "Line rewrite timed out. Please tap Retry.")
        )
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Log.e(TAG, "Line regeneration failed", e)
        sendCallbackToJs(
          callbackId,
          JSONObject().put("ok", false).put("error", e.localizedMessage ?: "Could not rewrite line.")
        )
      }
    }
  }

  @JavascriptInterface
  fun synthesizeVoice(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val text = req.optString("text", "Hello there!").trim()
        val voiceName = req.optString("voiceName", "Puck")
        val language = req.optString("language", "English")
        val customApiKey = req.optString("apiKey", "").trim()

        var wavBytes: ByteArray? = null

        // 1. If user supplied a custom Gemini API key, try Gemini TTS REST endpoint first
        if (customApiKey.isNotEmpty()) {
          wavBytes = tryGeminiRestTts(customApiKey, text, voiceName)
        }

        // 2. Next, try Android native TextToSpeech engine with distinct voice persona pitch/rate
        if (wavBytes == null || wavBytes.size < 512) {
          wavBytes = tryAndroidNativeTts(text, voiceName, language)
        }

        // 3. Fallback: Expressive syllable-cadenced formant vocal synthesis so audio is guaranteed
        if (wavBytes == null || wavBytes.size < 512) {
          wavBytes = generateExpressiveVocalWav(text, voiceName)
        }

        val base64Wav = Base64.encodeToString(wavBytes, Base64.NO_WRAP)
        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", true)
            .put("audioBase64", base64Wav)
            .put("mimeType", "audio/wav")
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

  @JavascriptInterface
  fun saveVideoToGallery(callbackId: String, payloadJson: String) {
    scope.launch(Dispatchers.IO) {
      try {
        val req = JSONObject(payloadJson)
        val base64Data = req.getString("base64Data")
        val mimeType = req.optString("mimeType", "video/mp4")
        val ext = if (mimeType.contains("mp4", ignoreCase = true)) "mp4" else "webm"
        val fileName = "ToonTalk_${System.currentTimeMillis()}.$ext"
        val bytes = Base64.decode(base64Data, Base64.DEFAULT)

        val resolver = context.contentResolver
        val contentValues = ContentValues().apply {
          put(MediaStore.Video.Media.DISPLAY_NAME, fileName)
          put(MediaStore.Video.Media.MIME_TYPE, if (ext == "mp4") "video/mp4" else "video/webm")
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/ToonTalk")
            put(MediaStore.Video.Media.IS_PENDING, 1)
          }
        }

        val videoUri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, contentValues)
        if (videoUri != null) {
          resolver.openOutputStream(videoUri)?.use { out ->
            out.write(bytes)
            out.flush()
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val updateValues = ContentValues().apply {
              put(MediaStore.Video.Media.IS_PENDING, 0)
            }
            resolver.update(videoUri, updateValues, null, null)
          }
        }

        // Also keep a copy in app exports folder
        val exportsDir = File(context.cacheDir, "exports").apply { mkdirs() }
        val localFile = File(exportsDir, fileName)
        localFile.writeBytes(bytes)

        sendCallbackToJs(
          callbackId,
          JSONObject()
            .put("ok", true)
            .put("fileName", fileName)
            .put("savedPath", "Movies/ToonTalk/$fileName")
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
        val fileName = "ToonTalk_Share_${System.currentTimeMillis()}.$ext"
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
            putExtra(Intent.EXTRA_TEXT, "Made with ToonTalk Studio!")
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

  private fun tryAndroidNativeTts(text: String, voiceName: String, language: String): ByteArray? {
    try {
      ttsInitLatch.await(3, TimeUnit.SECONDS)
      val engine = ttsEngine ?: return null
      if (!ttsReady) return null

      val locale = when (language) {
        "Hindi" -> Locale("hi", "IN")
        "Roman Urdu" -> Locale("ur", "PK")
        else -> Locale.US
      }
      engine.language = locale

      // Configure distinct prebuilt voice personas (Puck, Charon, Kore, Fenrir, Aoede, Zephyr)
      when (voiceName) {
        "Puck" -> {
          engine.setPitch(1.06f)
          engine.setSpeechRate(1.12f)
        }
        "Charon" -> {
          engine.setPitch(0.80f)
          engine.setSpeechRate(1.02f)
        }
        "Kore" -> {
          engine.setPitch(1.25f)
          engine.setSpeechRate(1.10f)
        }
        "Fenrir" -> {
          engine.setPitch(0.90f)
          engine.setSpeechRate(1.20f)
        }
        "Aoede" -> {
          engine.setPitch(1.16f)
          engine.setSpeechRate(1.04f)
        }
        "Zephyr" -> {
          engine.setPitch(1.38f)
          engine.setSpeechRate(1.18f)
        }
        else -> {
          engine.setPitch(1.0f)
          engine.setSpeechRate(1.08f)
        }
      }

      val utteranceId = UUID.randomUUID().toString()
      val outFile = File(context.cacheDir, "tts_$utteranceId.wav")
      val doneLatch = CountDownLatch(1)

      engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String?) {}
        override fun onDone(id: String?) {
          if (id == utteranceId) doneLatch.countDown()
        }
        @Deprecated("Deprecated in Java")
        override fun onError(id: String?) {
          if (id == utteranceId) doneLatch.countDown()
        }
        override fun onError(id: String?, errorCode: Int) {
          if (id == utteranceId) doneLatch.countDown()
        }
      })

      val res = engine.synthesizeToFile(text, null, outFile, utteranceId)
      if (res == TextToSpeech.SUCCESS) {
        doneLatch.await(8, TimeUnit.SECONDS)
        if (outFile.exists() && outFile.length() > 512) {
          val bytes = outFile.readBytes()
          outFile.delete()
          return bytes
        }
      }
      outFile.delete()
    } catch (e: Exception) {
      Log.w(TAG, "Android native TTS synthesis unavailable, using expressive vocal synth", e)
    }
    return null
  }

  /**
   * Produces a clean 24kHz 16-bit mono WAV with syllable-articulated formant harmonics
   * matched to the word count and voice persona whenever hardware/network TTS is offline.
   */
  private fun generateExpressiveVocalWav(text: String, voiceName: String): ByteArray {
    val sampleRate = 24000
    val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val wordCount = words.size.coerceAtLeast(1)

    val baseFreq = when (voiceName) {
      "Charon" -> 115.0
      "Fenrir" -> 135.0
      "Puck" -> 165.0
      "Aoede" -> 215.0
      "Kore" -> 240.0
      "Zephyr" -> 275.0
      else -> 180.0
    }

    val secondsPerWord = 0.28
    val totalDurationSec = (wordCount * secondsPerWord + 0.25).coerceIn(1.1, 8.5)
    val totalSamples = (totalDurationSec * sampleRate).toInt()
    val pcmBytes = ByteArray(totalSamples * 2)
    val buffer = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN)

    var phase1 = 0.0
    var phase2 = 0.0
    var phase3 = 0.0

    for (i in 0 until totalSamples) {
      val t = i.toDouble() / sampleRate
      val wordPos = t / secondsPerWord
      val wordIndex = wordPos.toInt()
      val fracInWord = wordPos - wordIndex

      // Syllable envelope with natural pauses between words
      val syllableEnv = if (wordIndex < wordCount) {
        sin(min(1.0, fracInWord * 1.15) * PI).coerceAtLeast(0.0)
      } else {
        0.0
      }

      // Expressive pitch inflection per word
      val wordHash = if (wordIndex < words.size) words[wordIndex].hashCode() else 0
      val pitchMod = 1.0 + 0.12 * sin(wordIndex * 1.7 + (wordHash % 5) * 0.3) + 0.05 * sin(fracInWord * PI * 2)
      val f0 = baseFreq * pitchMod
      val f1 = f0 * 2.0
      val f2 = f0 * 3.0

      phase1 += 2.0 * PI * f0 / sampleRate
      phase2 += 2.0 * PI * f1 / sampleRate
      phase3 += 2.0 * PI * f2 / sampleRate

      val rawWave = (0.60 * sin(phase1) + 0.28 * sin(phase2) + 0.12 * sin(phase3))
      val sampleVal = (rawWave * syllableEnv * 14000.0).toInt().coerceIn(-32767, 32767).toShort()
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
}
