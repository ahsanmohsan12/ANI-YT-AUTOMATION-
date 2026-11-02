package com.example

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.ui.theme.CartoonSkyBlue
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // STEP 1: Configure App Check with launch intent before any UI or Firebase operations
    configureAppCheck(this, intent)

    enableEdgeToEdge()

    setContent {
      MyApplicationTheme {
        Scaffold(
          modifier = Modifier
            .fillMaxSize()
            .background(CartoonSkyBlue)
            .testTag("toontalk_studio_root"),
          containerColor = CartoonSkyBlue,
          contentWindowInsets = WindowInsets.safeDrawing
        ) { innerPadding ->
          ToonTalkWebViewHost(
            modifier = Modifier
              .fillMaxSize()
              .padding(innerPadding)
              .testTag("webview_container")
          )
        }
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ToonTalkWebViewHost(modifier: Modifier = Modifier) {
  val context = LocalContext.current
  val coroutineScope = rememberCoroutineScope()
  var webViewRef by remember { mutableStateOf<WebView?>(null) }
  var fileUploadCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }

  // Runtime permission request for notifications on Android 13+ (API 33+)
  val notificationPermissionLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.RequestPermission()
  ) { _ -> }

  LaunchedEffect(Unit) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      val granted = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS
      ) == PackageManager.PERMISSION_GRANTED
      if (!granted) {
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      }
    }
  }

  // Zero-permission Android Photo/Video Picker for selecting background videos or character PNGs
  val visualMediaPickerLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.PickVisualMedia()
  ) { uri: Uri? ->
    val callback = fileUploadCallback
    fileUploadCallback = null
    if (callback != null) {
      if (uri != null) {
        callback.onReceiveValue(arrayOf(uri))
      } else {
        callback.onReceiveValue(null)
      }
    }
  }

  val fallbackFileChooserLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.StartActivityForResult()
  ) { result ->
    val callback = fileUploadCallback
    fileUploadCallback = null
    if (callback == null) return@rememberLauncherForActivityResult

    if (result.resultCode == Activity.RESULT_OK) {
      val data = result.data
      val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, data)
        ?: data?.data?.let { arrayOf(it) }
      callback.onReceiveValue(uris)
    } else {
      callback.onReceiveValue(null)
    }
  }

  val aiBridge = remember(context) {
    ToonTalkAiBridge(
      context = context,
      scope = coroutineScope,
      webViewProvider = { webViewRef }
    )
  }

  DisposableEffect(Unit) {
    onDispose {
      aiBridge.shutdown()
      webViewRef?.destroy()
    }
  }

  BackHandler(enabled = true) {
    val wv = webViewRef
    if (wv != null && wv.canGoBack()) {
      wv.goBack()
    } else if (context is Activity) {
      context.finish()
    }
  }

  Box(modifier = modifier.background(CartoonSkyBlue)) {
    AndroidView(
      modifier = Modifier
        .fillMaxSize()
        .testTag("toontalk_webview"),
      factory = { ctx ->
        WebView(ctx).apply {
          layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
          )
          setBackgroundColor(android.graphics.Color.parseColor("#BFE9FF"))

          settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
          }

          addJavascriptInterface(aiBridge, "AndroidBridge")

          setDownloadListener { url, _, _, mimetype, _ ->
            try {
              val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(url), mimetype ?: "video/mp4")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              }
              ctx.startActivity(intent)
            } catch (_: Exception) {}
          }

          webViewClient = WebViewClient()
          webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
              request?.grant(request.resources)
            }

            override fun onShowFileChooser(
              webView: WebView?,
              filePathCallback: ValueCallback<Array<Uri>>?,
              fileChooserParams: FileChooserParams?
            ): Boolean {
              fileUploadCallback?.onReceiveValue(null)
              fileUploadCallback = filePathCallback
              val acceptTypes = fileChooserParams?.acceptTypes?.joinToString(",")?.lowercase().orEmpty()

              return try {
                when {
                  acceptTypes.contains("video") -> {
                    visualMediaPickerLauncher.launch(
                      PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)
                    )
                    true
                  }
                  acceptTypes.contains("image") -> {
                    visualMediaPickerLauncher.launch(
                      PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                    true
                  }
                  else -> {
                    val chooserIntent = fileChooserParams?.createIntent()
                      ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                      }
                    fallbackFileChooserLauncher.launch(chooserIntent)
                    true
                  }
                }
              } catch (e: Exception) {
                fileUploadCallback = null
                false
              }
            }
          }

          loadUrl("file:///android_asset/index.html")
          webViewRef = this
        }
      }
    )
  }
}
