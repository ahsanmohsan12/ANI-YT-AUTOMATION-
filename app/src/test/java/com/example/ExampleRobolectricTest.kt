package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExampleRobolectricTest {

  @Test
  fun `verify app name and studio assets exist`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val appName = context.getString(R.string.app_name)
    assertEquals("ANI SHORTS", appName)

    val assetFiles = context.assets.list("")?.toSet().orEmpty()
    assertTrue(assetFiles.contains("index.html"))
    assertTrue(assetFiles.contains("styles.css"))
    assertTrue(assetFiles.contains("starter_assets.js"))
    assertTrue(assetFiles.contains("render_engine.js"))
    assertTrue(assetFiles.contains("app.js"))
    val fontFiles = context.assets.list("fonts")?.toSet().orEmpty()
    assertTrue(fontFiles.contains("luckiest_guy.ttf"))
    assertTrue(fontFiles.contains("anton.ttf"))
    assertTrue(fontFiles.contains("titan_one.ttf"))
    assertTrue(fontFiles.contains("montserrat.ttf"))
  }

  @Test
  fun `verify third party voice api key preference storage`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val prefs = context.getSharedPreferences("toontalk_native_prefs", Context.MODE_PRIVATE)
    prefs.edit()
      .putString("hf_api_key", "test_hf_token")
      .putString("kokoro_api_key", "test_kokoro_key")
      .putString("kokoro_api_url", "http://localhost:8880")
      .putString("elevenlabs_api_key", "test_eleven_key")
      .putString("openai_api_key", "test_openai_key")
      .apply()

    assertEquals("test_hf_token", prefs.getString("hf_api_key", ""))
    assertEquals("test_kokoro_key", prefs.getString("kokoro_api_key", ""))
    assertEquals("http://localhost:8880", prefs.getString("kokoro_api_url", ""))
    assertEquals("test_eleven_key", prefs.getString("elevenlabs_api_key", ""))
    assertEquals("test_openai_key", prefs.getString("openai_api_key", ""))
  }

  @Test
  fun `verify html and javascript assets have balanced braces and required controls`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val html = context.assets.open("index.html").bufferedReader().use { it.readText() }
    val appJs = context.assets.open("app.js").bufferedReader().use { it.readText() }
    val renderJs = context.assets.open("render_engine.js").bufferedReader().use { it.readText() }
    val starterJs = context.assets.open("starter_assets.js").bufferedReader().use { it.readText() }

    assertTrue("index.html should contain Character Sway toggle", html.contains("id=\"btn-toggle-char-sway\""))
    assertTrue("index.html should contain Audio8 banner", html.contains("id=\"audio8-engine-banner\""))
    assertTrue("index.html should contain Kokoro banner", html.contains("id=\"kokoro-engine-banner\""))
    assertTrue("app.js should not have duplicate catch block", !appJs.contains("} catch (_) {}\n  }\n    } catch (_) {}"))
    assertTrue("app.js should contain retryWithExponentialBackoff", appJs.contains("async function retryWithExponentialBackoff("))

    for ((name, src) in listOf("app.js" to appJs, "render_engine.js" to renderJs, "starter_assets.js" to starterJs)) {
      val openBraces = src.count { it == '{' }
      val closeBraces = src.count { it == '}' }
      assertEquals("Balanced curly braces in $name", openBraces, closeBraces)
    }
  }

  @Test
  fun `verify exponential backoff auto retry recovers from transient failures`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Unconfined)
    val bridge = ToonTalkAiBridge(context, scope) { null }

    var attempts = 0
    val result = kotlinx.coroutines.runBlocking {
      bridge.retryWithExponentialBackoff(
        operationName = "test_60s_script_retry",
        maxRetries = 3,
        initialDelayMs = 10L,
        maxDelayMs = 50L
      ) { attempt ->
        attempts++
        if (attempt < 2) {
          throw java.net.SocketTimeoutException("Simulated 60s request timeout on attempt $attempt")
        }
        "recovered_after_${attempts}_attempts"
      }
    }

    assertEquals(3, attempts)
    assertEquals("recovered_after_3_attempts", result)
    assertTrue(bridge.isTransientApiFailure(java.net.SocketTimeoutException("Read timed out")))
    assertTrue(bridge.isTransientApiFailure(IllegalStateException("Gemini API error (429): Rate limit")))
    assertTrue(bridge.isTransientApiFailure(IllegalStateException("Gemini API error (503): Service unavailable")))
    bridge.shutdown()
  }
}
