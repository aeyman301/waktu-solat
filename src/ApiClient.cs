// JAKIM API client for api.waktusolat.app with an offline disk cache.
// Endpoints:
//   GET /zones                          -> [{jakimCode, negeri, daerah}, ...]
//   GET /v2/solat/{zone}?year=&month=   -> monthly prayer times (unix seconds, Malaysia time)
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;

namespace AzanApp
{
    public sealed class Zone
    {
        public string Code;
        public string Negeri;
        public string Daerah;
        public override string ToString()
        {
            return Code + " - " + Daerah + " (" + Negeri + ")";
        }
    }

    public sealed class DayTimes
    {
        public int Day;
        public string Hijri;
        public long Imsak, Fajr, Syuruk, Dhuha, Dhuhr, Asr, Maghrib, Isha; // unix seconds

        public static DayTimes FromJson(Dictionary<string, object> o)
        {
            var d = new DayTimes
            {
                Day = (int)Json.Long(o, "day"),
                Hijri = Json.Str(o, "hijri"),
                Imsak = Json.Long(o, "imsak"),
                Fajr = Json.Long(o, "fajr"),
                Syuruk = Json.Long(o, "syuruk"),
                Dhuha = Json.Long(o, "dhuha"),
                Dhuhr = Json.Long(o, "dhuhr"),
                Asr = Json.Long(o, "asr"),
                Maghrib = Json.Long(o, "maghrib"),
                Isha = Json.Long(o, "isha")
            };
            return d;
        }
    }

    public sealed class MonthTimes
    {
        public string Zone;
        public int Year, Month;
        public List<DayTimes> Days = new List<DayTimes>();
        public DateTime FetchedUtc = DateTime.UtcNow;
    }

    public static class ApiClient
    {
        private const string Base = "https://api.waktusolat.app";
        public static string CacheDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AzanMalaysia", "cache");

        private static bool _tls12Done;
        private static void EnsureTls12()
        {
            if (_tls12Done) return;
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls; }
            catch { }
            ServicePointManager.ServerCertificateValidationCallback = null;
            _tls12Done = true;
        }

        private static string HttpGet(string url)
        {
            EnsureTls12();
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.UserAgent = "AzanMalaysia/1.0";
            req.Timeout = 15000;
            req.ReadWriteTimeout = 15000;
            req.KeepAlive = false;
            req.ProtocolVersion = HttpVersion.Version11;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var rs = resp.GetResponseStream())
            using (var reader = new StreamReader(rs, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static void TrySetLength(string path, long len)
        {
            try
            {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.None))
                {
                    fs.SetLength(len);
                }
            }
            catch { }
        }

        public static List<Zone> GetZones()
        {
            string url = Base + "/zones";
            string cacheFile = Path.Combine(CacheDir, "zones.json");
            string body;
            try
            {
                body = HttpGet(url);
                Json.ParseArray(body); // validate
                try
                {
                    Directory.CreateDirectory(CacheDir);
                    File.WriteAllText(cacheFile, body, Encoding.UTF8);
                }
                catch { }
            }
            catch
            {
                if (File.Exists(cacheFile))
                {
                    body = File.ReadAllText(cacheFile, Encoding.UTF8);
                }
                else throw;
            }
            var outZones = new List<Zone>();
            var arr = Json.ParseArray(body);
            foreach (var item in arr)
            {
                var o = item as Dictionary<string, object>;
                if (o == null) continue;
                outZones.Add(new Zone
                {
                    Code = Json.Str(o, "jakimCode"),
                    Negeri = Json.Str(o, "negeri"),
                    Daerah = Json.Str(o, "daerah")
                });
            }
            return outZones;
        }

        public static MonthTimes GetMonth(string zone, int year, int month)
        {
            string url = Base + "/v2/solat/" + zone + "?year=" + year + "&month=" + month;
            string cacheFile = Path.Combine(CacheDir,
                zone + "_" + year.ToString("0000", CultureInfo.InvariantCulture) + "_" + month.ToString("00", CultureInfo.InvariantCulture) + ".json");
            string body;
            bool fromCache = false;
            try
            {
                body = HttpGet(url);
                Json.ParseObject(body); // validate
                try
                {
                    Directory.CreateDirectory(CacheDir);
                    File.WriteAllText(cacheFile, body, Encoding.UTF8);
                }
                catch { }
            }
            catch
            {
                if (File.Exists(cacheFile))
                {
                    body = File.ReadAllText(cacheFile, Encoding.UTF8);
                    fromCache = true;
                }
                else throw;
            }
            var o = Json.ParseObject(body);
            var mt = new MonthTimes
            {
                Zone = Json.Str(o, "zone") ?? zone,
                Year = (int)Json.Long(o, "year"),
                Month = (int)Json.Long(o, "month_number"),
                FetchedUtc = fromCache ? File.GetLastWriteTimeUtc(cacheFile) : DateTime.UtcNow
            };
            if (mt.Year == 0) mt.Year = year;
            if (mt.Month == 0) mt.Month = month;
            object daysObj;
            if (o.TryGetValue("prayers", out daysObj) && daysObj is List<object>)
            {
                foreach (var item in (List<object>)daysObj)
                {
                    var d = item as Dictionary<string, object>;
                    if (d != null) mt.Days.Add(DayTimes.FromJson(d));
                }
            }
            return mt;
        }

        // Pure testable helper: build request URL.
        public static string BuildMonthUrl(string zone, int year, int month)
        {
            return "/v2/solat/" + zone + "?year=" + year.ToString(CultureInfo.InvariantCulture)
                 + "&month=" + month.ToString(CultureInfo.InvariantCulture);
        }
    }
}
