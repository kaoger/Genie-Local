# Windows built-in OpenSSH; never store credentials or private keys in this repo.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SshTarget,
    [Parameter(Mandatory=$true)][string]$IdentityFile,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$stage = $null
$lock = $null
$step = 'configuration'
function Read-Manifest([string]$Path) {
    $fields = @{}
    foreach ($line in [IO.File]::ReadAllLines($Path, [Text.Encoding]::UTF8)) {
        $parts = $line.Split([char]9)
        if ($parts[0] -in @('format','dump_file','dump_sha256','dump_bytes','members_file','members_sha256')) {
            if ($parts.Count -ne 2 -or $fields.ContainsKey($parts[0])) { throw 'Invalid manifest' }
            $fields[$parts[0]] = $parts[1]
        }
    }
    if ($fields['format'] -ne 'genie-backup-v1' -or
        $fields['dump_file'] -cnotmatch '^genie-[0-9]{8}T[0-9]{6}Z\.dump$' -or
        $fields['dump_sha256'] -cnotmatch '^[a-f0-9]{64}$' -or
        $fields['members_sha256'] -cnotmatch '^[a-f0-9]{64}$' -or
        $fields['dump_bytes'] -notmatch '^[0-9]+$') { throw 'Invalid manifest' }
    $base = $fields['dump_file'].Substring(0, $fields['dump_file'].Length - 5)
    if ($fields['members_file'] -cne "$base.members.csv") { throw 'Invalid members filename' }
    return $fields
}
function Receive-BackupFile([string]$Name, [string]$OutPath) {
    if ($Name -cnotmatch '^(latest\.manifest|genie-[0-9]{8}T[0-9]{6}Z\.(dump|manifest|members\.csv))$') {
        throw 'Invalid remote filename'
    }
    & $scp -O -q -B -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 `
        -o ConnectionAttempts=1 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 `
        -i $IdentityFile "${SshTarget}:/var/lib/genie-backup/$Name" $OutPath *> $null
    if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($OutPath)) { throw 'Transfer failed' }
}
function Test-Hash([string]$Path, [string]$Expected) {
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Expected) {
        throw 'Checksum mismatch'
    }
}
try {
    if ($SshTarget -notmatch '^(?:[a-z_][a-z0-9_-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$') { throw 'Invalid SSH target' }
    $scp = Join-Path $env:WINDIR 'System32\OpenSSH\scp.exe'
    if (-not (Test-Path -LiteralPath $scp -PathType Leaf)) { throw 'Windows OpenSSH missing' }
    $IdentityFile = (Resolve-Path -LiteralPath $IdentityFile).Path
    $Destination = [IO.Path]::GetFullPath($Destination)
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    if ((Get-Item -LiteralPath $Destination).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Destination is a link' }
    $lockPath = Join-Path $Destination '.pull-lock'
    if (Test-Path -LiteralPath $lockPath) {
        if ((Get-Item -LiteralPath $lockPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Lock is a link' }
    }
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $stage = Join-Path $Destination ('.pending-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $step = 'latest manifest transfer'
    Receive-BackupFile 'latest.manifest' (Join-Path $stage 'latest.manifest')
    $latest = Read-Manifest (Join-Path $stage 'latest.manifest')
    $base = $latest['dump_file'].Substring(0, $latest['dump_file'].Length - 5)
    $step = 'backup set transfer'
    Receive-BackupFile "$base.manifest" (Join-Path $stage "$base.manifest")
    # The immutable manifest must exactly match the latest marker we selected.
    $markerHash = (Get-FileHash -LiteralPath (Join-Path $stage 'latest.manifest') -Algorithm SHA256).Hash
    Test-Hash (Join-Path $stage "$base.manifest") $markerHash.ToLowerInvariant()
    $manifest = Read-Manifest (Join-Path $stage "$base.manifest")
    Receive-BackupFile $manifest['dump_file'] (Join-Path $stage $manifest['dump_file'])
    Receive-BackupFile $manifest['members_file'] (Join-Path $stage $manifest['members_file'])
    $step = 'SHA-256 verification'
    Test-Hash (Join-Path $stage $manifest['dump_file']) $manifest['dump_sha256']
    Test-Hash (Join-Path $stage $manifest['members_file']) $manifest['members_sha256']
    if ((Get-Item -LiteralPath (Join-Path $stage $manifest['dump_file'])).Length -ne [long]$manifest['dump_bytes']) {
        throw 'Dump size mismatch'
    }
    $step = 'local publication'
    # Publish manifest last. Existing copies may be reused only when byte-identical.
    foreach ($name in @($manifest['dump_file'], $manifest['members_file'], "$base.manifest")) {
        $outPath = Join-Path $Destination $name
        $inPath = Join-Path $stage $name
        if (Test-Path -LiteralPath $outPath) {
            if ((Get-Item -LiteralPath $outPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Output is a link' }
            Test-Hash $outPath (Get-FileHash -LiteralPath $inPath -Algorithm SHA256).Hash.ToLowerInvariant()
        } else {
            [IO.File]::Move($inPath, $outPath)
        }
    }
    $step = 'retention'
    $sets = @(Get-ChildItem -LiteralPath $Destination -File |
        Where-Object { $_.Name -cmatch '^genie-[0-9]{8}T[0-9]{6}Z\.manifest$' -and
            -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
        Sort-Object Name -Descending)
    $index = 0
    foreach ($set in $sets) {
        # Foreign or malformed manifests never become deletion candidates.
        $old = Read-Manifest $set.FullName
        $oldBase = $set.Name.Substring(0, $set.Name.Length - 9)
        if ($old['dump_file'] -cne "$oldBase.dump") { throw 'Retention manifest mismatch' }
        $oldDump = Join-Path $Destination $old['dump_file']
        $oldMembers = Join-Path $Destination $old['members_file']
        if (-not [IO.File]::Exists($oldDump) -or -not [IO.File]::Exists($oldMembers)) { continue }
        if (((Get-Item -LiteralPath $oldDump).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            ((Get-Item -LiteralPath $oldMembers).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Retention file is a link' }
        $index++
        if ($index -gt 8 -and $oldBase -cne $base) {
            Test-Hash $oldDump $old['dump_sha256']
            Test-Hash $oldMembers $old['members_sha256']
            Remove-Item -LiteralPath $oldDump, $oldMembers, $set.FullName
        }
    }
    Write-Output 'PULL_BACKUP_OK: dump and members SHA-256 verified'
} catch {
    # Do not print exception details: scp errors can contain local paths or hostnames.
    [Console]::Error.WriteLine("PULL_BACKUP_FAILED: $step")
    exit 1
} finally {
    if ($stage -and [IO.Directory]::Exists($stage)) {
        $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
        $rootPrefix = $Destination.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
        if ($resolvedStage.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($resolvedStage) -cmatch '^\.pending-[a-f0-9]{32}$' -and
            -not ((Get-Item -LiteralPath $stage).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-Item -LiteralPath $resolvedStage -Recurse -Force
        }
    }
    if ($lock) { $lock.Dispose() }
}
