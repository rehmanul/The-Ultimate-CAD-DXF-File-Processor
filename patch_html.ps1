$file = "c:\Users\Admin\Desktop\The-Ultimate-CAD-DXF-File-Processor\public\index.html"
$content = Get-Content $file -Raw

$old = "    <!-- Babylon.js Engine -->"
$new = @"
    <!-- Three.js Import Map -->
    <script type="importmap">
    {
        "imports": {
            "three": "./libs/build/three.module.js",
            "three/addons/": "./libs/package/examples/jsm/"
        }
    }
    </script>

    <!-- Babylon.js Engine (kept for fallback/exports) -->
"@

$content = $content.Replace($old, $new)
Set-Content $file -Value $content -NoNewline
Write-Host "Done - importmap injected"
