// Self-test mode (`AzanApp.exe --selftest`): verifies JSON parsing, time conversion,
// event scheduling logic, and performs a live call against the API.
using System;
using System.Collections.Generic;
using System.Globalization;
namespace AzanApp
{
    public static class SelfTest
    {
        private static int _fail;
        private static void Check(bool ok, string name)
        {
            Console.WriteLine((ok ? "PASS  " : "FAIL  ") + name);
            if (!ok) _fail++;
        }

        public static int RunAll()
        {
            Console.WriteLine("Azan Malaysia self-test");
            Console.WriteLine(new string('-', 60));

            // 1. JSON parse: zones
            try
            {
                var zones = ApiClient.GetZones();
                Check(zones != null && zones.Count >= 59,
                    "GET /zones -> " + (zones == null ? 0 : zones.Count) + " zones");
                var sgr = zones.Find(z => z.Code == "SGR01");
                Check(sgr != null && !string.IsNullOrEmpty(sgr.Negeri) && !string.IsNullOrEmpty(sgr.Daerah),
                    "zone SGR01 present: " + (sgr == null ? "?" : sgr.Negeri + " / " + sgr.Daerah));
            }
            catch (Exception ex)
            {
                Check(false, "GET /zones threw: " + ex.Message);
            }

            // 2. Month fetch + parse
            DateTime nowM = DateTime.UtcNow.AddHours(8);
            try
            {
                var mt = ApiClient.GetMonth("SGR01", nowM.Year, nowM.Month);
                Check(mt != null && mt.Days.Count >= 28,
                    "GET /v2/solat/SGR01 -> " + (mt == null ? 0 : mt.Days.Count) + " days");
                DayTimes d1 = mt != null && mt.Days.Count > 0 ? mt.Days[0] : null;
                Check(d1 != null && d1.Fajr > 0 && d1.Maghrib > d1.Fajr && d1.Isha > d1.Maghrib,
                    "day 1 ordering fajr<maghrib<isha: " +
                    (d1 == null ? "?" :
                     TimeUtil.Hm(TimeUtil.ToMalaysia(d1.Fajr)) + "<" +
                     TimeUtil.Hm(TimeUtil.ToMalaysia(d1.Maghrib)) + "<" +
                     TimeUtil.Hm(TimeUtil.ToMalaysia(d1.Isha))));
                Check(d1 != null && d1.Syuruk > d1.Fajr && d1.Dhuhr > d1.Syuruk
                    && d1.Asr > d1.Dhuhr && d1.Maghrib > d1.Asr,
                    "day 1 full ordering subuh<syuruk<zohor<asar<maghrib");
            }
            catch (Exception ex)
            {
                Check(false, "GET month threw: " + ex.Message);
            }

            // 3. Time conversion: fixed timestamp -> UTC+8, 12-hour display
            // 1790852820 = day-1 maghrib (SGR01 Oct 2026) should be 7:07 PM MYT.
            var maghribM = TimeUtil.ToMalaysia(1790852820);
            Check(maghribM.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) == "2026-10-01"
                && maghribM.ToString("h:mm tt", CultureInfo.InvariantCulture) == "7:07 PM",
                "unix 1790852820 -> " + maghribM.ToString("yyyy-MM-dd h:mm tt", CultureInfo.InvariantCulture) + " MYT (expect 2026-10-01 7:07 PM)");

            // 3b. 12-hour formatting edges: midnight, noon, sub-noon
            Check(TimeUtil.Hm(new DateTime(2026, 10, 1, 0, 5, 0)) == "12:05 AM"
                && TimeUtil.Hm(new DateTime(2026, 10, 1, 5, 53, 0)) == "5:53 AM"
                && TimeUtil.Hm(new DateTime(2026, 10, 1, 12, 0, 0)) == "12:00 PM"
                && TimeUtil.Hm(new DateTime(2026, 10, 1, 19, 7, 0)) == "7:07 PM",
                "Hm 12-hour edges: " + TimeUtil.Hm(new DateTime(2026, 10, 1, 0, 5, 0)) + ", "
                + TimeUtil.Hm(new DateTime(2026, 10, 1, 5, 53, 0)) + ", "
                + TimeUtil.Hm(new DateTime(2026, 10, 1, 12, 0, 0)) + ", "
                + TimeUtil.Hm(new DateTime(2026, 10, 1, 19, 7, 0)));

            // 4. NextEvent logic on synthetic month data.
            var mt2 = new MonthTimes { Zone = "TST", Year = nowM.Year, Month = nowM.Month };
            long baseSec = TimeUtil.ToUnix(DateTime.UtcNow.Date) - 8 * 3600; // today's MYT midnight in unix
            Func<long, DayTimes> mkDay = delegate(long day)
            {
                long b = baseSec + (day - 1) * 86400;
                return new DayTimes
                {
                    Day = (int)day,
                    Imsak = b + 6 * 3600 + 1800, // 05:55:30 approx; exact values irrelevant
                    Fajr = b + 6 * 3600,
                    Syuruk = b + 7 * 3600 + 1200,
                    Dhuha = b + 7 * 3600 + 3600,
                    Dhuhr = b + 13 * 3600 + 180,
                    Asr = b + 16 * 3600 + 2400,
                    Maghrib = b + 19 * 3600 + 240,
                    Isha = b + 20 * 3600 + 360
                };
            };
            for (long day = 1; day <= 31; day++) mt2.Days.Add(mkDay(day));

            // 4a: before subuh -> today's Subuh
            DateTime t = TimeUtil.ToUtc(baseSec + 3 * 3600); // 11:00 MYT
            var ev = TimeUtil.NextEvent(mt2, t);
            Check(ev != null && ev.Name == "Subuh", "11:00 MYT next = Subuh (got " + (ev == null ? "null" : ev.Name) + ")");

            // 4b: after isya -> tomorrow's Subuh
            t = TimeUtil.ToUtc(baseSec + 21 * 3600);
            ev = TimeUtil.NextEvent(mt2, t);
            Check(ev != null && ev.Name == "Subuh" && ev.Day.Day == DateTime.UtcNow.AddHours(8).Day + 1,
                "21:00 MYT next = tomorrow Subuh (got " + (ev == null ? "null" : ev.Name + " d" + ev.Day.Day) + ")");

            // 4c: just before maghrib
            t = TimeUtil.ToUtc(baseSec + 19 * 3600 + 60);
            ev = TimeUtil.NextEvent(mt2, t);
            Check(ev != null && ev.Name == "Maghrib", "19:01 MYT next = Maghrib (got " + (ev == null ? "null" : ev.Name) + ")");

            // 4d: firing window simulation - DueEvent + dedup guard. The azan must fire
            // exactly once, on the first tick at/after the prayer time (within 600s grace).
            var seen = new List<string>();
            var fired = new HashSet<long>();
            var maghrib = mt2.Days[0];
            long maghribUnix = maghrib.Maghrib;
            for (long s = maghribUnix - 40; s <= maghribUnix + 40; s++)
            {
                DateTime tick = TimeUtil.ToUtc(s);
                var e2 = TimeUtil.DueEvent(mt2, tick, 600);
                if (e2 == null || e2.Name != "Maghrib" || e2.Day.Day != 1) continue;
                long until = (long)(e2.TimeUtc - tick).TotalSeconds;
                if (fired.Contains(e2.TimeUtc.Ticks)) continue;
                fired.Add(e2.TimeUtc.Ticks);
                seen.Add(until.ToString(CultureInfo.InvariantCulture));
            }
            Check(seen.Count == 1 && seen[0] == "0",
                "azan fires exactly once, at due tick (fired count=" + seen.Count + ", first until=" + (seen.Count > 0 ? seen[0] : "?") + ")");

            // 4e: the OLD bug - at exactly the prayer second, NextEvent already moved on
            t = TimeUtil.ToUtc(maghribUnix);
            var due = TimeUtil.DueEvent(mt2, t, 600);
            var nxt = TimeUtil.NextEvent(mt2, t);
            Check(due != null && due.Name == "Maghrib" && nxt != null && nxt.Name == "Isyak",
                "at exact prayer second: DueEvent=Maghrib (fires), NextEvent=Isyak (countdown)");

            // 4f: grace window - >600s past, no longer fires (e.g. PC was asleep)
            t = TimeUtil.ToUtc(maghribUnix + 700);
            due = TimeUtil.DueEvent(mt2, t, 600);
            Check(due == null, "11m39s after maghrib: DueEvent expired (got " + (due == null ? "null" : due.Name) + ")");

            // 5. URL builder
            Check(ApiClient.BuildMonthUrl("SGR01", 2026, 10) == "/v2/solat/SGR01?year=2026&month=10",
                "BuildMonthUrl == " + ApiClient.BuildMonthUrl("SGR01", 2026, 10));

            // 6. Settings round-trip parse
            var st = new Settings();
            Settings.ApplyLine(st, "zone=KTN01");
            Settings.ApplyLine(st, "subuhFile=C:\\azan\\subuh.mp3");
            Check(st.Zone == "KTN01" && st.SubuhFile == "C:\\azan\\subuh.mp3",
                "settings parse zone + subuhFile");

            // 7. Per-prayer sound pick rule: Subuh file > general file > chime (null)
            var existing = new List<string> { @"C:\s\subuh.mp3", @"C:\g\azan.mp3" };
            Predicate<string> exists = delegate(string p) { return existing.Contains(p); };
            var pick = AzanPlayer.PickSoundPath(true, @"C:\s\subuh.mp3", @"C:\g\azan.mp3",
                exists);
            Check(pick == @"C:\s\subuh.mp3", "Subuh prayer uses dedicated subuh.mp3 (got " + (pick ?? "null") + ")");
            pick = AzanPlayer.PickSoundPath(false, @"C:\s\subuh.mp3", @"C:\g\azan.mp3",
                exists);
            Check(pick == @"C:\g\azan.mp3", "non-Subuh prayer uses general azan.mp3 (got " + (pick ?? "null") + ")");
            pick = AzanPlayer.PickSoundPath(true, @"C:\s\missing.mp3", @"C:\g\azan.mp3",
                exists);
            Check(pick == @"C:\g\azan.mp3", "missing Subuh file falls back to general (got " + (pick ?? "null") + ")");
            pick = AzanPlayer.PickSoundPath(true, null, null, p => true);
            Check(pick == null, "no files configured -> chime (got " + (pick == null ? "null" : pick) + ")");

            Console.WriteLine(new string('-', 60));
            Console.WriteLine(_fail == 0 ? "ALL TESTS PASSED" : _fail + " TEST(S) FAILED");
            return _fail == 0 ? 0 : 1;
        }
    }
}

