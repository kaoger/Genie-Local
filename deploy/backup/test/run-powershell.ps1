# Windows PowerShell 5.1 integration tests, with a private fake SCP transport.
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot ('.runtime-' + [Guid]::NewGuid().ToString('N'))
$resolvedRoot = [IO.Path]::GetFullPath($root)
$utf8 = New-Object Text.UTF8Encoding($false)
$passed = 0
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Pass([string]$Message) { $script:passed++; Write-Output "PASS $Message" }
function New-Set([string]$Folder, [int]$Number) {
    $base = 'genie-20000101T' + $Number.ToString('000000') + 'Z'
    $dump = Join-Path $Folder "$base.dump"
    $members = Join-Path $Folder "$base.members.csv"
    [IO.File]::WriteAllText($dump, "SYNTHETIC_DUMP_$Number", $utf8)
    [IO.File]::WriteAllText($members, "user_id,email`nUUID_PLACEHOLDER,EMAIL_PLACEHOLDER`n", $utf8)
    $dumpHash = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant()
    $membersHash = (Get-FileHash -LiteralPath $members -Algorithm SHA256).Hash.ToLowerInvariant()
    $text = @("format`tgenie-backup-v1", "dump_file`t$base.dump", "dump_bytes`t$((Get-Item -LiteralPath $dump).Length)",
        "dump_sha256`t$dumpHash", "members_file`t$base.members.csv", "members_sha256`t$membersHash") -join "`n"
    [IO.File]::WriteAllText((Join-Path $Folder "$base.manifest"), $text + "`n", $utf8)
    return $base
}
function Select-Remote([string]$Base) {
    Copy-Item -LiteralPath (Join-Path $remote "$Base.manifest") -Destination (Join-Path $remote 'latest.manifest') -Force
}
function Run-Pull([bool]$ShouldPass) {
    # Windows PowerShell wraps native stderr as an ErrorRecord; expected failures
    # must be captured without ErrorActionPreference=Stop aborting this harness.
    $ErrorActionPreference = 'Continue'
    $output = & "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -File $copy `
        -SshTarget 'root@fixture-host' -IdentityFile $key -Destination $destination 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $log = $output -join "`n"
    Assert (($code -eq 0) -eq $ShouldPass) "Unexpected pull exit code: $log"
    Assert ($log -notmatch 'EMAIL_PLACEHOLDER|UUID_PLACEHOLDER|SYNTHETIC|TEST_SECRET_PLACEHOLDER') 'Log exposed fixture data'
    if ($ShouldPass) { Assert ($log -match 'PULL_BACKUP_OK') 'Missing success marker' }
    else { Assert ($log -notmatch 'PULL_BACKUP_OK') 'False success marker' }
}
try {
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $remote = Join-Path $root 'remote'; $destination = Join-Path $root 'destination'
    [IO.Directory]::CreateDirectory($remote) | Out-Null
    [IO.Directory]::CreateDirectory($destination) | Out-Null
    $key = Join-Path $root 'key-placeholder'
    [IO.File]::WriteAllText($key, 'PRIVATE_KEY_PLACEHOLDER', $utf8)
    $fakeScp = Join-Path $root 'scp.ps1'
    $fakeCode = @'
$global:LASTEXITCODE = 1
if ($env:TEST_SCP_FAIL -eq '1') { return }
$remoteArg = $args[$args.Count - 2]
$outPath = $args[$args.Count - 1]
$name = $remoteArg.Substring($remoteArg.LastIndexOf('/') + 1)
if ($name -cnotmatch '^(latest\.manifest|genie-[0-9]{8}T[0-9]{6}Z\.(dump|manifest|members\.csv))$') { return }
Copy-Item -LiteralPath (Join-Path $env:TEST_SCP_REMOTE $name) -Destination $outPath
$global:LASTEXITCODE = 0
'@
    [IO.File]::WriteAllText($fakeScp, $fakeCode, $utf8)
    $env:TEST_FAKE_SCP = $fakeScp; $env:TEST_SCP_REMOTE = $remote
    $source = Join-Path (Split-Path $PSScriptRoot -Parent) 'pull-backup.ps1'
    $code = [IO.File]::ReadAllText($source, [Text.Encoding]::UTF8)
    $nativeLine = '$scp = Join-Path $env:WINDIR ''System32\OpenSSH\scp.exe'''
    Assert ($code.Contains($nativeLine)) 'Transport injection anchor missing'
    $code = $code.Replace($nativeLine, '$scp = $env:TEST_FAKE_SCP')
    $copy = Join-Path $root 'pull-under-test.ps1'
    [IO.File]::WriteAllText($copy, $code, $utf8)
    $parseTokens=$null; $parseErrors=$null
    [Management.Automation.Language.Parser]::ParseFile($source,[ref]$parseTokens,[ref]$parseErrors) | Out-Null
    Assert ($parseErrors.Count -eq 0) 'PowerShell syntax'
    Pass 'PowerShell syntax'
    $base = New-Set $remote 10; Select-Remote $base
    [IO.File]::WriteAllText((Join-Path $destination 'notes.txt'), 'KEEP_PLACEHOLDER', $utf8)
    Run-Pull $true
    Assert ([IO.File]::Exists((Join-Path $destination "$base.dump"))) 'Dump absent'
    Assert ([IO.File]::Exists((Join-Path $destination "$base.members.csv"))) 'Members absent'
    Pass 'complete pull, both SHA-256 checks, confidential log'
    Run-Pull $true
    Pass 'same backup repeated without overwrite'
    for ($i=1; $i -le 9; $i++) { New-Set $destination $i | Out-Null }
    Run-Pull $true
    $sets = @(Get-ChildItem -LiteralPath $destination -Filter '*.manifest' -File)
    Assert ($sets.Count -eq 8) 'Retention is not eight sets'
    Assert ([IO.File]::Exists((Join-Path $destination 'notes.txt'))) 'Foreign file deleted'
    Pass 'retain eight complete sets and preserve foreign files'
    $base = New-Set $remote 11; Select-Remote $base
    [IO.File]::AppendAllText((Join-Path $remote "$base.dump"), 'CORRUPT_PLACEHOLDER', $utf8)
    Run-Pull $false
    Assert (-not [IO.File]::Exists((Join-Path $destination "$base.dump"))) 'Corrupt dump published'
    Assert (@(Get-ChildItem -LiteralPath $destination -Filter '*.manifest' -File).Count -eq 8) 'Checksum failure deleted old backups'
    Pass 'dump corruption fails before publication or retention'
    $base = New-Set $remote 12; Select-Remote $base
    [IO.File]::AppendAllText((Join-Path $remote "$base.members.csv"), 'CORRUPT_PLACEHOLDER', $utf8)
    Run-Pull $false
    Assert (-not [IO.File]::Exists((Join-Path $destination "$base.dump"))) 'Members corruption published dump'
    Pass 'members corruption rejected'
    $env:TEST_SCP_FAIL = '1'; Run-Pull $false; Remove-Item Env:\TEST_SCP_FAIL
    Assert (@(Get-ChildItem -LiteralPath $destination -Filter '*.manifest' -File).Count -eq 8) 'Transfer failure deleted old backups'
    Pass 'transfer failure preserves old sets'
    $lockPath = Join-Path $destination '.pull-lock'
    $heldLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try { Run-Pull $false } finally { $heldLock.Dispose() }
    Pass 'concurrent pull rejected'
    $base = New-Set $remote 13; Select-Remote $base
    $latestPath = Join-Path $remote 'latest.manifest'
    $text = [IO.File]::ReadAllText($latestPath).Replace("$base.dump", '../PATH_PLACEHOLDER.dump')
    [IO.File]::WriteAllText($latestPath, $text, $utf8)
    Run-Pull $false
    Pass 'remote path traversal filename rejected'
    Write-Output "POWERSHELL_TESTS_OK: $passed cases (SCP transport mocked)"
} finally {
    Remove-Item Env:\TEST_FAKE_SCP, Env:\TEST_SCP_REMOTE, Env:\TEST_SCP_FAIL -ErrorAction SilentlyContinue
    if ([IO.Directory]::Exists($resolvedRoot)) {
        $prefix = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
        if ($resolvedRoot.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($resolvedRoot) -cmatch '^\.runtime-[a-f0-9]{32}$' -and
            -not ((Get-Item -LiteralPath $resolvedRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
        }
    }
}
