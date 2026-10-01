// Time zone helpers. API timestamps are Unix seconds in Malaysia time (UTC+8).
// We convert to UTC by subtracting 8h, so all comparisons use UTC internally.
using System;
using System.Globalization;

namespace AzanApp
{
    public static class TimeUtil
    {
        public static readonly TimeSpan MalaysiaOffset = new TimeSpan(8, 0, 0);

        // unix seconds -> UTC DateTime
        public static DateTime ToUtc(long unixSeconds)
        {
            return UnixEpoch + TimeSpan.FromSeconds(unixSeconds);
        }

        // unix seconds -> Malaysia local wall clock
        public static DateTime ToMalaysia(long unixSeconds)
        {
            return ToUtc(unixSeconds) + MalaysiaOffset;
        }

        public static DateTime UnixEpoch
        {
            get { return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc); }
        }

        public static long ToUnix(DateTime utc)
        {
            return (long)Math.Round((utc - UnixEpoch).TotalSeconds);
        }

        public static string Hm(DateTime t)
        {
            return t.ToString("h:mm tt", CultureInfo.InvariantCulture);
        }

        public static string Hms(DateTime t)
        {
            return t.ToString("h:mm:ss tt", CultureInfo.InvariantCulture);
        }

        // Next prayer event (fajr/syuruk/dhuhr/asr/maghrib/isha) strictly after 'nowUtc' from this month's data.
        // May return null if none found (caller should fetch next month).
        public static PrayerEvent NextEvent(MonthTimes mt, DateTime nowUtc)
        {
            foreach (var d in mt.Days)
            {
                var e = NextEventInDay(d, nowUtc);
                if (e != null) return e;
            }
            return null;
        }

        public static PrayerEvent NextEventInDay(DayTimes d, DateTime nowUtc)
        {
            if (d.Fajr > TimeUtil.ToUnix(nowUtc)) return new PrayerEvent("Subuh", ToUtc(d.Fajr), d);
            if (d.Syuruk > TimeUtil.ToUnix(nowUtc)) return new PrayerEvent("Syuruk", ToUtc(d.Syuruk), d);
            if (d.Dhuhr > TimeUtil.ToUnix(nowUtc)) return new PrayerEvent("Zohor", ToUtc(d.Dhuhr), d);
            if (d.Asr > TimeUtil.ToUnix(nowUtc)) return new PrayerEvent("Asar", ToUtc(d.Asr), d);
            if (d.Maghrib > TimeUtil.ToUnix(nowUtc)) return new PrayerEvent("Maghrib", ToUtc(d.Maghrib), d);
            if (d.Isha > TimeUtil.ToUnix(nowUtc)) return new PrayerEvent("Isyak", ToUtc(d.Isha), d);
            return null;
        }

        // The event whose time has just arrived/passed (within 'graceSeconds'), used for FIRING the azan.
        // Distinct from NextEvent: at exactly the prayer second, NextEvent has already moved on,
        // but DueEvent still returns that prayer so it can fire.
        public static PrayerEvent DueEvent(MonthTimes mt, DateTime nowUtc, int graceSeconds)
        {
            foreach (var d in mt.Days)
            {
                var e = DueEventInDay(d, nowUtc, graceSeconds);
                if (e != null) return e;
            }
            return null;
        }

        public static PrayerEvent DueEventInDay(DayTimes d, DateTime nowUtc, int graceSeconds)
        {
            long now = ToUnix(nowUtc);
            PrayerEvent best = null;
            best = PickDue(d, d.Fajr, "Subuh", now, graceSeconds, best);
            best = PickDue(d, d.Syuruk, "Syuruk", now, graceSeconds, best);
            best = PickDue(d, d.Dhuhr, "Zohor", now, graceSeconds, best);
            best = PickDue(d, d.Asr, "Asar", now, graceSeconds, best);
            best = PickDue(d, d.Maghrib, "Maghrib", now, graceSeconds, best);
            best = PickDue(d, d.Isha, "Isyak", now, graceSeconds, best);
            return best;
        }

        private static PrayerEvent PickDue(DayTimes d, long t, string name, long now, int graceSeconds, PrayerEvent best)
        {
            long delta = now - t;
            if (delta < 0 || delta > graceSeconds) return best;
            if (best == null) return new PrayerEvent(name, ToUtc(t), d);
            long bestDelta = now - ToUnix(best.TimeUtc);
            return delta < bestDelta ? new PrayerEvent(name, ToUtc(t), d) : best; // most recent wins
        }
    }

    public sealed class PrayerEvent
    {
        public string Name;
        public DateTime TimeUtc;
        public DayTimes Day;

        public PrayerEvent(string name, DateTime timeUtc, DayTimes day)
        {
            Name = name;
            TimeUtc = timeUtc;
            Day = day;
        }

        public DateTime Malaysia
        {
            get { return TimeUtc + TimeUtil.MalaysiaOffset; }
        }
    }
}
