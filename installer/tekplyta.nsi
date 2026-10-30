; Instalator TEK-PŁYTA (NSIS) — jeden plik setup.exe.
; Instalacja dla bieżącego użytkownika (bez uprawnień administratora) do %LOCALAPPDATA%\Programs\TEK-PLYTA,
; skróty w Menu Start i na pulpicie, deinstalator, wpis w „Programy i funkcje”.
; Budowa: makensis -DVERSION=0.6.0 -DSRC=dist/TEK-PLYTA -DOUT=dist installer/tekplyta.nsi
Unicode true
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef SRC
  !define SRC "..\dist\TEK-PLYTA"
!endif
!ifndef OUT
  !define OUT "."
!endif
!define APPNAME "TEK-PŁYTA"
!define APPKEY "TEK-PLYTA"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}"

Name "${APPNAME} ${VERSION}"
OutFile "${OUT}\TEK-PLYTA-setup-${VERSION}.exe"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\TEK-PLYTA"
InstallDirRegKey HKCU "Software\TEKTORIA\${APPKEY}" "InstallDir"
SetCompressor /SOLID lzma
BrandingText "TEKTORIA"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\TEK-PLYTA.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Uruchom TEK-PŁYTA"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Polish"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_POLISH} "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_POLISH} "CompanyName" "TEKTORIA"
VIAddVersionKey /LANG=${LANG_POLISH} "FileDescription" "Instalator ${APPNAME}"
VIAddVersionKey /LANG=${LANG_POLISH} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_POLISH} "LegalCopyright" "TEKTORIA"

Section "Program" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /oname=TEK-PLYTA.exe "${SRC}\TEK-PLYTA-win_x64.exe"
  ; zasoby osobno tylko wtedy, gdy nie są wbudowane w .exe (neu build bez --embed-resources)
  File /nonfatal "${SRC}\resources.neu"
  File "icon.ico"
  File "..\THIRD_PARTY_LICENSES.md"
  WriteUninstaller "$INSTDIR\Odinstaluj.exe"
  CreateDirectory "$SMPROGRAMS\TEKTORIA"
  CreateShortcut "$SMPROGRAMS\TEKTORIA\${APPNAME}.lnk" "$INSTDIR\TEK-PLYTA.exe" "" "$INSTDIR\icon.ico"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\TEK-PLYTA.exe" "" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\TEKTORIA\${APPKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "TEKTORIA"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Odinstaluj.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

; Deinstalacja usuwa program i skróty; baza projektów (Dokumenty\TEK-PLYTA) zostaje — to dane użytkownika.
Section "Uninstall"
  Delete "$INSTDIR\TEK-PLYTA.exe"
  Delete "$INSTDIR\resources.neu"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\THIRD_PARTY_LICENSES.md"
  Delete "$INSTDIR\Odinstaluj.exe"
  RMDir /r "$INSTDIR\.storage"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\TEKTORIA\${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\TEKTORIA"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\TEKTORIA\${APPKEY}"
SectionEnd
