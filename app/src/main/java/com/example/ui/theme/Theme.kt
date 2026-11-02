package com.example.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val CartoonColorScheme = lightColorScheme(
  primary = CartoonYellow,
  onPrimary = CartoonInk,
  secondary = CartoonPink,
  onSecondary = CartoonInk,
  tertiary = CartoonGreen,
  onTertiary = CartoonInk,
  background = CartoonSkyBlue,
  onBackground = CartoonInk,
  surface = CartoonWhite,
  onSurface = CartoonInk,
  surfaceVariant = CartoonCream,
  onSurfaceVariant = CartoonInk
)

@Composable
fun MyApplicationTheme(
  darkTheme: Boolean = false,
  dynamicColor: Boolean = false,
  content: @Composable () -> Unit,
) {
  MaterialTheme(
    colorScheme = CartoonColorScheme,
    typography = Typography,
    content = content
  )
}
