// Azan audio playback via Windows MCI (winmm) - supports MP3, WMA, WAV, MIDI and
// anything else the system has a codec for. Works on Windows 7 with no dependencies.
// Rule: Subuh prayer uses the dedicated Subuh file if set; otherwise falls back to
// the general azan file; otherwise the system chime.
using System;
using System.IO;
using System.Media;
using System.Runtime.InteropServices;
using System.Text;

namespace AzanApp
{
    public static class AzanPlayer
    {
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
        private static extern int mciSendString(string command, StringBuilder ret, int retLen, IntPtr hwnd);

        private const string Alias = "AzanAppSnd";

        // Pure pick logic (unit-tested): which file to play for this prayer.
        public static string PickSoundPath(bool subuh, string subuhFile, string generalFile, Predicate<string> exists)
        {
            if (subuh && !string.IsNullOrEmpty(subuhFile) && exists(subuhFile)) return subuhFile;
            if (!string.IsNullOrEmpty(generalFile) && exists(generalFile)) return generalFile;
            return null;
        }

        // Plays the given audio file via MCI; falls back to the system chime when
        // the file is missing or has no codec.
        public static void PlayFile(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
            {
                PlayChime();
                return;
            }
            CloseMci();
            var sb = new StringBuilder(260);
            int r = mciSendString("open \"" + path + "\" alias " + Alias, sb, sb.Capacity, IntPtr.Zero);
            if (r != 0)
            {
                // Retry with the DirectShow-based device for extensions MCI can't map.
                string ext = (Path.GetExtension(path) ?? "").ToLowerInvariant();
                if (ext != ".wav")
                    r = mciSendString("open \"" + path + "\" type mpegvideo alias " + Alias, sb, sb.Capacity, IntPtr.Zero);
                if (r != 0)
                {
                    PlayChime();
                    return;
                }
            }
            r = mciSendString("play " + Alias, null, 0, IntPtr.Zero);
            if (r != 0)
            {
                CloseMci();
                PlayChime();
            }
        }

        public static void Stop()
        {
            CloseMci();
        }

        public static void PlayTick()
        {
            try { SystemSounds.Beep.Play(); }
            catch { }
        }

        private static void CloseMci()
        {
            try { mciSendString("close " + Alias, null, 0, IntPtr.Zero); }
            catch { }
        }

        private static void PlayChime()
        {
            try { SystemSounds.Exclamation.Play(); }
            catch { }
        }
    }
}
