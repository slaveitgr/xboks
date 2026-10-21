# Manual Windows reference capture. Does not install, sign in or change settings.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[a-z0-9][a-z0-9._-]{1,80}$')]
    [string]$CaseId,
    [string]$OutputDirectory = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'xboks-reference'),
    [string]$Action = '',
    [string]$ObservedResult = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($bounds.Width -ne 1920 -or $bounds.Height -ne 1080) {
    throw "Reference capture requires a 1920x1080 primary display. Current size: $($bounds.Width)x$($bounds.Height). No display setting was changed."
}
$destination = Join-Path $OutputDirectory $CaseId
if (Test-Path -LiteralPath $destination) { throw "Case already exists: $CaseId. Use a new CaseId." }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$packages = @('Microsoft.GamingApp','Microsoft.XboxGamingOverlay','Microsoft.GamingServices','Microsoft.XboxIdentityProvider','Microsoft.WindowsStore') | ForEach-Object {
    Get-AppxPackage -Name $_ | Select-Object Name,Version,Architecture,PackageFullName
}
Write-Host 'Arrange the original Xbox app at the desired state on the primary screen.'
Write-Host 'After Enter, there is a 5-second delay to return to the app. This captures the whole primary display.'
Read-Host 'Press Enter when ready' | Out-Null
Start-Sleep -Seconds 5
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$imagePath = Join-Path $destination 'reference.png'
try {
    $graphics.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size)
    $bitmap.Save($imagePath,[System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
[ordered]@{
    schema_version = 1
    case_id = $CaseId
    timestamp_utc = [DateTime]::UtcNow.ToString('o')
    capture = 'primary-display-manual-state'
    width = $bounds.Width
    height = $bounds.Height
    os_version = [Environment]::OSVersion.Version.ToString()
    culture = [System.Globalization.CultureInfo]::CurrentUICulture.Name
    packages = @($packages)
    action = $Action
    observed_result = $ObservedResult
    image_sha256 = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    scope = 'Manual screenshot and operator observations; no service/API behavior automatically verified.'
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $destination 'case.json') -Encoding UTF8
Write-Host "Saved local reference case: $destination"
