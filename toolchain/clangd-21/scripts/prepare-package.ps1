[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolchainRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $toolchainRoot '..\..'))
$provenancePath = Join-Path $toolchainRoot 'PROVENANCE.json'
$provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repositoryRoot ".cache\clangd-$($provenance.version)"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

function Get-VerifiedArtifact {
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Artifact
    )

    $destination = Join-Path $OutputDirectory $Artifact.path
    if (-not $Force -and (Test-Path -LiteralPath $destination)) {
        $item = Get-Item -LiteralPath $destination
        $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($item.Length -eq [long]$Artifact.bytes -and $hash -eq $Artifact.sha256) {
            Write-Host "Using verified clangd artifact $($Artifact.path)"
            return
        }
    }

    $partial = "$destination.partial"
    try {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
        for ($attempt = 1; $attempt -le 5; $attempt++) {
            try {
                Invoke-WebRequest -Uri $Artifact.url -OutFile $partial -UseBasicParsing
                break
            } catch {
                if ($attempt -eq 5) { throw }
                Start-Sleep -Seconds ([Math]::Min(4 * $attempt, 16))
            }
        }

        $item = Get-Item -LiteralPath $partial
        if ($item.Length -ne [long]$Artifact.bytes) {
            throw "Unexpected byte length for $($Artifact.path): expected $($Artifact.bytes), got $($item.Length)"
        }
        $hash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -ne $Artifact.sha256) {
            throw "SHA-256 mismatch for $($Artifact.path): expected $($Artifact.sha256), got $hash"
        }
        Move-Item -LiteralPath $partial -Destination $destination -Force
        Write-Host "Prepared clangd artifact $($Artifact.path)"
    } finally {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
}

foreach ($artifact in $provenance.artifacts) {
    Get-VerifiedArtifact -Artifact $artifact
}
