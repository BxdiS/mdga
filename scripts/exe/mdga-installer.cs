// mdga-installer.exe: a double-click wrapper around install.ps1 for people
// who would rather not open a terminal. The script is embedded as a resource
// at build time (scripts/exe/build.ps1); the exe writes it to %TEMP% and runs
// it in this console window with Windows PowerShell, so the user gets the
// same menu as `irm .../install.ps1 | iex`.
//
// Targets .NET Framework 4.x (present on every Windows 10/11) and C# 5, the
// language level of the csc.exe that ships with Windows.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("mdga installer")]
[assembly: AssemblyProduct("mdga")]
[assembly: AssemblyDescription("Installs mdga into Discord")]

static class Program
{
    static int Main()
    {
        Console.Title = "mdga installer";
        int code = 1;
        string script = Path.Combine(Path.GetTempPath(), "mdga-install-" + Guid.NewGuid().ToString("N") + ".ps1");
        try
        {
            using (Stream res = Assembly.GetExecutingAssembly().GetManifestResourceStream("install.ps1"))
            using (FileStream file = File.Create(script))
            {
                res.CopyTo(file);
            }

            string powershell = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            ProcessStartInfo psi = new ProcessStartInfo(powershell,
                "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"");
            psi.UseShellExecute = false; // share this console window
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                code = p.ExitCode;
            }
        }
        catch (Exception e)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("mdga installer failed: " + e.Message);
            Console.ResetColor();
        }
        finally
        {
            try { File.Delete(script); } catch { }
        }

        // Launched by double-click, the window would vanish with the result.
        if (!Console.IsInputRedirected)
        {
            Console.WriteLine();
            Console.Write("Press any key to close...");
            Console.ReadKey(true);
        }
        return code;
    }
}
