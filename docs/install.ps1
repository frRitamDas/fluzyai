# The Fluzy AI Windows installer lives at https://raw.githubusercontent.com/frRitamDas/fluzyai/main/docs/install.ps1
# This shim keeps old `iwr ... github.io ... | iex` one-liners working.
$ErrorActionPreference = 'Stop'
Invoke-Expression (Invoke-RestMethod -UseBasicParsing https://raw.githubusercontent.com/frRitamDas/fluzyai/main/docs/install.ps1)
