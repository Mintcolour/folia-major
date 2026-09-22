param([int]$BodianProcessId, [switch]$BeforeOfficialLaunch)

# test/manual/bodian-capture-session.ps1
# Trust only this temporary CA in the current user's store, then remove it on exit.
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $workspace
if ($BeforeOfficialLaunch) {
    if ($BodianProcessId -or (Get-CimInstance Win32_Process -Filter "name='bodian_pc.exe'")) {
        throw 'Close the logged-out official client before starting capture'
    }
    $captureArguments = @('--official-process')
} else {
    $targetProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$BodianProcessId"
    if ($targetProcess.ExecutablePath -ne 'C:\Program Files (x86)\bodian\bodian_pc.exe') {
        throw 'The capture target is not the verified Bodian executable'
    }
    $captureArguments = @('--pid', $BodianProcessId)
}
$certificatePath = Join-Path $workspace 'test-results/bodian-capture/mitmproxy-ca-cert.cer'
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
$certificateStore = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
$added = $false
try {
    $certificateStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $existing = $certificateStore.Certificates.Find('FindByThumbprint', $certificate.Thumbprint, $false)
    if ($existing.Count -eq 0) {
        $certificateStore.Add($certificate)
        $added = $true
    }
    Write-Output 'Temporary capture certificate ready (CurrentUser only)'
    & './test-results/bodian-capture-tools/Scripts/python.exe' 'test/manual/bodian-capture-run.py' @captureArguments
    if ($LASTEXITCODE -ne 0) { throw 'Capture process failed' }
} finally {
    if ($added) {
        $certificateStore.Remove($certificate)
        Write-Output 'Temporary capture certificate removed'
    }
    $certificateStore.Close()
}
