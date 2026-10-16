// SamSyncSend: the program the Explorer menu and the Notepad++ entries start instead of SamSync.exe.
//
// A running SamSync listens on a named pipe. This program hands it the command line through that pipe in
// a few milliseconds and exits, where starting SamSync.exe itself would boot a whole Electron process (a
// second or so) only to find the app already running. When nothing listens, it starts SamSync.exe next to
// it with the same arguments, exactly as before.
//
// Message: a 4 byte little endian length, then UTF-8 "cwd\0arg1\0arg2\0...\0" (the arguments after the
// program name, split by Windows rules). Built by scripts/build-launcher.mjs with the Visual C++ compiler;
// no window, no console.
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <windows.h>
#include <shellapi.h>

static const wchar_t *PIPE_PREFIX = L"\\\\.\\pipe\\SamSync-";

static int utf8(const wchar_t *s, int wlen, char *out, int cap) {
  return WideCharToMultiByte(CP_UTF8, 0, s, wlen, out, cap, NULL, NULL);
}

/* Appends the UTF-8 form of s plus a NUL to buf; returns the new length, or -1 when it does not fit. */
static int append(char *buf, int len, int cap, const wchar_t *s) {
  int n = utf8(s, -1, buf + len, cap - len); /* -1: converts the terminating NUL too */
  if (n <= 0) return -1;
  return len + n;
}

/* The framed message: length, then the working folder and the arguments after the program name. */
static int build_message(char *buf, int cap) {
  wchar_t cwd[MAX_PATH * 4];
  int argc = 0;
  wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  int len;
  if (!argv) return -1;
  if (!GetCurrentDirectoryW(sizeof(cwd) / sizeof(cwd[0]), cwd)) cwd[0] = 0;
  len = append(buf, 4, cap, cwd);
  for (int i = 1; i < argc && len >= 0; i++) len = append(buf, len, cap, argv[i]);
  LocalFree(argv);
  if (len < 0) return -1;
  {
    DWORD payload = (DWORD)(len - 4);
    buf[0] = (char)(payload & 0xff);
    buf[1] = (char)((payload >> 8) & 0xff);
    buf[2] = (char)((payload >> 16) & 0xff);
    buf[3] = (char)((payload >> 24) & 0xff);
  }
  return len;
}

/* Hands the message to the running app; 1 when it took it. */
static int hand_over(const char *msg, int len) {
  wchar_t name[256];
  wchar_t user[128];
  DWORD n = sizeof(user) / sizeof(user[0]);
  HANDLE pipe;
  DWORD written = 0;
  char ack = 0;
  DWORD got = 0;
  if (!GetUserNameW(user, &n)) return 0;
  lstrcpyW(name, PIPE_PREFIX);
  lstrcatW(name, user);
  for (int attempt = 0; attempt < 3; attempt++) {
    pipe = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (pipe != INVALID_HANDLE_VALUE) break;
    if (GetLastError() != ERROR_PIPE_BUSY) return 0; /* nobody listens */
    WaitNamedPipeW(name, 500); /* every pipe instance is taken by another launcher: wait for one */
  }
  if (pipe == INVALID_HANDLE_VALUE) return 0;
  if (!WriteFile(pipe, msg, (DWORD)len, &written, NULL) || written != (DWORD)len) {
    CloseHandle(pipe);
    return 0;
  }
  /* the app answers one byte once it has the request, so this process can go */
  ReadFile(pipe, &ack, 1, &got, NULL);
  CloseHandle(pipe);
  return got == 1 && ack == '1';
}

/* Starts SamSync.exe next to this program with this program's arguments. */
static int start_app(void) {
  wchar_t exe[MAX_PATH * 4];
  wchar_t *slash;
  const wchar_t *tail;
  wchar_t *cmd;
  size_t n;
  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  BOOL ok;
  DWORD len = GetModuleFileNameW(NULL, exe, sizeof(exe) / sizeof(exe[0]));
  if (!len || len >= sizeof(exe) / sizeof(exe[0])) return 1;
  slash = wcsrchr(exe, L'\\');
  if (!slash) return 1;
  lstrcpyW(slash + 1, L"SamSync.exe");

  /* the original arguments, verbatim: everything after the program name */
  tail = GetCommandLineW();
  if (*tail == L'"') {
    tail++;
    while (*tail && *tail != L'"') tail++;
    if (*tail == L'"') tail++;
  } else {
    while (*tail && *tail != L' ' && *tail != L'\t') tail++;
  }
  while (*tail == L' ' || *tail == L'\t') tail++;

  n = lstrlenW(exe) + lstrlenW(tail) + 8;
  cmd = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, n * sizeof(wchar_t));
  if (!cmd) return 1;
  lstrcpyW(cmd, L"\"");
  lstrcatW(cmd, exe);
  lstrcatW(cmd, L"\" ");
  lstrcatW(cmd, tail);

  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  ZeroMemory(&pi, sizeof(pi));
  ok = CreateProcessW(exe, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi);
  HeapFree(GetProcessHeap(), 0, cmd);
  if (!ok) return 1;
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return 0;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR args, int show) {
  static char msg[64 * 1024];
  int len = build_message(msg, sizeof(msg));
  (void)inst; (void)prev; (void)args; (void)show;
  if (len > 0 && hand_over(msg, len)) return 0;
  return start_app();
}
