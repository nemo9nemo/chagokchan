param(
    [ValidateSet('dev', 'check', 'build:check', 'api:me-test', 'api:goal-test', 'api:goal-list-test', 'api:goal-management-test', 'api:praise-test', 'api:praise-tag-test', 'api:board-test', 'api:connection-test', 'api:news-test', 'api:trash-test', 'api:security-test', 'db:init', 'db:start', 'db:status', 'db:stop', 'db:migrate', 'db:seed', 'db:test', 'db:rpc-test', 'db:goal-test', 'db:goal-list-test', 'db:goal-overview-test', 'perf:board-test', 'db:goal-lifecycle-test', 'db:praise-test', 'db:praise-result-test', 'db:connection-test', 'db:shared-test', 'db:lifecycle-test', 'db:deletion-test', 'db:session-test', 'db:session-adapter-test', 'db:logout-test', 'db:registration-test', 'api:registration-test')]
    [string]$Task = 'dev'
)
$ErrorActionPreference = 'Stop'
$chagokExpected = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../.node-version') -Raw).Trim()
$chagokCandidates = @(
    $env:CHAGOKCHAN_NODE_PATH,
    (Get-Command node -ErrorAction SilentlyContinue).Source,
    (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
)
$chagokNode = $null
foreach ($chagokCandidate in $chagokCandidates) {
    if ($chagokCandidate -and (Test-Path -LiteralPath $chagokCandidate)) {
        $chagokVersion = & $chagokCandidate --version
        if ($chagokVersion -eq ('v' + $chagokExpected)) { $chagokNode = $chagokCandidate; break }
    }
}
if (-not $chagokNode) { throw ('Install Node ' + $chagokExpected + ' or set CHAGOKCHAN_NODE_PATH.') }
$env:PATH = [IO.Path]::GetDirectoryName($chagokNode) + ';' + $env:PATH
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$chagokPackage = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json
$chagokExpectedPnpm = $chagokPackage.engines.pnpm
$chagokPnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$chagokPnpm = if ($env:CHAGOKCHAN_PNPM_PATH) { $env:CHAGOKCHAN_PNPM_PATH } else { $chagokPnpmCommand.Source }
$chagokPnpmMatches = $false
if ($chagokPnpm -and (Test-Path -LiteralPath $chagokPnpm)) {
    $chagokActualPnpm = & $chagokPnpm --version
    $chagokPnpmMatches = $LASTEXITCODE -eq 0 -and "$chagokActualPnpm".Trim() -eq $chagokExpectedPnpm
}
if (-not $chagokPnpmMatches) {
    if ($env:CHAGOKCHAN_PNPM_PATH) { throw ('CHAGOKCHAN_PNPM_PATH must point to pnpm ' + $chagokExpectedPnpm + '.') }
    $chagokCorepack = Get-Command corepack -ErrorAction SilentlyContinue
    if (-not $chagokCorepack) { throw ('Install pnpm ' + $chagokExpectedPnpm + ' or Corepack, or set CHAGOKCHAN_PNPM_PATH.') }
    $chagokCorepackJs = Join-Path (Split-Path -Parent $chagokCorepack.Source) 'node_modules/corepack/dist/corepack.js'
    if (-not (Test-Path -LiteralPath $chagokCorepackJs)) { throw ('Install pnpm ' + $chagokExpectedPnpm + ' or set CHAGOKCHAN_PNPM_PATH.') }
    if (-not $env:COREPACK_HOME) { $env:COREPACK_HOME = Join-Path (Get-Location) '.cache/corepack' }
    $env:COREPACK_ENABLE_AUTO_PIN = '0'
    $chagokShimDirectory = Join-Path (Get-Location) '.cache/corepack-shims'
    New-Item -ItemType Directory -Path $chagokShimDirectory -Force | Out-Null
    & $chagokNode $chagokCorepackJs enable --install-directory $chagokShimDirectory pnpm
    if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare project-local pnpm shims.' }
    $env:PATH = [IO.Path]::GetDirectoryName($chagokNode) + ';' + $chagokShimDirectory + ';' + $env:PATH
    $chagokPnpm = Join-Path $chagokShimDirectory 'pnpm.cmd'
    $chagokActualPnpm = & $chagokPnpm --version
    if ($LASTEXITCODE -ne 0 -or "$chagokActualPnpm".Trim() -ne $chagokExpectedPnpm) { throw ('Unable to prepare pinned pnpm ' + $chagokExpectedPnpm + '.') }
}
$env:PATH = [IO.Path]::GetDirectoryName($chagokNode) + ';' + (Split-Path -Parent $chagokPnpm) + ';' + $env:PATH
& $chagokPnpm run $Task
exit $LASTEXITCODE
