// Settings persisted in %LocalAppData%\AzanMalaysia\settings.txt (INI-like, no registry dependency).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace AzanApp
{
    public sealed class Settings
    {
        public string Zone = "SGR01";
        public bool AzanEnabled = true;
        public int AzanOffsetSeconds = 0; // 0 = at azan time; negative = before
        public bool NotifySyuruk = true;
        public bool StartMinimized = true;
        public bool AutoStart = false;
        public string AzanFile = "";       // general azan audio (mp3/wav/wma/...)
        public string SubuhFile = "";      // dedicated Subuh azan audio (optional)

        public string FilePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AzanMalaysia", "settings.txt");

        public static Settings Load()
        {
            var s = new Settings();
            try
            {
                if (File.Exists(s.FilePath))
                {
                    foreach (var line in File.ReadAllLines(s.FilePath, Encoding.UTF8))
                    {
                        int eq = line.IndexOf('=');
                        if (eq <= 0) continue;
                        string k = line.Substring(0, eq).Trim();
                        string v = line.Substring(eq + 1).Trim();
                        switch (k)
                        {
                            case "zone": s.Zone = v; break;
                            case "azanEnabled": s.AzanEnabled = v == "1"; break;
                            case "azanOffsetSeconds": int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out s.AzanOffsetSeconds); break;
                            case "notifySyuruk": s.NotifySyuruk = v == "1"; break;
                            case "startMinimized": s.StartMinimized = v == "1"; break;
                            case "autoStart": s.AutoStart = v == "1"; break;
                            case "azanFile": s.AzanFile = v; break;
                            case "subuhFile": s.SubuhFile = v; break;
                        }
                    }
                }
            }
            catch { }
            return s;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                var sb = new StringBuilder();
                sb.AppendLine("zone=" + Zone);
                sb.AppendLine("azanEnabled=" + (AzanEnabled ? "1" : "0"));
                sb.AppendLine("azanOffsetSeconds=" + AzanOffsetSeconds.ToString(CultureInfo.InvariantCulture));
                sb.AppendLine("notifySyuruk=" + (NotifySyuruk ? "1" : "0"));
                sb.AppendLine("startMinimized=" + (StartMinimized ? "1" : "0"));
                sb.AppendLine("autoStart=" + (AutoStart ? "1" : "0"));
                sb.AppendLine("azanFile=" + (AzanFile ?? ""));
                sb.AppendLine("subuhFile=" + (SubuhFile ?? ""));
                File.WriteAllText(FilePath, sb.ToString(), Encoding.UTF8);
            }
            catch { }
        }

        // Pure parse helper for tests.
        public static void ApplyLine(Settings s, string line)
        {
            int eq = line.IndexOf('=');
            if (eq <= 0) return;
            string k = line.Substring(0, eq).Trim();
            string v = line.Substring(eq + 1).Trim();
            if (k == "zone") s.Zone = v;
            if (k == "subuhFile") s.SubuhFile = v;
        }
    }
}
