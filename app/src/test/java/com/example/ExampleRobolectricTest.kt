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
    assertEquals("ToonTalk Studio", appName)

    val assetFiles = context.assets.list("")?.toSet().orEmpty()
    assertTrue(assetFiles.contains("index.html"))
    assertTrue(assetFiles.contains("styles.css"))
    assertTrue(assetFiles.contains("starter_assets.js"))
    assertTrue(assetFiles.contains("render_engine.js"))
    assertTrue(assetFiles.contains("app.js"))
  }
}
