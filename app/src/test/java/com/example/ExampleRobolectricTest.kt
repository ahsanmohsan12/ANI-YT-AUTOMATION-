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
      .putString("elevenlabs_api_key", "test_eleven_key")
      .putString("openai_api_key", "test_openai_key")
      .apply()

    assertEquals("test_eleven_key", prefs.getString("elevenlabs_api_key", ""))
    assertEquals("test_openai_key", prefs.getString("openai_api_key", ""))
  }
}
