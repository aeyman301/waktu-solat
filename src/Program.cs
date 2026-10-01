// Azan Malaysia - JAKIM prayer times for Windows 7+
// Entry point, single-instance guard, self-test mode.
using System;
using System.Threading;
using System.Windows.Forms;

namespace AzanApp
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool createdNew;
            using (var mutex = new Mutex(true, "AzanApp.SingleInstance.{7C1E2F5A-9B0D-4E6A-8F3B-2A5C7D9E1B4C}", out createdNew))
            {
                if (!createdNew) return; // already running

                if (args != null && Array.IndexOf(args, "--selftest") >= 0)
                {
                    Environment.ExitCode = SelfTest.RunAll();
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }
    }
}
