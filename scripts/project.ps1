param(
    [ValidateSet('dev', 'check', 'build:check', 'db:init', 'db:start', 'db:status', 'db:stop', 'db:migrate', 'db:seed', 'db:test', 'db:rpc-test', 'db:goal-test', 'db:praise-test', 'db:session-test')]
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
& pnpm run $Task
exit $LASTEXITCODE
