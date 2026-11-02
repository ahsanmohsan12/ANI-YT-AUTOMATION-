package com.example.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.example.R

val FredokaFontFamily = FontFamily(
  Font(R.font.fredoka, FontWeight.Normal),
  Font(R.font.fredoka, FontWeight.Bold)
)

val Baloo2FontFamily = FontFamily(
  Font(R.font.baloo_2, FontWeight.Normal),
  Font(R.font.baloo_2, FontWeight.Bold)
)

val BubblegumSansFontFamily = FontFamily(
  Font(R.font.bubblegum_sans, FontWeight.Normal)
)

val BangersFontFamily = FontFamily(
  Font(R.font.bangers, FontWeight.Normal)
)

val PoppinsFontFamily = FontFamily(
  Font(R.font.poppins, FontWeight.Normal)
)

val Typography = Typography(
  displayLarge = TextStyle(
    fontFamily = FredokaFontFamily,
    fontWeight = FontWeight.Bold,
    fontSize = 32.sp,
    lineHeight = 38.sp
  ),
  headlineMedium = TextStyle(
    fontFamily = FredokaFontFamily,
    fontWeight = FontWeight.Bold,
    fontSize = 24.sp,
    lineHeight = 30.sp
  ),
  titleLarge = TextStyle(
    fontFamily = FredokaFontFamily,
    fontWeight = FontWeight.Bold,
    fontSize = 20.sp,
    lineHeight = 26.sp
  ),
  bodyLarge = TextStyle(
    fontFamily = Baloo2FontFamily,
    fontWeight = FontWeight.Normal,
    fontSize = 16.sp,
    lineHeight = 22.sp
  ),
  labelLarge = TextStyle(
    fontFamily = FredokaFontFamily,
    fontWeight = FontWeight.Bold,
    fontSize = 15.sp,
    lineHeight = 20.sp
  )
)
