#!/bin/bash
#
# Build a single-binary Qbix server.
#
# Produces one executable (~10-15MB) containing:
#   - PHP interpreter (statically linked)
#   - sqlite3, dom, curl, openssl, pcntl, mbstring, opcache
#   - Q framework + any plugins (packed as .phar)
#
# The result runs anywhere — no PHP installation needed.
# Like Node.js SEA but for PHP.
#
# Requirements for building (not for running):
#   - Linux or macOS (cross-compile not supported)
#   - Docker OR build tools (gcc, make, etc.)
#   - ~1GB disk space for build, ~15MB for output
#
# Usage:
#   ./build.sh                    # build with default extensions
#   ./build.sh --upx              # compress with UPX (~40% smaller)
#   ./build.sh --extensions=...   # custom extension list
#
# The output binary can be copied to any machine of the same
# architecture and run directly:
#   ./qbix-server --port=8080
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Configuration ─────────────────────────────────────────

PHP_VERSION="${PHP_VERSION:-8.4}"
OUTPUT_NAME="${OUTPUT_NAME:-qbix-server}"
USE_UPX=false

# Extensions needed by Q + IndieWeb
EXTENSIONS="bcmath,ctype,curl,dom,fileinfo,filter,json,mbstring,mbregex,openssl,opcache,pcntl,pdo,pdo_sqlite,phar,posix,session,simplexml,sockets,sqlite3,tokenizer,xml,xmlreader,xmlwriter,zip,zlib"

for arg in "$@"; do
    case $arg in
        --upx) USE_UPX=true ;;
        --extensions=*) EXTENSIONS="${arg#*=}" ;;
        --php=*) PHP_VERSION="${arg#*=}" ;;
        --output=*) OUTPUT_NAME="${arg#*=}" ;;
        --help|-h)
            echo "Build single-binary Qbix server"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "  --php=X.Y         PHP version (default: $PHP_VERSION)"
            echo "  --upx             Compress with UPX (~40% smaller)"
            echo "  --extensions=...  Custom extension list"
            echo "  --output=NAME     Output binary name"
            echo ""
            echo "Output: ~10-15MB static binary (5-8MB with UPX)"
            echo "Contains: PHP + sqlite3 + Q framework + plugins"
            exit 0
            ;;
    esac
done

echo "┌──────────────────────────────────────┐"
echo "│  Qbix Static Binary Builder          │"
echo "├──────────────────────────────────────┤"
echo "│  PHP: $PHP_VERSION"
echo "│  Extensions: $(echo $EXTENSIONS | tr ',' '\n' | wc -l | tr -d ' ') extensions"
echo "│  UPX: $USE_UPX"
echo "└──────────────────────────────────────┘"
echo ""

# ── Step 1: Install static-php-cli ────────────────────────

SPC_DIR="$APP_DIR/.spc"
if [ ! -f "$SPC_DIR/spc" ]; then
    echo "Downloading static-php-cli..."
    mkdir -p "$SPC_DIR"
    
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64|amd64) ARCH="x86_64" ;;
        aarch64|arm64) ARCH="aarch64" ;;
    esac
    
    curl -fsSL -o "$SPC_DIR/spc" \
        "https://dl.static-php.dev/static-php-cli/spc-bin/nightly/spc-${OS}-${ARCH}"
    chmod +x "$SPC_DIR/spc"
fi

SPC="$SPC_DIR/spc"

# ── Step 2: Download PHP sources + dependencies ──────────

echo ""
echo "Downloading PHP $PHP_VERSION sources..."
$SPC download --with-php="$PHP_VERSION" --for-extensions="$EXTENSIONS" --prefer-pre-built

# ── Step 3: Build static PHP with micro SAPI ─────────────

echo ""
echo "Building static PHP (this takes a few minutes)..."

BUILD_ARGS="$EXTENSIONS --build-cli --build-micro"
if [ "$USE_UPX" = true ]; then
    BUILD_ARGS="$BUILD_ARGS --with-upx=yes"
fi

$SPC build $BUILD_ARGS

# ── Step 4: Pack Q framework + plugins into .phar ────────

echo ""
echo "Packing Q framework into .phar..."

PHAR_FILE="$APP_DIR/.spc/qbix-app.phar"

# Create a bootstrap .php that the phar runs
cat > "$APP_DIR/.spc/bootstrap.php" << 'BOOT'
<?php
// Extract phar to a temp directory (first run only)
$pharDir = Phar::running(false);
if (!$pharDir) {
    // Running as plain PHP, not from phar
    define('APP_DIR', dirname(__FILE__));
} else {
    // Running from phar — extract to a persistent location
    $extractDir = sys_get_temp_dir() . '/qbix-' . md5($pharDir);
    if (!is_dir($extractDir)) {
        $phar = new Phar($pharDir);
        $phar->extractTo($extractDir, null, true);
    }
    define('APP_DIR', $extractDir);
}
define('RUNNING_FROM_APP', true);
$_SERVER['argv'] = $GLOBALS['argv'] ?? array(__FILE__);
include(APP_DIR . '/scripts/Q/webserver.php');
BOOT

# Build the phar using PHP (the static binary we just built)
PHP_BIN="$SPC_DIR/buildroot/bin/php"
$PHP_BIN -d phar.readonly=0 -r "
\$phar = new Phar('$PHAR_FILE');
\$phar->startBuffering();

// Add the app directory (excluding build artifacts)
\$exclude = array('.spc', '.git', 'node_modules', 'vendor');
\$iterator = new RecursiveIteratorIterator(
    new RecursiveCallbackFilterIterator(
        new RecursiveDirectoryIterator('$APP_DIR', RecursiveDirectoryIterator::SKIP_DOTS),
        function (\$current, \$key, \$iterator) use (\$exclude) {
            if (\$current->isDir()) {
                return !in_array(\$current->getFilename(), \$exclude);
            }
            return true;
        }
    )
);
foreach (\$iterator as \$file) {
    \$relative = substr(\$file->getPathname(), strlen('$APP_DIR') + 1);
    \$phar->addFile(\$file->getPathname(), \$relative);
}

\$phar->setStub('<?php Phar::mapPhar(); include \"phar://\" . __FILE__ . \"/.spc/bootstrap.php\"; __HALT_COMPILER();');
\$phar->stopBuffering();
echo 'Phar created: ' . filesize('$PHAR_FILE') . ' bytes' . PHP_EOL;
"

# ── Step 5: Combine micro.sfx + phar = single binary ─────

echo ""
echo "Combining into single binary..."

MICRO_SFX="$SPC_DIR/buildroot/bin/micro.sfx"
$SPC micro:combine "$PHAR_FILE" -O "$APP_DIR/$OUTPUT_NAME"
chmod +x "$APP_DIR/$OUTPUT_NAME"

# ── Done ──────────────────────────────────────────────────

SIZE=$(du -h "$APP_DIR/$OUTPUT_NAME" | cut -f1)
echo ""
echo "┌──────────────────────────────────────┐"
echo "│  Build complete!                     │"
echo "├──────────────────────────────────────┤"
echo "│  Output: $OUTPUT_NAME ($SIZE)"
echo "│                                      │"
echo "│  Run it:                             │"
echo "│    ./$OUTPUT_NAME --port=8080        │"
echo "│                                      │"
echo "│  No PHP installation needed.         │"
echo "│  Copy to any $OS/$ARCH machine.      │"
echo "└──────────────────────────────────────┘"
