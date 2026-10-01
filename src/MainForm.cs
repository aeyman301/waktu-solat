// Main application form: monthly prayer-time grid, next-prayer countdown,
// zone selection, settings, tray icon behaviour, and azan scheduling.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Media;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AzanApp
{
    public sealed class MainForm : Form
    {
        private readonly Settings _settings = Settings.Load();

        private readonly NotifyIcon _tray = new NotifyIcon();
        private readonly ContextMenuStrip _trayMenu = new ContextMenuStrip();
        private PopupForm _popup;

        private readonly ComboBox _zoneBox = new ComboBox();
        private readonly ComboBox _monthBox = new ComboBox();
        private readonly ComboBox _yearBox = new ComboBox();
        private readonly Button _refreshBtn = new Button();
        private readonly ListView _grid = new ListView();
        private readonly Label _nextLabel = new Label();
        private readonly Label _statusLabel = new Label();
        private readonly CheckBox _azanCheck = new CheckBox();
        private readonly CheckBox _syurukCheck = new CheckBox();
        private readonly CheckBox _autoStartCheck = new CheckBox();
        private readonly CheckBox _startMinCheck = new CheckBox();
        private readonly Button _testAzanBtn = new Button();
        private readonly Button _pickWavBtn = new Button();
        private readonly Button _pickSubuhBtn = new Button();
        private readonly Button _clearSubuhBtn = new Button();

        private List<Zone> _zones;
        private MonthTimes _current;
        private MonthTimes _nextMonth;        // prefetched adjacent month for rollover
        private System.Windows.Forms.Timer _timer;
        private DateTime _lastFiredKey;         // exact time of azan already fired
        private DateTime _lastTickFired;        // exact time of 30s beep already fired
        private bool _loading;
        private bool _closeToTrayConfirmed;

        public MainForm()
        {
            Text = "Waktu Solat Malaysia (JAKIM)";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(760, 560);
            MinimumSize = new Size(640, 480);
            Font = new Font("Segoe UI", 9F);
            Icon = TryExtractIcon();
            FormClosing += OnFormClosing;
            Load += OnLoad;
            BuildUi();
            BuildTray();
        }

        private static Icon TryExtractIcon()
        {
            try
            {
                return Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
            }
            catch { return SystemIcons.Application; }
        }

        // ---------------- UI ----------------
        private void BuildUi()
        {
            var top = new Panel { Dock = DockStyle.Top, Height = 96, Padding = new Padding(10, 8, 10, 0) };
            Controls.Add(top);

            var lblZone = new Label { Text = "Zon:", AutoSize = true, Location = new Point(10, 14) };
            _zoneBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _zoneBox.SetBounds(48, 10, 430, 23);
            _zoneBox.SelectedIndexChanged += delegate
            {
                if (_loading || _zones == null) return;
                var z = _zoneBox.SelectedItem as Zone;
                if (z == null) return;
                _settings.Zone = z.Code;
                _settings.Save();
                _nextMonth = null;      // stale zone data
                _lastFiredKey = DateTime.MinValue;  // allow azan in new zone
                _lastTickFired = DateTime.MinValue;
                LoadMonth();
            };

            var lblMonth = new Label { Text = "Bulan:", AutoSize = true, Location = new Point(492, 14) };
            _monthBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _monthBox.SetBounds(538, 10, 90, 23);
            for (int m = 1; m <= 12; m++)
                _monthBox.Items.Add(new DateTime(2000, m, 1).ToString("MMM", CultureInfo.InvariantCulture));
            _monthBox.SelectedIndex = DateTime.UtcNow.AddHours(8).Month - 1;
            _monthBox.SelectedIndexChanged += delegate { if (!_loading) LoadMonth(); };

            _yearBox.DropDownStyle = ComboBoxStyle.DropDownList;
            _yearBox.SetBounds(636, 10, 80, 23);
            int thisYear = DateTime.UtcNow.AddHours(8).Year;
            for (int y = thisYear - 1; y <= thisYear + 1; y++) _yearBox.Items.Add(y);
            _yearBox.SelectedIndex = 1;
            _yearBox.SelectedIndexChanged += delegate { if (!_loading) LoadMonth(); };

            _refreshBtn.Text = "Muat semula";
            _refreshBtn.SetBounds(48, 44, 120, 28);
            _refreshBtn.Click += delegate { LoadMonth(); };

            _nextLabel.Font = new Font("Segoe UI", 11F, FontStyle.Bold);
            _nextLabel.ForeColor = Color.FromArgb(16, 92, 60);
            _nextLabel.AutoSize = true;
            _nextLabel.SetBounds(184, 48, 400, 24);

            _statusLabel.ForeColor = Color.DimGray;
            _statusLabel.AutoSize = true;
            _statusLabel.SetBounds(184, 72, 500, 18);

            top.Controls.Add(lblZone);
            top.Controls.Add(_zoneBox);
            top.Controls.Add(lblMonth);
            top.Controls.Add(_monthBox);
            top.Controls.Add(_yearBox);
            top.Controls.Add(_refreshBtn);
            top.Controls.Add(_nextLabel);
            top.Controls.Add(_statusLabel);

            _grid.Dock = DockStyle.Fill;
            _grid.View = View.Details;
            _grid.FullRowSelect = true;
            _grid.HideSelection = true;
            _grid.HeaderStyle = ColumnHeaderStyle.Nonclickable;
            _grid.Columns.Add("Hari", 52);
            _grid.Columns.Add("Hijri", 110);
            _grid.Columns.Add("Imsak", 62);
            _grid.Columns.Add("Subuh", 62);
            _grid.Columns.Add("Syuruk", 62);
            _grid.Columns.Add("Zohor", 62);
            _grid.Columns.Add("Asar", 62);
            _grid.Columns.Add("Maghrib", 68);
            _grid.Columns.Add("Isyak", 62);
            _grid.RetrieveVirtualItem += GridRetrieveItem;
            _grid.VirtualMode = true;
            _grid.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.Control && e.KeyCode == Keys.C && _grid.SelectedIndices.Count > 0)
                {
                    try { Clipboard.SetText(_grid.SelectedIndices[0].ToString()); } catch { }
                }
            };

            var bottom = new Panel { Dock = DockStyle.Bottom, Height = 74, Padding = new Padding(10, 6, 10, 8) };
            _azanCheck.Text = "Bunyikan Azan";
            _azanCheck.AutoSize = true;
            _azanCheck.SetBounds(10, 8, 120, 20);
            _azanCheck.CheckedChanged += delegate
            {
                _settings.AzanEnabled = _azanCheck.Checked;
                _settings.Save();
            };

            _syurukCheck.Text = "Pemberitahuan Imsak/Syuruk";
            _syurukCheck.AutoSize = true;
            _syurukCheck.SetBounds(140, 8, 240, 20);
            _syurukCheck.CheckedChanged += delegate
            {
                _settings.NotifySyuruk = _syurukCheck.Checked;
                _settings.Save();
            };

            _startMinCheck.Text = "Mula seminimumkan ke tray";
            _startMinCheck.AutoSize = true;
            _startMinCheck.SetBounds(400, 8, 220, 20);
            _startMinCheck.CheckedChanged += delegate
            {
                _settings.StartMinimized = _startMinCheck.Checked;
                _settings.Save();
            };

            _autoStartCheck.Text = "Jalankan automatik semasa Windows mula";
            _autoStartCheck.AutoSize = true;
            _autoStartCheck.SetBounds(10, 38, 300, 20);
            _autoStartCheck.CheckedChanged += delegate
            {
                _settings.AutoStart = _autoStartCheck.Checked;
                _settings.Save();
                SetAutoStart(_autoStartCheck.Checked);
            };

            _testAzanBtn.Text = "Uji Azan";
            _testAzanBtn.SetBounds(400, 34, 80, 26);
            _testAzanBtn.Click += delegate { TestPlay(false); };

            _pickWavBtn.Text = "Pilih azan...";
            _pickWavBtn.SetBounds(490, 34, 105, 26);
            _pickWavBtn.Click += delegate { PickAudio(false); };

            _pickSubuhBtn.Text = "Pilih azan Subuh...";
            _pickSubuhBtn.SetBounds(605, 34, 130, 26);
            _pickSubuhBtn.Click += delegate { PickAudio(true); };

            _clearSubuhBtn.Text = "X";
            _clearSubuhBtn.SetBounds(738, 34, 24, 26);
            _clearSubuhBtn.Click += delegate
            {
                _settings.SubuhFile = "";
                _settings.Save();
                _statusLabel.Text = "Azan Subuh dikosongkan - guna azan biasa.";
            };

            bottom.Controls.Add(_azanCheck);
            bottom.Controls.Add(_syurukCheck);
            bottom.Controls.Add(_startMinCheck);
            bottom.Controls.Add(_autoStartCheck);
            bottom.Controls.Add(_testAzanBtn);
            bottom.Controls.Add(_pickWavBtn);
            bottom.Controls.Add(_pickSubuhBtn);
            bottom.Controls.Add(_clearSubuhBtn);

            Controls.Add(_grid);
            Controls.Add(bottom);
            Controls.Add(top);
        }

        private void PickAudio(bool subuh)
        {
            using (var dlg = new OpenFileDialog())
            {
                dlg.Title = subuh ? "Pilih azan Subuh (.mp3/.wav/.wma/...)" : "Pilih fail azan (.mp3/.wav/.wma/...)";
                dlg.Filter = "Audio (mp3, wav, wma, m4a, midi)|*.mp3;*.wav;*.wma;*.m4a;*.mid;*.midi|MP3|*.mp3|Wave|*.wav|Semua fail|*.*";
                if (dlg.ShowDialog(this) == DialogResult.OK)
                {
                    if (subuh)
                    {
                        _settings.SubuhFile = dlg.FileName;
                        _settings.Save();
                        _statusLabel.Text = "Azan Subuh: " + dlg.FileName;
                    }
                    else
                    {
                        _settings.AzanFile = dlg.FileName;
                        _settings.Save();
                        _statusLabel.Text = "Azan biasa: " + dlg.FileName;
                    }
                }
            }
        }

        // Plays the right file for the given prayer type (Subuh vs other) exactly as firing does.
        private void TestPlay(bool subuh)
        {
            string path = AzanPlayer.PickSoundPath(subuh, _settings.SubuhFile, _settings.AzanFile, File.Exists);
            if (path == null)
            {
                _statusLabel.Text = subuh
                    ? "Tiada fail azan Subuh - akan guna azan biasa / bunyi sistem."
                    : "Tiada fail azan - akan guna bunyi sistem.";
            }
            else
            {
                _statusLabel.Text = "Memainkan: " + path;
            }
            AzanPlayer.PlayFile(path);
        }

        private void BuildTray()
        {
            _tray.Text = "Waktu Solat Malaysia";
            _tray.Icon = Icon;
            _tray.Visible = true;
            _tray.DoubleClick += delegate { RestoreFromTray(); };

            _trayMenu.Items.Add("Buka", null, delegate { RestoreFromTray(); });
            _trayMenu.Items.Add(new ToolStripSeparator());
            _trayMenu.Items.Add("Uji Azan", null, delegate { TestPlay(false); });
            _trayMenu.Items.Add(new ToolStripSeparator());
            _trayMenu.Items.Add("Keluar", null, delegate
            {
                _closeToTrayConfirmed = true;
                _tray.Visible = false;
                Close();
            });
            _tray.ContextMenuStrip = _trayMenu;
        }

        private void RestoreFromTray()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        // ---------------- lifecycle ----------------
        private void OnLoad(object sender, EventArgs e)
        {
            _azanCheck.Checked = _settings.AzanEnabled;
            _syurukCheck.Checked = _settings.NotifySyuruk;
            _startMinCheck.Checked = _settings.StartMinimized;
            _autoStartCheck.Checked = IsAutoStartSet();

            if (_settings.StartMinimized)
            {
                WindowState = FormWindowState.Minimized;
                Hide();
            }

            _timer = new System.Windows.Forms.Timer { Interval = 1000 };
            _timer.Tick += delegate { OnTick(); };
            _timer.Start();

            // Load zone list on a worker thread; UI thread updates the combo.
            ThreadPool.QueueUserWorkItem(delegate
            {
                List<Zone> zones = null;
                Exception err = null;
                try { zones = ApiClient.GetZones(); }
                catch (Exception ex) { err = ex; }
                BeginInvoke((MethodInvoker)delegate
                {
                    if (err != null)
                    {
                        _statusLabel.Text = "Gagal memuatkan senarai zon: " + err.Message;
                        return;
                    }
                    _zones = zones;
                    _loading = true;
                    _zoneBox.Items.Clear();
                    foreach (var z in zones) _zoneBox.Items.Add(z);
                    int idx = 0;
                    for (int i = 0; i < zones.Count; i++)
                        if (zones[i].Code == _settings.Zone) { idx = i; break; }
                    _zoneBox.SelectedIndex = idx;
                    _loading = false;
                    LoadMonth();
                });
            });
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && !_closeToTrayConfirmed)
            {
                e.Cancel = true;
                Hide();
                return;
            }
            if (_timer != null) _timer.Stop();
            _tray.Visible = false;
        }

        // ---------------- data ----------------
        private void LoadMonth()
        {
            var z = _zoneBox.SelectedItem as Zone;
            if (z == null) return;
            int year = _yearBox.SelectedIndex >= 0 ? (int)_yearBox.SelectedItem : DateTime.UtcNow.Year;
            int month = _monthBox.SelectedIndex + 1;

            _statusLabel.Text = "Memuatkan " + z.Code + " " + month + "/" + year + " ...";
            _grid.VirtualListSize = 0;

            ThreadPool.QueueUserWorkItem(delegate
            {
                MonthTimes mt = null;
                Exception err = null;
                try { mt = ApiClient.GetMonth(z.Code, year, month); }
                catch (Exception ex) { err = ex; }
                BeginInvoke((MethodInvoker)delegate
                {
                    if (err != null)
                    {
                        _statusLabel.Text = "Ralat: " + err.Message + " (tiada sambungan?)";
                        return;
                    }
                    _current = mt;
                    RenderMonth();
                    OnTick(); // refresh countdown immediately
                });
            });
        }

        private void RenderMonth()
        {
            if (_current == null) return;
            _grid.BeginUpdate();
            _grid.VirtualListSize = _current.Days.Count;

            int todayM = DateTime.UtcNow.AddHours(8).Day;
            bool isCurrentMonth = _current.Month == DateTime.UtcNow.AddHours(8).Month
                               && _current.Year == DateTime.UtcNow.AddHours(8).Year;

            if (isCurrentMonth)
            {
                for (int i = 0; i < _current.Days.Count; i++)
                    if (_current.Days[i].Day == todayM) { _grid.EnsureVisible(i); break; }
            }
            _grid.EndUpdate();

            string cacheTag = "";
            try
            {
                string f = Path.Combine(ApiClient.CacheDir,
                    _current.Zone + "_" + _current.Year.ToString("0000", CultureInfo.InvariantCulture) + "_" + _current.Month.ToString("00", CultureInfo.InvariantCulture) + ".json");
                if (File.Exists(f))
                    cacheTag = " (cache " + File.GetLastWriteTime(f).ToString("dd MMM h:mm tt") + ")";
            }
            catch { }

            var z = _zoneBox.SelectedItem as Zone;
            _statusLabel.Text = (z != null ? z.Daerah + ", " + z.Negeri + "  |  " : "")
                + "Zon " + _current.Zone + " " + _current.Month + "/" + _current.Year + cacheTag;
        }

        private void GridRetrieveItem(object sender, RetrieveVirtualItemEventArgs e)
        {
            if (_current == null || e.ItemIndex >= _current.Days.Count) { e.Item = new ListViewItem(""); return; }
            var d = _current.Days[e.ItemIndex];
            var item = new ListViewItem(d.Day.ToString(CultureInfo.InvariantCulture));
            item.SubItems.Add(d.Hijri ?? "");
            item.SubItems.Add(TimeUtil.Hm(TimeUtil.ToMalaysia(d.Imsak)));
            item.SubItems.Add(TimeUtil.Hm(TimeUtil.ToMalaysia(d.Fajr)));
            item.SubItems.Add(TimeUtil.Hm(TimeUtil.ToMalaysia(d.Syuruk)));
            item.SubItems.Add(TimeUtil.Hm(TimeUtil.ToMalaysia(d.Dhuhr)));
            item.SubItems.Add(TimeUtil.Hm(TimeUtil.ToMalaysia(d.Asr)));
            item.SubItems.Add(TimeUtil.Hm(TimeUtil.ToMalaysia(d.Maghrib)));
            item.SubItems.Add(TimeUtil.Hm(TimeUtil.ToMalaysia(d.Isha)));

            var nowM = DateTime.UtcNow.AddHours(8);
            if (d.Day == nowM.Day && _current.Month == nowM.Month && _current.Year == nowM.Year)
            {
                item.BackColor = Color.FromArgb(220, 240, 228);
                item.Font = new Font(Font, FontStyle.Bold);
            }
            e.Item = item;
        }

        // ---------------- ticking / azan ----------------
        private void OnTick()
        {
            DateTime nowUtc = DateTime.UtcNow;
            DateTime nowM = nowUtc.AddHours(8);

            UpdateCountdown(nowUtc);
            UpdateTrayText(nowM);

            // --- FIRING: use DueEvent (prayer whose time just arrived within grace window).
            // NextEvent alone would skip the exact prayer second and never fire.
            var due = _current == null ? null : TimeUtil.DueEvent(_current, nowUtc, 600);
            if (due == null && _nextMonth != null)
                due = TimeUtil.DueEvent(_nextMonth, nowUtc, 600);

            // 30s warning beep keyed on countdown of the *upcoming* event
            var next = FindNextEvent(nowUtc);
            if (next == null) return;
            long until = (long)Math.Ceiling((next.TimeUtc - nowUtc).TotalSeconds);
            if (until == 30 && _lastTickFired != next.TimeUtc)
            {
                _lastTickFired = next.TimeUtc;
                if (_settings.NotifySyuruk) AzanPlayer.PlayTick();
            }

            if (due == null) return;

            if (_lastFiredKey == due.TimeUtc) return; // already alerted this time
            _lastFiredKey = due.TimeUtc;

            bool isAzan = due.Name != "Syuruk";
            bool playAzan = isAzan && _settings.AzanEnabled;
            bool notify = playAzan || (due.Name == "Syuruk" && _settings.NotifySyuruk);
            if (!notify) return;

            if (playAzan)
            {
                bool subuh = due.Name == "Subuh";
                AzanPlayer.PlayFile(AzanPlayer.PickSoundPath(subuh, _settings.SubuhFile, _settings.AzanFile, File.Exists));
            }

            string title = isAzan ? "Azan " + due.Name : "Peringatan " + due.Name;
            string body = due.Malaysia.ToString("dd MMM yyyy h:mm tt", CultureInfo.InvariantCulture) + "  |  Zon " + _settings.Zone
                + (due.Day != null && !string.IsNullOrEmpty(due.Day.Hijri) ? "  |  " + due.Day.Hijri : "");
            ShowPopupSafe(title, body);
            _tray.ShowBalloonTip(6000, title, body, ToolTipIcon.Info);
        }

        private void UpdateCountdown(DateTime nowUtc)
        {
            var next = FindNextEvent(nowUtc);
            if (next == null)
            {
                _nextLabel.Text = "Tiada data untuk masa seterusnya";
                return;
            }
            var left = next.TimeUtc - nowUtc;
            _nextLabel.Text = string.Format(CultureInfo.InvariantCulture,
                "{0}: {1}   (-{2:hh\\:mm\\:ss})",
                next.Name, TimeUtil.Hm(next.Malaysia), left);        }

        private void UpdateTrayText(DateTime nowM)
        {
            try { _tray.Text = "Waktu Solat " + nowM.ToString("dd MMM  h:mm tt"); }
            catch { } // tray text length limit
        }

        private PrayerEvent FindNextEvent(DateTime nowUtc)
        {
            var ev = _current == null ? null : TimeUtil.NextEvent(_current, nowUtc);
            if (ev != null) return ev;

            // Current month exhausted: try prefetched adjacent month before fetching.
            if (_nextMonth != null && _current != null
                && _nextMonth.Zone == _current.Zone
                && _nextMonth.Year == _current.Year
                && (_nextMonth.Month == _current.Month + 1
                    || (_current.Month == 12 && _nextMonth.Month == 1 && _nextMonth.Year == _current.Year + 1)))
            {
                ev = TimeUtil.NextEvent(_nextMonth, nowUtc);
                if (ev != null) return ev;
            }

            // No data covers 'now' — fetch the month containing now, then next month.
            if ((nowUtc - _lastNextMonthAttempt).TotalSeconds < 60) return null;
            _lastNextMonthAttempt = nowUtc;

            var nowM = nowUtc.AddHours(8);
            var nm = nowM.AddMonths(1);
            ThreadPool.QueueUserWorkItem(delegate
            {
                MonthTimes mt = null;
                try { mt = ApiClient.GetMonth(_settings.Zone, nm.Year, nm.Month); } catch { }
                if (mt == null) return;
                var fetched = mt;
                BeginInvoke((MethodInvoker)delegate
                {
                    // keep only if the viewed month/zone didn't change meanwhile
                    if (_settings.Zone != fetched.Zone) return;
                    _nextMonth = fetched;
                });
            });
            return ev;
        }

        private DateTime _lastNextMonthAttempt = DateTime.MinValue;

        private void ShowPopupSafe(string title, string body)
        {
            if (_popup == null || _popup.IsDisposed) _popup = new PopupForm();
            _popup.ShowPopup(title, body);
        }

        // ---------------- auto start ----------------
        private const string RunKey = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        private const string RunValue = "AzanMalaysia";

        private static bool IsAutoStartSet()
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(RunKey, false))
                {
                    return k != null && k.GetValue(RunValue) != null;
                }
            }
            catch { return false; }
        }

        private static void SetAutoStart(bool enable)
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (k == null) return;
                    if (enable)
                        k.SetValue(RunValue, "\"" + Assembly.GetExecutingAssembly().Location + "\"");
                    else if (k.GetValue(RunValue) != null)
                        k.DeleteValue(RunValue, false);
                }
            }
            catch { }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (_timer != null) { _timer.Stop(); _timer.Dispose(); }
                if (_tray != null) { _tray.Visible = false; _tray.Dispose(); }
                if (_popup != null && !_popup.IsDisposed) _popup.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
