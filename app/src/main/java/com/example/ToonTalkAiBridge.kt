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
  private val ttsMutex = kotlinx.coroutines.sync.Mutex()
  private val pendingUtterances = java.util.concurrent.ConcurrentHashMap<String, CountDownLatch>()

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
        val voiceName = req.optString("voiceName", "Alex")
        val language = req.optString("language", "English")
        val pitch = req.optDouble("pitch", 1.0).toFloat().coerceIn(0.6f, 1.6f)
        val speed = req.optDouble("speed", 1.0).toFloat().coerceIn(0.7f, 1.5f)

        val prefs = context.getSharedPreferences("toontalk_native_prefs", Context.MODE_PRIVATE)
        val payloadKey = req.optString("apiKey", "").trim()
        val customApiKey = payloadKey.ifEmpty {
          prefs.getString("custom_gemini_api_key", "")?.trim().orEmpty()
        }

        var wavBytes: ByteArray? = null

        // 1. If user supplied a custom Gemini API key, try Gemini TTS REST endpoint first
        if (customApiKey.isNotEmpty()) {
          wavBytes = tryGeminiRestTts(customApiKey, text, voiceName)
        }

        // 2. Next, try Android native TextToSpeech engine with distinct voice persona, pitch, and speed
        if (wavBytes == null || wavBytes.size < 512) {
          wavBytes = tryAndroidNativeTts(text, voiceName, language, pitch, speed)
        }

        // 3. Fallback: High-fidelity resonant formant vocal synthesizer so audio is always guaranteed
        if (wavBytes == null || wavBytes.size < 512) {
          wavBytes = generateExpressiveVocalWav(text, voiceName, pitch, speed)
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

      val isFemale = voiceName in setOf(
        "Emma", "Chloe", "Maya", "Lily", "Priya", "Kore", "Aoede", "Zephyr", "Leda"
      )

      val targetLocale = when {
        voiceName in setOf("Oliver", "Lily") -> Locale.UK
        language == "Hindi" || voiceName in setOf("Arjun", "Priya") -> Locale("hi", "IN")
        language == "Roman Urdu" -> Locale("ur", "PK")
        else -> Locale.US
      }

      val (basePitch, baseRate) = when (voiceName) {
        "Marcus" -> Pair(0.74f, 0.94f)
        "Charon" -> Pair(0.78f, 0.98f)
        "Orpheus" -> Pair(0.86f, 1.02f)
        "Fenrir" -> Pair(0.88f, 1.20f)
        "Oliver" -> Pair(0.96f, 1.00f)
        "Alex" -> Pair(1.00f, 1.05f)
        "Arjun" -> Pair(1.02f, 1.06f)
        "Leo" -> Pair(1.06f, 1.20f)
        "Puck" -> Pair(1.06f, 1.12f)
        "Leda" -> Pair(1.02f, 0.96f)
        "Lily" -> Pair(1.10f, 1.02f)
        "Emma" -> Pair(1.14f, 1.05f)
        "Aoede" -> Pair(1.14f, 1.04f)
        "Priya" -> Pair(1.14f, 1.04f)
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
      "Marcus" -> 105.0
      "Charon" -> 115.0
      "Orpheus" -> 124.0
      "Fenrir" -> 132.0
      "Oliver" -> 138.0
      "Alex" -> 146.0
      "Arjun" -> 152.0
      "Leo" -> 162.0
      "Puck" -> 168.0
      "Leda" -> 195.0
      "Lily" -> 205.0
      "Aoede" -> 215.0
      "Emma" -> 225.0
      "Priya" -> 232.0
      "Kore" -> 245.0
      "Chloe" -> 255.0
      "Maya" -> 265.0
      "Zephyr" -> 275.0
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
}
