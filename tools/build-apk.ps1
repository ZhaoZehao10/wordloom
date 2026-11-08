# 随机游走 VR — APK 构建（无 Gradle：aapt2 + javac + d8 + zipalign + apksigner）
# 前置：android-sdk\ 下已有 cmdline-tools / platform-tools / platforms;android-33 / build-tools;33.0.2
#       JDK 17（PATH 中已有 java）
# 用法：powershell -File tools\build-apk.ps1
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
$SDK = Join-Path $ROOT 'android-sdk'
$BT = Join-Path $SDK 'build-tools\33.0.2'
$AJ = Join-Path $SDK 'platforms\android-33\android.jar'
$WORK = Join-Path $ROOT 'apk\build'
$OUT = Join-Path $ROOT 'dist'

New-Item -ItemType Directory -Force -Path $WORK, $OUT | Out-Null

# 0) 前置检查
foreach ($f in (Join-Path $BT 'aapt2.exe'), (Join-Path $BT 'd8.bat'), (Join-Path $BT 'apksigner.bat'), (Join-Path $BT 'zipalign.exe'), $AJ) {
  if (-not (Test-Path $f)) { Write-Error "缺少 $f —— 请先安装 Android SDK 组件（见 README）" }
}

# 0.5) 生成图标
node (Join-Path $ROOT 'tools\make-icons.mjs')

# 1) 资产：单文件离线版作为 assets/game/index.html
node (Join-Path $ROOT 'tools\make-offline.mjs')
New-Item -ItemType Directory -Force -Path (Join-Path $WORK 'assets\game') | Out-Null
Copy-Item (Join-Path $OUT '随机游走VR-离线版.html') (Join-Path $WORK 'assets\game\index.html') -Force

# 2) aapt2 编译资源 + 链接 → base.apk（含 resources.arsc + manifest + assets）
& (Join-Path $BT 'aapt2.exe') compile --dir (Join-Path $ROOT 'apk\res') -o (Join-Path $WORK 'res.zip')
if ($LASTEXITCODE -ne 0) { Write-Error 'aapt2 compile 失败' }
& (Join-Path $BT 'aapt2.exe') link `
  -o (Join-Path $WORK 'base.apk') `
  -I $AJ `
  --manifest (Join-Path $ROOT 'apk\AndroidManifest.xml') `
  -A (Join-Path $WORK 'assets') `
  (Join-Path $WORK 'res.zip') --auto-add-overlay
if ($LASTEXITCODE -ne 0) { Write-Error 'aapt2 link 失败' }

# 3) javac 编译
$classes = Join-Path $WORK 'classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
$srcs = Get-ChildItem -Recurse -Filter *.java (Join-Path $ROOT 'apk\src') | ForEach-Object { $_.FullName }
& javac -encoding UTF-8 -source 8 -target 8 -bootclasspath $AJ -classpath $AJ -d $classes $srcs
if ($LASTEXITCODE -ne 0) { Write-Error 'javac 失败' }

# 4) d8 → classes.dex 并塞进 base.apk
# build-tools\33.0.2\d8.bat 用了 JDK8 的 java.ext.dirs，JDK17 不支持 → 直接调主类
$d8lib = Join-Path $SDK 'build-tools\33.0.2\lib'
& java -cp "$d8lib\*" com.android.tools.r8.D8 --release --min-api 25 --lib $AJ --output $WORK (Get-ChildItem $classes -Recurse -Filter *.class | ForEach-Object { $_.FullName })
if ($LASTEXITCODE -ne 0) { Write-Error 'd8 失败' }
# 用 .NET zip 把 classes.dex 追加进 base.apk（aapt2 不吃 dex）
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apkPath = Join-Path $WORK 'base.apk'
$zip = [System.IO.Compression.ZipFile]::Open($apkPath, 'Update')
$entry = $zip.CreateEntry('classes.dex')
$fs = [System.IO.File]::OpenRead((Join-Path $WORK 'classes.dex'))
$fs.CopyTo($entry.Open())
$fs.Close()
$zip.Dispose()

# 5) zip 条目分隔符规范化（.NET ZipFile 会保留反斜杠，Android 解压要求 '/'）
$aligned = Join-Path $WORK 'aligned.apk'
$tmpFix = Join-Path $WORK 'fixed.apk'
$src = [System.IO.Compression.ZipFile]::OpenRead($apkPath)
$dst = [System.IO.Compression.ZipFile]::Open($tmpFix, 'Create')
foreach ($e in $src.Entries) {
  $ne = $dst.CreateEntry($e.FullName.Replace('\', '/'))
  $s = $e.Open(); $d = $ne.Open(); $s.CopyTo($d); $d.Close(); $s.Close()
}
$dst.Dispose(); $src.Dispose()
Move-Item $tmpFix $apkPath -Force
& (Join-Path $BT 'zipalign.exe') -f 4 $apkPath $aligned
if ($LASTEXITCODE -ne 0) { Write-Error 'zipalign 失败' }

$keystore = Join-Path $ROOT 'apk\debug.keystore'
if (-not (Test-Path $keystore)) {
  & keytool -genkeypair -keystore $keystore -storepass rwvr123 -keypass rwvr123 `
    -alias rwvr -keyalg RSA -keysize 2048 -validity 10950 `
    -dname 'CN=RandomWalk VR, OU=Dev, O=Pico3D, C=CN'
  if ($LASTEXITCODE -ne 0) { Write-Error 'keytool 失败' }
}
$final = Join-Path $OUT '随机游走VR.apk'
& (Join-Path $BT 'apksigner.bat') sign --ks $keystore --ks-pass pass:rwvr123 --key-pass pass:rwvr123 --out $final $aligned
if ($LASTEXITCODE -ne 0) { Write-Error 'apksigner 失败' }

& (Join-Path $BT 'apksigner.bat') verify $final
Write-Host "`n✅ APK 构建完成: $final ($([Math]::Round((Get-Item $final).Length/1MB,2)) MB)"
Write-Host '安装（头盔开启 USB 调试并授权后）:'
Write-Host "  $SDK\platform-tools\adb.exe install -r `"$final`""
