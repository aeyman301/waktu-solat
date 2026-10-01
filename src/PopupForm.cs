// Popup toast-style notification window (borderless, top-right, above tray).
using System;
using System.Drawing;
using System.Windows.Forms;

namespace AzanApp
{
    public sealed class PopupForm : Form
    {
        private readonly Timer _closeTimer = new Timer();
        private readonly Label _title = new Label();
        private readonly Label _body = new Label();

        public PopupForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            BackColor = Color.FromArgb(24, 32, 44);
            Size = new Size(360, 110);

            _title.AutoSize = false;
            _title.ForeColor = Color.White;
            _title.Font = new Font("Segoe UI", 12F, FontStyle.Bold);
            _title.SetBounds(14, 12, 332, 26);
            _title.TextAlign = ContentAlignment.MiddleLeft;

            _body.AutoSize = false;
            _body.ForeColor = Color.FromArgb(200, 214, 230);
            _body.Font = new Font("Segoe UI", 10F);
            _body.SetBounds(14, 44, 332, 48);
            _body.TextAlign = ContentAlignment.TopLeft;

            Controls.Add(_title);
            Controls.Add(_body);

            _closeTimer.Interval = 8000;
            _closeTimer.Tick += delegate { Close(); };
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_TOPMOST = 0x8;
                const int WS_EX_NOACTIVATE = 0x08000000;
                const int WS_EX_TOOLWINDOW = 0x80;
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
                return cp;
            }
        }

        public void ShowPopup(string title, string body)
        {
            _title.Text = title;
            _body.Text = body;
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - 12, wa.Bottom - Height - 12);
            _closeTimer.Stop();
            Show();
            _closeTimer.Start();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            _closeTimer.Stop();
            _closeTimer.Dispose();
            base.OnFormClosed(e);
        }
    }
}
