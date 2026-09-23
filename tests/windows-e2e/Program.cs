using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using FlaUI.Core;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;
using FlaUI.UIA3;

return args.FirstOrDefault() switch
{
    "shortcut" => SendActionShortcut(),
    "capture" when args.Length == 2 => CaptureScreen(args[1]),
    _ => Fail("使い方: shortcut | capture <出力 PNG>"),
};

static int SendActionShortcut()
{
    var process = Process.GetProcessesByName("chrome")
        .Where(candidate => candidate.MainWindowHandle != IntPtr.Zero)
        .OrderByDescending(candidate => candidate.StartTime)
        .FirstOrDefault()
        ?? throw new InvalidOperationException("E2E 用 Chrome のウィンドウを見つけられなかった。");

    using var application = FlaUI.Core.Application.Attach(process.Id);
    using var automation = new UIA3Automation();
    var window = application.GetMainWindow(automation, TimeSpan.FromSeconds(10))
        ?? throw new InvalidOperationException("E2E 用 Chrome のメインウィンドウを取得できなかった。");

    window.Focus();
    Wait.UntilInputIsProcessed();
    Keyboard.TypeSimultaneously(
        VirtualKeyShort.CONTROL,
        VirtualKeyShort.SHIFT,
        VirtualKeyShort.KEY_Y
    );
    Wait.UntilInputIsProcessed();
    Console.WriteLine($"[sift] Windows UI Automation で Chrome に Ctrl+Shift+Y を送信した: {process.Id}");
    return 0;
}

static int CaptureScreen(string output)
{
    var screen = System.Windows.Forms.Screen.PrimaryScreen
        ?? throw new InvalidOperationException("仮想デスクトップのプライマリ画面を取得できなかった。");
    var bounds = screen.Bounds;
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);

    using var bitmap = new Bitmap(bounds.Width, bounds.Height);
    using var graphics = Graphics.FromImage(bitmap);
    graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);
    bitmap.Save(output, ImageFormat.Png);
    Console.WriteLine($"[sift] Windows 仮想デスクトップを撮影した: {Path.GetFullPath(output)} ({bounds.Width}x{bounds.Height})");
    return 0;
}

static int Fail(string message)
{
    Console.Error.WriteLine(message);
    return 2;
}
